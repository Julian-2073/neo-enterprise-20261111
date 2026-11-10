import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {materialFixtures,fixtureCsv,seedSimIdentity,SIM_BUSINESS,simSnapshotInput} from '../scripts/materials-sim-fixture.mjs';
let mf,runtime;
before(async()=>{({mf,runtime}=await localRuntime());await seedSimIdentity(runtime.DB);});
after(async()=>await mf?.dispose());
async function request(path,method='GET',body,business=SIM_BUSINESS){const r=await handleApi(new Request(`http://localhost/api/v1/${path}${path.includes('?')?'&':'?'}businessId=${business}`,{method,headers:{origin:'http://localhost',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),runtime);return {status:r.status,data:await r.json()};}
async function ingest(kind,csv){const form=new FormData();for(const [k,v] of Object.entries({kind,templateVersion:'2',dataNature:'demo',sourceName:'JOURNEY_PIPELINE_TEST',coverageStart:'2026-04-06',coverageEnd:'2026-09-24'}))form.set(k,v);form.set('file',new File([csv],'journey.csv'));const upload=await request('ingestion-batches','POST',form);assert.equal(upload.data.batch.status,'ready',JSON.stringify(upload));const committed=await request(`ingestion-batches/${upload.data.batch.id}/commit`,'POST',{validationVersion:upload.data.batch.validation_version});assert.equal(committed.status,200,JSON.stringify(committed));return committed.data.batch;}
async function publish(extra={}){const r=await request('operating-snapshots','POST',{...simSnapshotInput,asOf:'2026-09-24',periodStart:'2026-04-06',periodEnd:'2026-09-20',...extra});assert.equal(r.status,201,JSON.stringify(r));return r.data.snapshot;}
test('CSV → identities → saved journey/evidence → later order automatically recalculates without touching old snapshot',async()=>{
 for(const [kind,csv] of Object.entries(materialFixtures).filter(([k])=>!['events','orders'].includes(k)))await ingest(kind,csv);
 const eventRows=[];for(const n of [1,2])for(const [stage,type,date] of [['A1','impression','2026-09-01'],['A2','click','2026-09-02'],['A3','inquiry','2026-09-03']])eventRows.push([`pipeline-${n}-${stage}`,date+'T10:00:00',type,'sim-douyin',1,'sim-r1','sim-platform','sim-external'+n]);
 await ingest('events',fixtureCsv(['source_record_id','occurred_at','event_type','channel','quantity','product_id','identity_namespace','external_contact_id'],eventRows));
 const orderHeaders=['source_record_id','order_id','order_line_id','entry_type','occurred_at','channel','product_id','sku_id','quantity','amount_cents','variable_cost_cents','identity_namespace','external_contact_id'];
 const paid=n=>[`pipeline-pay-${n}`,`pipeline-order-${n}`,`pipeline-line-${n}`,'paid','2026-09-04T10:00:00','sim-douyin','sim-r1','sim-r1-red',1,10000,5000,'sim-platform','sim-external'+n];
 await ingest('orders',fixtureCsv(orderHeaders,[paid(1)]));
 const first=await publish(),fixed=JSON.stringify(first);
 for(const id of [first.evidenceIds.paidOrders,first.evidenceIds.inventoryCostCents,first.evidenceIds.supply,first.evidenceIds.customerJourney,`${first.id}:view:supply-pulse:2026-09-14`,`${first.id}:view:channel-role:sim-douyin:sim-core`]){
  const r=await request(`evidence/${encodeURIComponent(id)}?dataNature=demo&snapshotId=${first.id}&limit=1`);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.analysis.version,'evidence-analysis-v1');assert.ok(r.data.analysis.judgment.nextStep);assert.equal(r.data.sources.reduce((n,x)=>n+x.recordCount,0),r.data.evidence.sourceCount);
 }
 const forecast={id:'evidence-forecast-test',businessId:SIM_BUSINESS,dataNature:'demo',snapshotId:first.id,weeks:[{start:'2026-09-25',end:'2026-10-01',units:3,unmetUnits:2,netRevenueCents:30000,contributionMarginCents:null,endingUnits:0}],evidenceIds:[first.evidenceIds.paidOrders,first.evidenceIds.supply],limitations:['保存条件推演。']};
 await runtime.DB.prepare("INSERT INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(forecast.id,SIM_BUSINESS,'demo',first.id,'forecast','evidence-request','test',JSON.stringify(forecast),new Date().toISOString()).run();
 const forecastPath=`evidence/${encodeURIComponent(`${first.id}:view:forecast-week:${forecast.id}:2026-09-25`)}?dataNature=demo&snapshotId=${first.id}`;
 const forecastEvidence=await request(forecastPath);assert.equal(forecastEvidence.status,200,JSON.stringify(forecastEvidence));assert.equal(forecastEvidence.data.analysis.metrics[0].value,3);assert.equal(forecastEvidence.data.analysis.metrics[3].value,null);assert.equal(forecastEvidence.data.sources.reduce((n,x)=>n+x.recordCount,0),forecastEvidence.data.evidence.sourceCount);
 assert.equal((await request(forecastPath.replace(forecast.id,'missing-artifact'))).status,404);assert.equal((await request(forecastPath.replace('2026-09-25','2030-01-01'))).status,404);assert.equal((await request(forecastPath,'GET',undefined,'test-b')).status,404);
 assert.deepEqual(first.data.customerJourney.period.counts,{A1:2,A2:2,A3:2,A4:1});assert.deepEqual(first.data.customerJourney.period.transitions.map(t=>t.rate),[1,1,.5]);assert.match(first.calculationVersion,/customer-journey/);
 const q=id=>`dataNature=demo&snapshotId=${id}`;
 const evidence=await request(`evidence/${encodeURIComponent(first.evidenceIds.customerJourney)}?${q(first.id)}`);assert.equal(evidence.status,200);assert.deepEqual(evidence.data.evidence.value,first.data.customerJourney);assert.ok(evidence.data.records.length>0);
 const read=await request(`customer-journey?${q(first.id)}`);assert.deepEqual(read.data.journey,first.data.customerJourney);
 const homeFirst=await request(`home-sections?${q(first.id)}`);assert.equal(homeFirst.status,200,JSON.stringify(homeFirst));
 assert.deepEqual(homeFirst.data.people.journey,read.data.journey);assert.equal(homeFirst.data.people.metrics.purchasingCustomers,1);assert.equal(homeFirst.data.people.metrics.conversionRate,.5);
 const supplyFirst=await request(`supply-overview?${q(first.id)}`);assert.deepEqual(homeFirst.data.goods.metrics,supplyFirst.data.metrics);assert.deepEqual(homeFirst.data.goods.series,supplyFirst.data.series);
 assert.equal(homeFirst.data.market.cells.find(c=>c.channel==='sim-douyin'&&c.role==='sim-core').metrics[0].value,'1');
 assert.equal((await request(`home-sections?${q(first.id)}`,'GET',undefined,'test-b')).status,404);assert.equal((await request(`home-sections?${q(first.id)}`.replace('dataNature=demo','dataNature=business'))).status,404);
 const pulseId=id=>`${id}:view:customer-pulse:2026-09-14`;
 const pulseFirst=await request(`evidence/${encodeURIComponent(pulseId(first.id))}?${q(first.id)}&limit=1`);assert.equal(pulseFirst.status,200,JSON.stringify(pulseFirst));assert.equal(pulseFirst.data.evidence.value.conversion.transitions[2].rate,.5);assert.equal(pulseFirst.data.records.length,1);assert.equal(pulseFirst.data.sources.reduce((n,x)=>n+x.recordCount,0),pulseFirst.data.evidence.sourceCount);assert.ok(pulseFirst.data.sources.some(x=>x.kind==='customer_identities'));assert.ok(pulseFirst.data.sources.every(x=>['events','orders','customers','customer_identities'].includes(x.kind)));
 assert.equal((await request(`evidence/${encodeURIComponent(pulseId(first.id))}?${q(first.id)}`,'GET',undefined,'test-b')).status,404);
 assert.equal((await request(`evidence/${encodeURIComponent(pulseId(first.id))}?dataNature=business&snapshotId=${first.id}`)).status,404);
 await ingest('orders',fixtureCsv(orderHeaders,[paid(2)]));
 await ingest('inventory',fixtureCsv(['source_record_id','occurred_at','warehouse_id','product_id','sku_id','sellable_units','inventory_cost_cents','in_transit_units','safety_units'],[['new-home-stock','2026-09-24T12:00:00','sim-east','sim-r1','sim-r1-red',99,990000,5,80]]));
 // No rule in this publication request: the backend inherits the saved one.
 const next=await publish({customerFunnel:undefined});assert.notEqual(next.id,first.id);assert.deepEqual(next.data.customerJourney.period.counts,{A1:2,A2:2,A3:2,A4:2});assert.equal(next.data.customerJourney.period.transitions[2].rate,1);assert.deepEqual(next.data.materials.customerAnalysis.rule,first.data.materials.customerAnalysis.rule);
 const homeNext=await request(`home-sections?${q(next.id)}`);assert.equal(homeNext.status,200,JSON.stringify(homeNext));
 assert.equal(homeNext.data.people.metrics.purchasingCustomers,2);assert.equal(homeNext.data.people.metrics.conversionRate,1);
 assert.equal(homeNext.data.market.cells.find(c=>c.channel==='sim-douyin'&&c.role==='sim-core').metrics[0].value,'2');
 assert.notEqual(homeNext.data.goods.metrics.sellableUnits,homeFirst.data.goods.metrics.sellableUnits);assert.equal(homeNext.data.goods.review,null);
 const homeOld=await request(`home-sections?${q(first.id)}`);assert.deepEqual(homeOld.data,homeFirst.data);
 for(const section of ['people','goods']){const ev=await request(`evidence/${encodeURIComponent(homeNext.data[section].evidenceId)}?${q(next.id)}`);assert.equal(ev.status,200,JSON.stringify(ev));if(section==='goods'){assert.equal(ev.data.analysis.metrics.find(m=>m.label==='可售库存').value,homeNext.data.goods.metrics.sellableUnits);assert.ok(ev.data.sources.every(x=>x.kind==='inventory'));}}
 const pulseNext=await request(`evidence/${encodeURIComponent(pulseId(next.id))}?${q(next.id)}`);assert.equal(pulseNext.data.evidence.value.conversion.transitions[2].rate,1);const pulseOld=await request(`evidence/${encodeURIComponent(pulseId(first.id))}?${q(first.id)}`);assert.deepEqual(pulseOld.data.evidence.value,pulseFirst.data.evidence.value);
 const again=await publish({customerFunnel:undefined});assert.equal(again.id,next.id);
 const old=await request(`operating-snapshot?${q(first.id)}`);assert.equal(JSON.stringify(old.data.snapshot),fixed);
 const historical=await publish({knownAt:first.knownAt,customerFunnel:undefined});assert.equal(historical.data.customerJourney.period.counts.A4,1);assert.equal(historical.data.customerJourney.period.transitions[2].rate,.5);
 assert.equal((await request(`customer-journey?${q(first.id)}`,'GET',undefined,'test-b')).status,404);
 assert.equal((await request(`evidence/${encodeURIComponent(first.evidenceIds.customerJourney)}?dataNature=business&snapshotId=${first.id}`)).status,404);
 const disabled=await publish({customerFunnel:null});assert.equal(disabled.data.customerJourney.period.transitions[2].rate,null);assert.equal(disabled.data.customerJourney.rule,null);
});
