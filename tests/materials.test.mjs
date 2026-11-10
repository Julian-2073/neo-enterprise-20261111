import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {parseFile} from '../server/csv.ts';
import {materialFixtures,fixtureCsv,seedSimIdentity,SIM_BUSINESS,simSnapshotInput} from '../scripts/materials-sim-fixture.mjs';
import {context} from '../server/auth.ts';
import {capture} from '../server/ontology/store.ts';
let mf,runtime,empty,baseline;
before(async()=>{({mf,runtime}=await localRuntime());await seedSimIdentity(runtime.DB);});
after(async()=>{await mf?.dispose();});
function req(path,method='GET',body,rt=runtime,biz=SIM_BUSINESS){return handleApi(new Request(`http://localhost/api/v1/${path}${path.includes('?')?'&':'?'}businessId=${biz}`,{method,headers:{...(method==='POST'?{origin:'http://localhost'}:{}),...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),rt);}
async function upload(kind,raw,opts={}){const f=new FormData();for(const [k,v] of Object.entries({kind,templateVersion:opts.version??'2',dataNature:opts.nature??'demo',sourceName:opts.source??'NEO_SIM_20261004',coverageStart:'2026-04-06',coverageEnd:'2026-09-24'}))f.set(k,v);f.set('file',new File([raw],'sim.csv'));const r=await req('ingestion-batches','POST',f,opts.runtime??runtime,opts.business??SIM_BUSINESS);return {status:r.status,...await r.json()};}
async function commit(batch){const r=await req(`ingestion-batches/${batch.id}/commit`,'POST',{validationVersion:batch.validation_version});return {status:r.status,...await r.json()};}
async function ingest(kind,raw,opts){const u=await upload(kind,raw,opts);assert.equal(u.batch?.status,'ready',JSON.stringify(u));const c=await commit(u.batch);assert.equal(c.status,200,JSON.stringify(c));return c.batch;}
async function snap(input={}){const r=await req('operating-snapshots','POST',{...simSnapshotInput,...input});assert.equal(r.status,201,await r.clone().text());return (await r.json()).snapshot;}
async function domain(s){const r=await req(`agent-domain?dataNature=demo&snapshotId=${s.id}`);assert.equal(r.status,200,await r.clone().text());return r.json();}
test('new templates preserve UTF8/BOM, quoted names, date validation, null/zero and units',async()=>{
 const good=await parseFile(new TextEncoder().encode('\uFEFF'+fixtureCsv(['source_record_id','effective_from','sku_id','product_id','safety_units','name','unit'],[['sim-row','2026-04-06','sim-s','sim-p',0,'逗号,\n多行','件']])),'skus','2026-04-06','2026-09-24');assert.equal(good.issues.length,0);assert.equal(good.rows[0].fact.safety_units,0);
 for(const raw of [materialFixtures.skus.replace(',件',',kg'),materialFixtures.skus.replace(',5,',',9007199254740992,'),materialFixtures.roles.replace('2026-04-06','2026-02-30'),materialFixtures.supply_rules.replace('7500','10001')]){const kind=raw.includes('target_ratio_bps')?'supply_rules':raw.includes('sku_id')?'skus':'roles';assert.ok((await parseFile(new TextEncoder().encode(raw),kind,'2026-04-06','2026-09-24')).issues.length);}
 const r=await req('import-templates/products?format=csv&version=2');assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/v2/);assert.match(await r.text(),/image_url/);
 assert.equal((await upload('products',materialFixtures.products,{version:'1'})).status,409);
});
test('snapshot before masters stays empty after later imports even on first domain open',async()=>{
 empty=await snap();assert.deepEqual(empty.domain.products,[]);assert.equal(empty.data.materials.customerAnalysis.conversionRate,null);
 for(const [kind,raw] of Object.entries(materialFixtures)){const b=await ingest(kind,raw);const file=await req(`ingestion-batches/${b.id}/file`);assert.deepEqual(new Uint8Array(await file.arrayBuffer()),new TextEncoder().encode(raw));}
 assert.deepEqual((await domain(empty)).products,[]);assert.equal((await snap({knownAt:empty.knownAt})).domain.products.length,0);
 baseline=await snap();assert.equal(baseline.domain.products.length,2);assert.equal(baseline.domain.arrivals[0].date,'2026-10-06');assert.equal(baseline.domain.skus[1].unit,'件');
});
test('snapshot computes customer cohort, configured SKU supply, stock and quantities from facts',async()=>{
 assert.deepEqual(baseline.data.financial,{paidOrders:1,netRevenueCents:20000,spendCents:2000,variableCostCents:10000,contributionMarginCents:8000});
 const m=baseline.data.materials;assert.equal(m.dataProvenance,'SYNTHETIC_DEMO');assert.equal(m.quality.unresolvedReferences,0);
 assert.equal(m.customerAnalysis.status,'ready');assert.equal(m.customerAnalysis.stageCustomerCounts.A3,3);assert.equal(m.customerAnalysis.stageCustomerCounts.A4,1);assert.equal(m.customerAnalysis.cohortCustomers,3);assert.equal(m.customerAnalysis.matureCustomers,2);assert.equal(m.customerAnalysis.immatureCustomers,1);assert.equal(m.customerAnalysis.convertedCustomers,1);assert.equal(m.customerAnalysis.conversionRate,0.5);assert.equal(baseline.data.events.A3,4);
 const p=m.supply.products.find(p=>p.productId==='sim-r1');assert.deepEqual(p,{productId:'sim-r1',netQuantity:2,sellableUnits:7,inTransitUnits:20,inventoryCostCents:7000,earliestArrival:'2026-10-06',plannedArrivalUnits:20,remainingArrivalUnits:null});
 const r=m.supply.roles.find(r=>r.roleId==='sim-core');assert.equal(r.skuCount,2);assert.equal(r.qualifiedSkuCount,1);assert.equal(r.qualifiedRatio,0.5);assert.equal(r.targetRatio,0.75);assert.equal(r.weekly[0].qualifiedRatio,1);assert.equal(r.weekly[1].qualifiedRatio,0.5);
 assert.deepEqual((await snap({customerFunnel:undefined})).data.materials.customerAnalysis.rule,m.customerAnalysis.rule);
 assert.equal((await snap({customerFunnel:null})).data.materials.customerAnalysis.status,'unconfigured');
 const incompatible=await req('operating-snapshots','POST',{...simSnapshotInput,channel:'sim-douyin',customerFunnel:{cohortStage:'A3',conversionWindowDays:7,channelPolicy:'any'}});assert.equal(incompatible.status,422);
 const r2=await snap({customerFunnel:{cohortStage:'A3',conversionWindowDays:14,channelPolicy:'same_channel'}});assert.equal(r2.data.materials.customerAnalysis.matureCustomers,0);assert.equal(r2.data.materials.customerAnalysis.conversionRate,null);
 const read=await req(`operating-materials?dataNature=demo&snapshotId=${baseline.id}`);assert.deepEqual((await read.json()).materials,m);
});
test('cross-source overlap and retry do not accumulate, changed same effective version conflicts',async()=>{
 const repeat=await upload('products',materialFixtures.products);assert.equal(repeat.reused,true);assert.equal((await commit(repeat.batch)).batch.imported_count,2);
 const overlap=await upload('products',materialFixtures.products,{source:'NEO_SIM_20261004_overlap'});assert.equal(overlap.batch.duplicate_count,2);assert.equal((await commit(overlap.batch)).batch.imported_count,0);
 const bad=await upload('products',materialFixtures.products.replace('模拟跑步机','冲突名称'));assert.equal(bad.batch.status,'invalid');assert.equal((await commit(bad.batch)).status,409);
 const rules=await upload('supply_rules',materialFixtures.supply_rules.replace('sim-core-rule','sim-different-rule'));assert.equal(rules.batch.status,'invalid');
 const later=fixtureCsv(['source_record_id','effective_from','product_id','name','role_id'],[['sim-p-race1','2026-09-22','sim-r1','甲','sim-core']]);
 const a=await upload('products',later),b=await upload('products',later.replace('sim-p-race1','sim-p-race2').replace('甲','乙'));
 const c=await Promise.all([commit(a.batch),commit(b.batch)]);assert.deepEqual(c.map(r=>r.status).sort(),[200,409]);assert.equal((await snap()).domain.products.find(p=>p.id==='sim-r1').name,'模拟跑步机');
});
test('strict parent/identity/event-order errors block whole batch; nature and tenants cannot provide references',async()=>{
 for(const [kind,raw] of [['products',materialFixtures.products.replace('sim-core','sim-missing')],['orders',materialFixtures.orders.replace('sim-r1-red','sim-m1-black')],['events',materialFixtures.events.replace('sim-o1','sim-missing-order')],['events',materialFixtures.events.replace('sim-external1','sim-external2')],['events',materialFixtures.events.replace('sim-platform','sim-missing-namespace')]]){const u=await upload(kind,raw);assert.equal(u.batch.status,'invalid',JSON.stringify(u));assert.equal((await commit(u.batch)).status,409);}
 const wrongRefund=materialFixtures.orders.split('sim-refund1')[1].replace('sim-external1','sim-external2');const refundCsv=materialFixtures.orders.split('\r\n')[0]+'\r\nsim-refund1'+wrongRefund;assert.equal((await upload('orders',refundCsv)).batch.status,'invalid');
 assert.equal((await upload('roles',materialFixtures.roles,{nature:'business'})).status,422);
 const outside=await upload('products',materialFixtures.products,{business:'test-b'});assert.equal(outside.batch.status,'invalid');
 const s=await req(`operating-materials?dataNature=demo&snapshotId=${baseline.id}`,'GET',undefined,runtime,'test-b');assert.equal(s.status,404);
 assert.equal((await req(`operating-materials?dataNature=business&snapshotId=${baseline.id}`)).status,404);
 assert.equal((await req(`ingestion-batches/${outside.batch.id}/file`)).status,404);
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};assert.equal((await upload('roles',materialFixtures.roles,{runtime:reader})).status,403);
});
test('source evidence contains raw material rows and canonical alias links reach domain and Ontology',async()=>{
 const ev=await req(`evidence/${encodeURIComponent(baseline.evidenceIds.materials)}?limit=100`),e=await ev.json();assert.equal(ev.status,200);assert.ok(e.records.some(r=>r.kind==='products'));assert.ok(e.records.every(r=>r.row_number>=2&&r.filename==='sim.csv'));
 const customerEvidence=await req(`evidence/${encodeURIComponent(baseline.evidenceIds.customerAnalysis)}?limit=100`);assert.ok((await customerEvidence.json()).records.some(r=>r.kind==='customer_identities'));
 const d=await domain(baseline);assert.equal(d.facts.find(r=>r.fact.source_record_id==='sim-event1').fact.resolved_customer_id,'sim-c1');assert.ok(d.facts.every(r=>['events','orders','inventory','expenses'].includes(r.kind)));
 const ctx=await context(new Request(`http://localhost/?businessId=${SIM_BUSINESS}`),runtime);
 const {neoDefinition}=await import('../server/ontology/model.ts');assert.equal(neoDefinition('neo-default-v1').types.length,16);assert.equal(neoDefinition().version,'neo-default-v2');
 const c=await capture(ctx,{dataNature:'demo',snapshotId:baseline.id});assert.equal(c.data.domain.find(r=>r.kind==='products'&&r.payload.id==='sim-r1').payload.name,'模拟跑步机');
 const freshCapture=await capture(ctx,{dataNature:'demo',asOf:baseline.asOf});assert.ok(freshCapture.data.domain.some(d=>d.kind==='customers'));assert.equal(freshCapture.data.facts.find(r=>r.fact.source_record_id==='sim-event1').fact.resolved_customer_id,'sim-c1');
 const {project}=await import('../server/ontology/project.ts');const p=project(c.data,c.definition,c.asOf);assert.ok(p.objects.some(o=>o.typeId==='customer'&&o.id==='sim-c1'&&!o.referenceOnly));assert.ok(p.links.some(l=>l.linkId==='event_customer'));assert.ok(p.links.some(l=>l.linkId==='event_order'));assert.ok(p.links.some(l=>l.linkId==='identity_customer'));assert.equal(p.issues.filter(i=>i.severity==='error').length,0,JSON.stringify(p.issues));
});
test('late history and future effective names freeze old domain; past knowledge suppresses late fees',async()=>{
 // Baseline has not been opened before this point beyond earlier immutable domain read; a new unopened snapshot proves lazy initialization too.
 const unopened=await snap({productId:'sim-r1'});
 const late=fixtureCsv(['source_record_id','effective_from','product_id','name','role_id'],[['sim-p1-revised','2026-08-01','sim-r1','迟到历史名称','sim-core']]);await ingest('products',late);
 const latest=await snap();assert.equal(latest.domain.products.find(p=>p.id==='sim-r1').name,'迟到历史名称');assert.equal((await domain(unopened)).products[0].name,'模拟跑步机');
 const oldOptions=await(await req(`operating-options?dataNature=demo&snapshotId=${unopened.id}`)).json();assert.equal(oldOptions.products[0].name,'模拟跑步机');const currentOptions=await(await req('operating-options?dataNature=demo&asOf=2026-09-14')).json();assert.equal(currentOptions.products.find(p=>p.id==='sim-r1').name,'迟到历史名称');
 assert.equal((await snap({knownAt:baseline.knownAt})).domain.products.find(p=>p.id==='sim-r1').name,'模拟跑步机');
 const fees=fixtureCsv(['source_record_id','occurred_at','channel','amount_cents'],[['sim-unallocated','2026-09-02','sim-douyin',10]]);await ingest('expenses',fees);
 const historical=await snap({productId:'sim-r1',knownAt:unopened.knownAt});assert.equal(historical.data.financial.contributionMarginCents,8000);assert.equal((await snap({productId:'sim-r1'})).data.financial.contributionMarginCents,null);
 const ctx=await context(new Request(`http://localhost/?businessId=${SIM_BUSINESS}`),runtime);const c=await capture(ctx,{dataNature:'demo',snapshotId:unopened.id});assert.equal(c.data.domain.find(r=>r.kind==='products').payload.name,'模拟跑步机');
 await assert.rejects(()=>capture(ctx,{dataNature:'demo',snapshotId:unopened.id,knownAt:empty.knownAt}),e=>e.code==='SNAPSHOT_KNOWLEDGE');
 const invalid=await req('operating-snapshots','POST',{...simSnapshotInput,knownAt:'2100-01-01T00:00:00Z'});assert.equal(invalid.status,422);
});
test('missing stock, identity and observation coverage remain null; zero retains meaning',async()=>{
 await ingest('skus',fixtureCsv(['source_record_id','effective_from','sku_id','product_id','unit'],[['sim-new-sku','2026-09-01','sim-r1-green','sim-r1','件']]));
 let s=await snap();const role=s.data.materials.supply.roles.find(r=>r.roleId==='sim-core');assert.equal(role.skuCount,3);assert.equal(role.observedSkuCount,2);assert.equal(role.qualifiedRatio,null);assert.equal(role.currentInventoryCostCents,null);
 assert.equal(s.data.materials.supply.products.find(p=>p.productId==='sim-m1').sellableUnits,0);assert.equal(s.domain.skus.find(p=>p.id==='sim-r1-green').safetyUnits,null);
 await ingest('events',fixtureCsv(['source_record_id','occurred_at','event_type','channel','quantity','product_id'],[['sim-unidentified','2026-09-02','inquiry','sim-douyin',1,'sim-r1']]));s=await snap();assert.equal(s.data.materials.customerAnalysis.conversionRate,null);assert.equal(s.data.materials.customerAnalysis.status,'partial');assert.equal(s.data.materials.customerAnalysis.stageCustomerCounts.A3,null);
 const uncovered=await snap({periodStart:'2026-04-01'});assert.equal(uncovered.data.materials.customerAnalysis.conversionRate,null);assert.ok(uncovered.data.materials.customerAnalysis.limitations.some(s=>s.includes('覆盖不足')));
 const r=await req('operating-materials?dataNature=demo&snapshotId=missing');assert.equal(r.status,404);
 assert.equal((await runtime.DB.prepare('SELECT COUNT(*) AS n FROM neo_runs').first()).n,0);
});
test('expired parent between preview and commit is rechecked and strict database guard rolls back',async()=>{
 const pending=await upload('products',fixtureCsv(['source_record_id','effective_from','product_id','name','role_id'],[['sim-pending','2026-09-16','sim-pending-p','待提交','sim-entry']]));assert.equal(pending.batch.status,'ready');
 await ingest('roles',fixtureCsv(['source_record_id','effective_from','effective_to','role_id','name'],[['sim-role-expire','2026-09-15','2026-09-16','sim-entry','结束版本']]));assert.equal((await commit(pending.batch)).status,409);
 // Bypass service recheck only within test to exercise transaction trigger, never production API.
 const row=await runtime.DB.prepare('SELECT * FROM ingestion_rows WHERE batch_id=?').bind(pending.batch.id).first();
 await assert.rejects(()=>runtime.DB.prepare(`INSERT INTO business_facts(id,business_id,source_id,batch_id,row_number,kind,data_nature,record_key,content_hash,occurred_at,business_date,payload) SELECT r.id,b.business_id,b.source_id,b.id,r.row_number,b.kind,b.data_nature,r.record_key,r.content_hash,json_extract(r.payload,'$.occurred_at'),json_extract(r.payload,'$.business_date'),r.payload FROM ingestion_rows r JOIN ingestion_batches b ON b.id=r.batch_id WHERE r.id=?`).bind(row.id).run(),/MATERIAL_REFERENCE_CONFLICT/);
 assert.equal((await runtime.DB.prepare('SELECT COUNT(*) AS n FROM business_facts WHERE batch_id=?').bind(pending.batch.id).first()).n,0);
});
