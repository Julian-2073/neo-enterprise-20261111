import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'node:http';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {decodeInput} from '../server/input-storage.ts';
import {materialFixtures,fixtureCsv,seedSimIdentity,SIM_BUSINESS,simSnapshotInput} from '../scripts/materials-sim-fixture.mjs';
let mf,runtime,server;const jobs=new Map(),inputs=[];
before(async()=>{
 ({mf,runtime}=await localRuntime());await seedSimIdentity(runtime.DB);
 server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;res.setHeader('Content-Type','application/json');
  if(req.url==='/runs'){
   const p=JSON.parse(body),env=await decodeInput(JSON.stringify(p.envelope.envelopePacked?{storageFormat:'neo-inputs-gzip-v1',...p.envelope.envelopePacked}:p.envelope)),b=env.marketWorkbenchBasis;inputs.push(b);
   const review={judgment:{title:'OFFLINE_PIPELINE_TRANSPORT_TEST',summary:'离线验证模型结果保存与回读',evidenceIds:[b.cells[0].evidenceId]},signals:['demand','competition','efficiency'].map(id=>({id,title:'离线传输验证',summary:'验证引用链路',evidenceIds:[b.cells[0].evidenceId]})),cells:b.cells.map(c=>({channel:c.channel,role:c.role,headline:'OFFLINE_MODEL_CELL',summary:'结果来自模型传输测试',status:'observed',evidenceIds:[c.evidenceId]})),sources:[],nextStep:'测试建议'};
   const value={id:p.id,status:'completed',steps:[],result:{finding:{conclusion:'离线传输验证',evidenceIds:[b.cells[0].evidenceId],marketWorkbench:review},specialists:{},marketEvidence:[],model:'OFFLINE_PIPELINE_TRANSPORT_TEST'}};jobs.set(p.id,value);res.end(JSON.stringify(value));
  }else res.end(JSON.stringify(jobs.get(req.url.split('/')[2])));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));runtime={...runtime,agentExecutionMode:'live',manualAgentBusinesses:[SIM_BUSINESS],manualMarketBusinesses:[],NEO_AGENT_URL:`http://127.0.0.1:${server.address().port}`,NEO_SERVICE_TOKEN:'test'};
});
after(async()=>{await mf?.dispose();await new Promise(r=>server?.close(r));});
async function request(path,method='GET',body,business=SIM_BUSINESS,rt=runtime){const r=await handleApi(new Request(`http://localhost/api/v1/${path}${path.includes('?')?'&':'?'}businessId=${business}`,{method,headers:{origin:'http://localhost',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}
async function ingest(kind,csv){const form=new FormData();for(const [k,v] of Object.entries({kind,templateVersion:'2',dataNature:'demo',sourceName:'MARKET_PIPELINE_TEST',coverageStart:'2026-04-06',coverageEnd:'2026-09-24'}))form.set(k,v);form.set('file',new File([csv],'market.csv'));const uploaded=await request('ingestion-batches','POST',form);assert.equal(uploaded.data.batch.status,'ready',JSON.stringify(uploaded));const committed=await request(`ingestion-batches/${uploaded.data.batch.id}/commit`,'POST',{validationVersion:uploaded.data.batch.validation_version});assert.equal(committed.status,200,JSON.stringify(committed));}
async function publish(){const r=await request('operating-snapshots','POST',{...simSnapshotInput,asOf:'2026-09-24',periodStart:'2026-07-27',periodEnd:'2026-09-20'});assert.equal(r.status,201,JSON.stringify(r));return r.data.snapshot;}
test('imports → calculated market basis → model dispatch → saved UI/evidence → new data recalculation; no tenant crossover',async()=>{
 for(const [kind,csv] of Object.entries(materialFixtures).filter(([k])=>!['events','orders'].includes(k)))await ingest(kind,csv);
 await ingest('events',fixtureCsv(['source_record_id','occurred_at','event_type','channel','quantity','product_id','identity_namespace','external_contact_id'],[['market-event','2026-09-03T10:00:00','inquiry','sim-douyin',2,'sim-r1','sim-platform','sim-external1']]));
 const headers=['source_record_id','order_id','order_line_id','entry_type','occurred_at','channel','product_id','sku_id','quantity','amount_cents','variable_cost_cents','identity_namespace','external_contact_id'];
 const paid=n=>[`market-pay-${n}`,`market-order-${n}`,`market-line-${n}`,'paid','2026-09-04T10:00:00','sim-douyin','sim-r1','sim-r1-red',1,10000,5000,'sim-platform','sim-external'+n];
 await ingest('orders',fixtureCsv(headers,[paid(1)]));const first=await publish();
 const q=id=>`dataNature=demo&snapshotId=${id}`,path=id=>'market-workbench?'+q(id),scope=id=>({snapshotId:id,dataNature:'demo'});
 const read=await request(path(first.id));assert.equal(read.status,200,JSON.stringify(read));assert.equal(read.data.modelReview,null);assert.equal(inputs.length,0);
 const cell=read.data.cells.find(c=>c.channel==='sim-douyin'&&c.role==='sim-core');assert.equal(cell.current.paidOrders,1);
 const made=await request(path(first.id),'POST',scope(first.id));assert.equal(made.status,202,JSON.stringify(made));assert.equal(made.data.run.status,'completed');assert.equal(made.data.model,'OFFLINE_PIPELINE_TRANSPORT_TEST');assert.equal(made.data.cells.find(c=>c.evidenceId===cell.evidenceId).headline,'OFFLINE_MODEL_CELL');
 const home=await request('home-sections?'+q(first.id));assert.equal(home.status,200,JSON.stringify(home));
 assert.deepEqual(home.data.market.judgment,made.data.judgment);assert.equal(home.data.market.run.id,made.data.run.id);
 const homeCell=home.data.market.cells.find(c=>c.evidenceId===cell.evidenceId);assert.equal(homeCell.headline,'OFFLINE_MODEL_CELL');assert.deepEqual(homeCell.metrics,made.data.cells.find(c=>c.evidenceId===cell.evidenceId).displayMetrics.slice(0,2));
 const repeat=await request(path(first.id),'POST',scope(first.id));assert.equal(repeat.data.run.id,made.data.run.id);assert.equal(inputs.length,1);
 const evidence=await request(`evidence/${encodeURIComponent(cell.evidenceId)}?${q(first.id)}`);assert.equal(evidence.status,200,JSON.stringify(evidence));assert.equal(evidence.data.analysis.judgment.title,'OFFLINE_MODEL_CELL');assert.ok(evidence.data.evidence.scopeLabel.includes(cell.periods.current.start));assert.ok(evidence.data.evidence.scopeLabel.includes(cell.periods.current.end));
 for(const type of ['demand','competition','efficiency']){const signal=await request(`evidence/${encodeURIComponent(`${first.id}:view:market-${type}`)}?${q(first.id)}`);assert.equal(signal.status,200,JSON.stringify(signal));assert.equal(signal.data.analysis.judgment.title,'离线传输验证');}
 await ingest('orders',fixtureCsv(headers,[paid(2)]));const second=await publish();assert.notEqual(second.id,first.id);
 const changed=await request(path(second.id));assert.equal(changed.data.cells.find(c=>c.channel==='sim-douyin'&&c.role==='sim-core').current.paidOrders,2);assert.equal(changed.data.modelReview,null);
 await request(path(second.id),'POST',scope(second.id));assert.equal(inputs.length,2);assert.equal(inputs[1].cells.find(c=>c.channel==='sim-douyin'&&c.role==='sim-core').current.paidOrders,2);
 const old=await request(path(first.id));assert.equal(old.data.cells.find(c=>c.evidenceId===cell.evidenceId).current.paidOrders,1);assert.equal(old.data.run.id,made.data.run.id);
 assert.equal((await request(path(first.id),'GET',undefined,'test-b')).status,404);assert.equal((await request(path(first.id).replace('dataNature=demo','dataNature=business'))).status,404);
 await runtime.DB.prepare('UPDATE business_members SET role=? WHERE business_id=? AND user_id=?').bind('reader',SIM_BUSINESS,'local-reader').run();
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};assert.equal((await request(path(first.id),'POST',scope(first.id),SIM_BUSINESS,reader)).status,403);
});
