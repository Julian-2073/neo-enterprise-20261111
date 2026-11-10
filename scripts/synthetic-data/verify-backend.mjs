// Existing product handlers, isolated persistent D1/R2, no AI service or patrol.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleApi} from '../../server/api.ts';
import {savedNeoData} from '../../lib/operating-demo-data.ts';
import {enrichSavedDomain} from '../../lib/operating-domain-data.ts';
import {adapt} from '../materials-full24/adapt.mjs';
import {sha} from '../materials-full24/source.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const out=path.join(root,'outputs/isolated-synthetic-20261004');
const generatedRuns=path.join(out,'runtime/guarded');
await fs.mkdir(generatedRuns,{recursive:true});
const state=await fs.mkdtemp(path.join(generatedRuns,'run-'));
const business='neo-sim-acceptance-20261004';
const raw=JSON.parse(await fs.readFile(path.join(out,'normal/source-records.json'),'utf8'));
const manifest=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8'));
const expected=JSON.parse(await fs.readFile(path.join(out,'expected-results.json'),'utf8'));
assert.equal(manifest.businessId,business);assert.equal(manifest.dataNature,'demo');
assert.ok(state.startsWith(root+path.sep));assert.ok(!state.includes('neo-live-demo'));
process.env.WRANGLER_SEND_METRICS='false';
await fs.mkdir(state,{recursive:true});
console.log(JSON.stringify({isolationRoot:state,d1Path:path.join(state,'d1'),r2Path:path.join(state,'r2'),businessId:business,autoPatrol:false,externalModelCalls:false}));
const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('synthetic-only')}}",compatibilityDate:'2026-05-22',d1Databases:{DB:'20261004-0000-4000-8000-000000000001'},r2Buckets:{RAW_FILES:'synthetic-raw'},d1Persist:path.join(state,'d1'),r2Persist:path.join(state,'r2')});
const DB=await mf.getD1Database('DB'),RAW_FILES=await mf.getR2Bucket('RAW_FILES');
let blockedPatrolWrites=0;
function disablePatrolWrites(db){
 return new Proxy(db,{get(target,key){
  if(key==='prepare')return sql=>{
   if(/\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+neo_(?:runs|sessions)\b/i.test(sql)){blockedPatrolWrites++;throw new Error('SYNTHETIC_TEST_PATROL_DISABLED');}
   return target.prepare(sql);
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
}
const runtime={DB:disablePatrolWrites(DB),RAW_FILES,local:{enabled:true,development:true,userId:'synthetic-owner'}};
const checks=[];const snapshots={};
function check(name,condition){assert.ok(condition,name);checks.push(name);}
async function request(resource,{method='GET',body,rt=runtime,bid=business}={}){
 assert.equal(bid,business,'No API test may target an existing enterprise');
 const sep=resource.includes('?')?'&':'?';
 return handleApi(new Request(`http://localhost/api/v1/${resource}${sep}businessId=${business}`,{method,headers:{...(method==='POST'?{origin:'http://localhost'}:{}),...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),rt);
}
async function ok(resource,options={}){const r=await request(resource,options);const d=await r.json();assert.ok(r.status<300,JSON.stringify({resource,status:r.status,data:d}));return d;}
async function upload(meta,bytes,rt=runtime){const form=new FormData();form.set('file',new File([bytes],path.basename(meta.file)));for(const [k,v]of Object.entries({kind:meta.kind,sourceName:meta.sourceName,dataNature:'demo',templateVersion:'1',coverageStart:meta.coverageStart,coverageEnd:meta.coverageEnd}))form.set(k,v);return ok('ingestion-batches',{method:'POST',body:form,rt});}
async function commit(batch,rt=runtime){return ok(`ingestion-batches/${batch.id}/commit`,{method:'POST',body:{validationVersion:batch.validation_version},rt});}
async function snap(value={}){return (await ok('operating-snapshots',{method:'POST',body:{dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-07-27',periodEnd:'2026-09-20',...value}})).snapshot;}
function compare(s,e,label){
 assert.deepEqual(s.data.financial,e.financial,label+' financial');checks.push(label+' financial matches independent CSV oracle');
 assert.deepEqual(s.data.events,e.events,label+' raw events');checks.push(label+' raw events match independent oracle');
 assert.equal(s.data.inventoryCostCents,e.inventoryCostCents,label+' stock valuation');checks.push(label+' stock valuation matches oracle');
 const simple=r=>Object.fromEntries(['sku_id','warehouse_id','sellable_units','inventory_cost_cents','in_transit_units','safety_units'].map(k=>[k,r[k]]));
 const sorted=xs=>xs.map(simple).sort((a,b)=>(a.sku_id+a.warehouse_id).localeCompare(b.sku_id+b.warehouse_id));
 assert.deepEqual(sorted(s.data.inventory),sorted(e.inventory),label+' latest inventory');checks.push(label+' latest per warehouse/SKU matches oracle');
}
try{
 await DB.prepare('CREATE TABLE IF NOT EXISTS synthetic_migrations(name TEXT PRIMARY KEY)').run();
 for(const name of(await fs.readdir(path.join(root,'drizzle'))).filter(x=>x.endsWith('.sql')).sort()){
  if(await DB.prepare('SELECT name FROM synthetic_migrations WHERE name=?').bind(name).first())continue;
  const statements=(await fs.readFile(path.join(root,'drizzle',name),'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean);
  await DB.batch([...statements.map(s=>DB.prepare(s)),DB.prepare('INSERT INTO synthetic_migrations VALUES(?)').bind(name)]);
 }
 await DB.batch([DB.prepare('INSERT OR IGNORE INTO businesses(id,name) VALUES(?,?)').bind(business,'NEO 隔离模拟企业'),DB.prepare('INSERT OR IGNORE INTO business_members(id,business_id,user_id,role) VALUES(?,?,?,?)').bind('sim-member-owner',business,'synthetic-owner','admin'),DB.prepare('INSERT OR IGNORE INTO business_members(id,business_id,user_id,role) VALUES(?,?,?,?)').bind('sim-member-reader',business,'synthetic-reader','reader')]);
 check('only isolated enterprise registered',(await DB.prepare('SELECT COUNT(*) n FROM businesses').first()).n===1);
 const batches=[];
 for(const meta of manifest.importBatches){
  const bytes=await fs.readFile(path.join(out,meta.file));const u=await upload(meta,bytes);check(meta.file+' formally ready/committed',['ready','committed'].includes(u.batch.status));
  const c=await commit(u.batch);check(meta.file+' commits once',c.batch.status==='committed'&&c.batch.imported_count===meta.rows);
  const file=await request(`ingestion-batches/${u.batch.id}/file`);check(meta.file+' R2 exact readback',Buffer.from(await file.arrayBuffer()).equals(bytes));batches.push({meta,batch:c.batch});
 }
 const count=(await DB.prepare('SELECT COUNT(*) n FROM business_facts WHERE business_id=? AND data_nature=\'demo\'').bind(business).first()).n;
 check('normal fact row count',count===2841);
 check('no business-nature facts',(await DB.prepare("SELECT COUNT(*) n FROM business_facts WHERE data_nature!='demo' OR business_id!=?").bind(business).first()).n===0);
 const first=batches[0],replay=await upload(first.meta,await fs.readFile(path.join(out,first.meta.file)));check('repeat file is reused',replay.reused&&replay.batch.id===first.batch.id);await commit(replay.batch);
 check('repeat import does not grow facts',(await DB.prepare('SELECT COUNT(*) n FROM business_facts').first()).n===count);
 // Existing accepted domain route, with current plans only; not historical version ingestion.
 // Current snapshots freeze formal material facts instead of the legacy domain fallback.
 const adapted=await adapt(out);
 check('current material adapter has same generated source',adapted.sourceSha256===sha(await fs.readFile(path.join(out,'normal/source-records.json'))));
 let materialCount=0;
 for(const meta of adapted.batches.filter(b=>!['events','orders','inventory','expenses'].includes(b.kind))){
  const form=new FormData();for(const[k,v]of Object.entries({kind:meta.kind,sourceName:meta.sourceName,dataNature:'demo',templateVersion:meta.templateVersion,coverageStart:meta.coverageStart,coverageEnd:meta.coverageEnd}))form.set(k,v);
  form.set('file',new File([await fs.readFile(path.join(out,meta.file))],path.basename(meta.file)));
  const u=await ok('ingestion-batches',{method:'POST',body:form});check(meta.kind+' material ready',u.batch.status==='ready');await commit(u.batch);materialCount+=meta.rows;
 }
 const totalFacts=count+materialCount;
 check('current master and arrival facts formally saved',(await DB.prepare('SELECT COUNT(*) n FROM business_facts').first()).n===totalFacts);
 const domain=[];
 for(const p of raw.products)domain.push({id:p.id,kind:'products',payload:{id:p.id,name:p.name,roleId:p.role_id}});
 for(const s of raw.skus)domain.push({id:s.id,kind:'skus',payload:{id:s.id,name:s.name,product_id:s.product_id,role_id:s.role_id}});
 for(const r of raw.product_roles)domain.push({id:r.id,kind:'roles',payload:{id:r.id,name:r.name,purpose:r.purpose}});
 const lastVersions=new Map();for(const p of raw.arrival_plan_versions)if(!lastVersions.has(p.plan_id)||p.version>lastVersions.get(p.plan_id).version)lastVersions.set(p.plan_id,p);
 const received=new Set(raw.arrival_receipts.map(r=>r.plan_id));
 for(const p of lastVersions.values())if(!received.has(p.plan_id))domain.push({id:p.plan_id,kind:'arrivals',payload:{id:p.plan_id,skuId:p.sku_id,warehouseId:p.warehouse_id,units:p.units,date:p.planned_eta,syntheticBusinessKnownAt:p.known_at}});
 await ok('agent-domain',{method:'POST',body:{dataNature:'demo',records:domain}});checks.push('master and current arrival data uses existing accepted domain API');
 // Ontology staging, type mapping, commit, quality projection and metrics.
 const activeDefinition=(await ok('ontology/definitions?dataNature=demo')).definition;
 check('uses current published mapping',typeof activeDefinition.version==='string'&&activeDefinition.version.length>0);
 for(const meta of manifest.ontologyImports){
  const form=new FormData();for(const[k,v]of Object.entries({typeId:meta.typeId,definitionId:activeDefinition.version,dataNature:'demo',sourceName:'SYNTHETIC_DEMO isolated master '+meta.typeId}))form.set(k,v);form.set('file',new File([await fs.readFile(path.join(out,meta.file))],path.basename(meta.file)));
  const u=await ok('ontology/imports?dataNature=demo',{method:'POST',body:form});check(meta.typeId+' ontology ready/committed',['ready','committed'].includes(u.batch.status));
  await ok('ontology/actions/submit?dataNature=demo',{method:'POST',body:{dataNature:'demo',requestId:'sim-master-'+u.batch.id,action:'commit_import',batchId:u.batch.id}});
 }
 for(const name of ['full24','current8','previous8']){
  const e=expected.periods[name];const s=await snap({asOf:e.asOf,periodStart:e.periodStart,periodEnd:e.periodEnd});compare(s,e,name);snapshots[name]=s;
  check(name+' same tenant/status',s.businessId===business&&s.dataNature==='demo'&&s.dataStatus==='demo');
  for(const ch of s.data.channels){const oracle=e.channels[ch.channel].financial;check(name+' '+ch.channel+' channels',ch.netRevenueCents===oracle.netRevenueCents&&ch.spendCents===oracle.spendCents&&ch.paidOrders===oracle.paidOrders);}
 }
 check('full24 has 24 complete calendar weeks',snapshots.full24.data.weeks.length===24);
 for(let i=0;i<24;i++){const actual=snapshots.full24.data.weeks[i],e=expected.weekly[i];check(`week ${i+1} financial and event mapping`,actual.paidOrders===e.financial.paidOrders&&actual.netRevenueCents===e.financial.netRevenueCents&&actual.spendCents===e.financial.spendCents&&JSON.stringify(actual.events)===JSON.stringify(e.events));}
 // Test all 8 product/channel scopes without changing the application to satisfy data.
 for(const [key,e]of Object.entries(expected.periods.current8.productChannel)){
  const[productId,channel]=key.split('|');compare(await snap({productId,channel}),e,key);
 }
 const current=snapshots.current8;
 const returnedDomain=await ok(`agent-domain?dataNature=demo&snapshotId=${current.id}`);
 const screen=enrichSavedDomain(savedNeoData(current),current,returnedDomain);snapshots.demoProjection=screen;
 for(const product of screen.products){const e=expected.periods.current8.products[product.id];check(product.id+' Demo product net units',product.netQuantity8w===e.netUnits);check(product.id+' Demo current sellable units',product.sellableUnits===e.inventory.reduce((n,r)=>n+r.sellable_units,0));check(product.id+' Demo coverage days',product.coverageDays===e.coverageDays);check(product.id+' Demo known arrival date',product.eta===e.eta);}
 check('Demo financial yuan conversion',screen.financial.netRevenue===expected.periods.current8.financial.netRevenueCents/100);
 for(const role of screen.productRoles){const e=expected.periods.current8.supply.find(r=>raw.product_roles.find(x=>x.id===r.roleId)?.external_id===role.id);check(role.id+' Demo role stock cost and SKU count',role.skuCount===e.skuCount&&Math.round(role.currentInventoryCost*100)===e.inventoryCostCents);}
 check('Demo does not invent customer ratio without order contact identities',screen.conversion.rateNote.includes('不')||screen.conversion.rateNote.includes('待'));
 const build=await ok('ontology/actions/submit?dataNature=demo',{method:'POST',body:{action:'build_projection',dataNature:'demo',requestId:'sim-build-'+current.id,snapshotId:current.id}});
 check('ontology quality has no errors',!build.result.issues.some(x=>x.severity==='error'));
 const metrics=await ok('ontology/functions/metrics/runs?dataNature=demo',{method:'POST',body:{dataNature:'demo',buildId:build.result.id,requestId:'sim-metrics-'+build.result.id}});check('ontology metrics match CSV oracle',JSON.stringify(metrics.result.data.financial)===JSON.stringify(expected.periods.current8.financial));
 const ev=await ok(`evidence/${encodeURIComponent(current.evidenceIds.netRevenueCents)}?limit=1`);check('evidence references source records',ev.evidence.sourceCount>0&&ev.records.length===1&&raw.orders.some(r=>r.source_record_id===JSON.parse(ev.records[0].payload).source_record_id));
 check('reader cannot commit',(await request(`ingestion-batches/${first.batch.id}/commit`,{method:'POST',body:{validationVersion:first.batch.validation_version},rt:{...runtime,local:{...runtime.local,userId:'synthetic-reader'}}})).status===403);
 check('unregistered identity cannot read',(await request('operating-snapshot?dataNature=demo',{rt:{...runtime,local:{...runtime.local,userId:'synthetic-unregistered'}}})).status===403);
 const empty=await snap({channel:'sim-no-data'});check('empty channel financial/events never fallback',empty.data.financial.netRevenueCents===null&&empty.data.events.A1===null);
 // Counterexamples stage against the same isolated enterprise but never commit bad cases.
 const cases=JSON.parse(await fs.readFile(path.join(out,'counterexamples/cases.json'),'utf8'));const statuses=[];
 for(const c of cases.filter(c=>c.file)){
  const original=manifest.importBatches.find(b=>b.kind===c.kind);const meta={...original,file:c.file};
  if(c.id==='legitimate-zero-stock'){meta.coverageStart='2026-09-25';meta.coverageEnd='2026-09-25';}
  const u=await upload(meta,await fs.readFile(path.join(out,c.file)));
  const wanted=['missing-required','missing-channel','negative-amount','unmatched-refund','content-conflict'].includes(c.id)?'invalid':'ready';
  check(c.id+' expected existing validator result',u.batch.status===wanted||c.id==='exact-duplicate'&&u.batch.status==='ready');
  statuses.push({id:c.id,status:u.batch.status,imported:false,expected:c.expectation});
 }
 // Already committed batches may be replayed without needing a version check; test a ready batch.
 const readyCase=cases.find(c=>c.id==='late-record');const staged=await upload({...first.meta,file:readyCase.file},await fs.readFile(path.join(out,readyCase.file)));
 const wrong=await request(`ingestion-batches/${staged.batch.id}/commit`,{method:'POST',body:{validationVersion:999}});check('ready batch version conflict',wrong.status===409);
 check('counterexamples not in normal committed facts',(await DB.prepare('SELECT COUNT(*) n FROM business_facts').first()).n===totalFacts);
 const reread=await ok(`operating-snapshot?dataNature=demo&snapshotId=${current.id}`);check('old normal snapshot still identical',JSON.stringify(reread.snapshot)===JSON.stringify(current));
 check('no agent runs or real market evidence inserted',(await DB.prepare('SELECT COUNT(*) n FROM neo_runs').first()).n===0&&(await DB.prepare('SELECT COUNT(*) n FROM neo_market_evidence').first()).n===0);
 // Accepted boundary cases are committed only in a different fresh generated runtime.
 const counterRoot=path.join(out,'runtime-counterexamples');await fs.mkdir(counterRoot,{recursive:true});
 const counterState=await fs.mkdtemp(path.join(counterRoot,'run-'));
 const cmf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('counterexamples-only')}}",compatibilityDate:'2026-05-22',d1Databases:{DB:'20261004-0000-4000-8000-000000000002'},r2Buckets:{RAW_FILES:'counterexample-raw'},d1Persist:path.join(counterState,'d1'),r2Persist:path.join(counterState,'r2')});
 try{
  const CDB=await cmf.getD1Database('DB'),CR2=await cmf.getR2Bucket('RAW_FILES');const cruntime={DB:disablePatrolWrites(CDB),RAW_FILES:CR2,local:{enabled:true,development:true,userId:'synthetic-owner'}};
  for(const name of(await fs.readdir(path.join(root,'drizzle'))).filter(x=>x.endsWith('.sql')).sort()){
   const sql=(await fs.readFile(path.join(root,'drizzle',name),'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean);await CDB.batch(sql.map(s=>CDB.prepare(s)));
  }
  await CDB.batch([CDB.prepare('INSERT INTO businesses(id,name) VALUES(?,?)').bind(business,'NEO 隔离模拟企业'),CDB.prepare('INSERT INTO business_members(id,business_id,user_id,role) VALUES(?,?,?,?)').bind('sim-counter-member',business,'synthetic-owner','admin')]);
  const costCase=cases.find(c=>c.id==='missing-cost');const orderMeta={...manifest.importBatches.find(b=>b.kind==='orders'),sourceName:'SYNTHETIC_DEMO counterexample orders',file:costCase.file};
  const costStage=await upload(orderMeta,await fs.readFile(path.join(out,costCase.file)),cruntime);await commit(costStage.batch,cruntime);
  const expenseMeta={...manifest.importBatches.find(b=>b.kind==='expenses'),sourceName:'SYNTHETIC_DEMO counterexample expenses'};const expenseStage=await upload(expenseMeta,await fs.readFile(path.join(out,expenseMeta.file)),cruntime);await commit(expenseStage.batch,cruntime);
  const caseScope={dataNature:'demo',asOf:orderMeta.coverageEnd,periodStart:orderMeta.coverageStart,periodEnd:orderMeta.coverageEnd};
  const caseOld=(await ok('operating-snapshots',{method:'POST',body:caseScope,rt:cruntime})).snapshot;
  check('isolated missing cost returns null variable cost and margin',caseOld.data.financial.variableCostCents===null&&caseOld.data.financial.contributionMarginCents===null);
  const lateMeta={...first.meta,sourceName:'SYNTHETIC_DEMO counterexample events',file:readyCase.file};const lateStage=await upload(lateMeta,await fs.readFile(path.join(out,readyCase.file)),cruntime);await commit(lateStage.batch,cruntime);
  const caseFresh=(await ok('operating-snapshots',{method:'POST',body:caseScope,rt:cruntime})).snapshot;
  check('late record creates new snapshot without backfilling old',caseFresh.id!==caseOld.id&&caseOld.data.events.A1===null&&caseFresh.data.events.A1===1);
  const caseReread=await ok(`operating-snapshot?dataNature=demo&snapshotId=${caseOld.id}`,{rt:cruntime});check('late input old snapshot readback unchanged',JSON.stringify(caseReread.snapshot)===JSON.stringify(caseOld));
  const zeroCase=cases.find(c=>c.id==='legitimate-zero-stock');const zeroMeta={...manifest.importBatches.find(b=>b.kind==='inventory'),sourceName:'SYNTHETIC_DEMO counterexample inventory',file:zeroCase.file,coverageStart:'2026-09-25',coverageEnd:'2026-09-25'};
  const zeroStage=await upload(zeroMeta,await fs.readFile(path.join(out,zeroCase.file)),cruntime);await commit(zeroStage.batch,cruntime);
  const zeroSnap=(await ok('operating-snapshots',{method:'POST',body:{...caseScope,asOf:'2026-09-25'},rt:cruntime})).snapshot;check('isolated zero stock and valuation remain zero',zeroSnap.data.inventory[0].sellable_units===0&&zeroSnap.data.inventoryCostCents===0);
  await fs.writeFile(path.join(out,'reports/counterexample-readbacks.json'),JSON.stringify({runtimeRoot:counterState,businessId:business,missingCostSnapshot:caseOld,lateInputSnapshot:caseFresh,zeroInventorySnapshot:zeroSnap},null,2)+'\n');
 }finally{await cmf.dispose();}
 check('committed boundary cases never alter normal fact count',(await DB.prepare('SELECT COUNT(*) n FROM business_facts').first()).n===totalFacts);
 await fs.mkdir(path.join(out,'reports'),{recursive:true});
 const gaps=['This tool exercises template-v1 facts plus template-v2 master/arrival records; full24 order/customer linking has separate acceptance','Historical business known_at and customer cohorts are independently checked by oracle/validate; not projected here','Only checks scope and metrics explicitly named in this report; no overall frontend completeness claim','Forecast/scenario value and online model calls are not tested here','Fictional market events stay in sidecar; no real market evidence inserted'];
 await fs.writeFile(path.join(out,'reports/backend-validation.json'),JSON.stringify({status:'passed',checksPassed:checks.length,checks,normalCommittedFacts:totalFacts,normalBatches:24,materialFacts:materialCount,ontologyBuildId:build.result.id,runtimeRoot:state,businessId:business,dataNature:'demo',autoPatrol:false,patrolGuard:'test-only D1 proxy blocks only writes to neo_runs/neo_sessions; original route catches and reports not_queued',blockedPatrolWrites,externalModelCalls:0,counterexamples:statuses,gaps,reviewStatus:'executed_current_source; independent product acceptance separate'},null,2)+'\n');
 await fs.writeFile(path.join(out,'reports/product-readbacks.json'),JSON.stringify(snapshots,null,2)+'\n');
 console.log(JSON.stringify({status:'passed',checksPassed:checks.length,normalCommittedFacts:totalFacts,ontologyBuildId:build.result.id}));
}finally{await mf.dispose();}
