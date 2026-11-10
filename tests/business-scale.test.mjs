import assert from 'node:assert/strict';
import {test} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {loadGeneration} from '../server/generation-storage.ts';

test('100,000 published facts: exact canonical totals, durable full generation and compact readback',async(t)=>{
 const {mf,runtime}=await localRuntime();const db=runtime.DB;
 try{
  const now=new Date().toISOString(),profile={industry:'ecommerce',name:'规模验收',timezone:'Asia/Shanghai',region:'CN',horizonDays:28,objective:'contribution_margin',cashBudgetCents:100000,expectedSources:[{sourceId:'erp',kinds:['order','expense','inventory','fulfillment_rule']}],competitors:[]};
  await db.prepare('INSERT INTO neo_business_profiles VALUES(?,?,?,?,?,?)').bind('scale-profile','test-a','demo',1,JSON.stringify(profile),now).run();
  // Seed performance data directly so this test measures aggregation/storage,
  // not HTTP chunk upload throughput. Upload correctness is tested separately.
  for(let chunk=0;chunk<50;chunk++){
   const rows=Array.from({length:2000},(_,n)=>{const id='scale-'+(chunk*2000+n);return {id,payload:JSON.stringify({recordKey:id,kind:'order',businessDate:'2026-09-10',entityId:'sku',channelId:'shop',orderId:id,entryType:'paid',quantity:1,amountCents:1000,variableCostCents:200})};});
   await db.prepare("INSERT INTO neo_business_inputs(id,business_id,data_nature,source_id,record_key,revision,kind,business_date,known_at,payload,content_hash) SELECT json_extract(value,'$.id'),'test-a','demo','erp',json_extract(value,'$.id'),1,'order','2026-09-10',?,json_extract(value,'$.payload'),'scale-fixture' FROM json_each(?)").bind(now,JSON.stringify(rows)).run();
  }
  const coverage=['order','expense','inventory','fulfillment_rule'].map(kind=>({kind,sourceId:'erp',start:'2026-09-01',end:'2026-09-30'}));
  await db.prepare('INSERT INTO neo_business_imports VALUES(?,?,?,?,?,?,?,?)').bind('scale-import','test-a','demo','scale','hash','erp',JSON.stringify({coverage}),now).run();
  for(const r of [{kind:'inventory',recordKey:'stock',entityId:'sku',warehouseId:'east',quantity:50000},{kind:'fulfillment_rule',recordKey:'rule',entityId:'sku',warehouseId:'east',channelId:'shop',leadDays:0,costCents:0}])await db.prepare('INSERT INTO neo_business_inputs(id,business_id,data_nature,source_id,record_key,revision,kind,business_date,known_at,supersedes_id,payload,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(r.recordKey,'test-a','demo','erp',r.recordKey,1,r.kind,'2026-09-30',now,null,JSON.stringify({...r,businessDate:'2026-09-30'}),'hash').run();
  const at=new Date().toISOString();await db.prepare("INSERT INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,created_at) VALUES('scale-update','test-a','demo','import','scale-import','pending',?)").bind(at).run();
  const started=performance.now(),rssBefore=process.memoryUsage().rss;
  const request=new Request('http://localhost/api/v1/business-updates?businessId=test-a',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({dataNature:'demo'})});
  const response=await handleApi(request,runtime),result=await response.json();assert.equal(response.status,200);assert.equal(result.results[0].status,'completed',JSON.stringify(result));
  const generationMs=performance.now()-started;
  const stored=await db.prepare('SELECT payload FROM neo_business_generations WHERE id=?').bind(result.results[0].generationId).first();assert.equal(JSON.parse(stored.payload).storageFormat,'neo-generation-r2-v1');
  const g=await loadGeneration({db,runtime,businessId:'test-a',businessName:'scale',role:'admin',userId:'local-owner'},'demo',stored.payload);
  assert.equal(g.state.inputs.length,100002);assert.equal(g.state.metrics.netRevenueCents.value,100000000);assert.equal(g.state.metrics.variableCostCents.value,20000000);assert.equal(g.state.metrics.paidOrders.value,100000);assert.equal(g.baseline.totals.fulfilled,50000);
  const read=await handleApi(new Request('http://localhost/api/v1/business-generations?businessId=test-a&dataNature=demo'),runtime);const raw=await read.text();assert.ok(raw.length<50000);assert.equal(JSON.parse(raw).generations[0].state.inputCount,100002);
  const viewStarted=performance.now();const view=await handleApi(new Request('http://localhost/api/v1/business-workbench?businessId=test-a&dataNature=demo'),runtime);assert.equal(view.status,200);const viewBytes=await view.text();assert.equal(JSON.parse(viewBytes).generation.state.inputCount,100002);assert.ok(Buffer.byteLength(viewBytes)<150000);
  t.diagnostic(JSON.stringify({facts:100000,generationMs:Math.round(generationMs),workbenchMs:Math.round(performance.now()-viewStarted),workbenchBytes:Buffer.byteLength(viewBytes),rssBefore,rssAfter:process.memoryUsage().rss,scope:'single process temporary D1/R2; excludes upload throughput and concurrent users'}));
  const other=await handleApi(new Request('http://localhost/api/v1/business-generations?businessId=test-b&dataNature=demo'),runtime);assert.equal((await other.json()).generations.length,0);
 }finally{await mf.dispose();}
});
