import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {financialMetrics} from '../lib/business-metrics.ts';
import {validateBusinessInput} from '../lib/business-state.ts';
let mf,runtime;
before(async()=>{({mf,runtime}=await localRuntime());for(const industry of ['hotel','ecommerce','manufacturing'])for(const suffix of ['a','b']){const id=industry+'-'+suffix;await runtime.DB.batch([runtime.DB.prepare('INSERT INTO businesses(id,name) VALUES(?,?)').bind(id,id),runtime.DB.prepare("INSERT INTO business_members(id,business_id,user_id,role) VALUES(?,?,'local-owner','admin')").bind(id+'-owner',id)]);}});after(async()=>await mf?.dispose());
const profile=industry=>({industry,timezone:'Asia/Shanghai',name:industry+'验收企业',region:'CN',horizonDays:28,objective:'contribution_margin',cashBudgetCents:100000,competitors:[],expectedSources:[{sourceId:'erp',kinds:industry==='hotel'?['hotel_stay','hotel_capacity','event','expense']:industry==='manufacturing'?['order','expense','inventory','bom','material_inventory','production_capacity','production','event']:['order','expense','inventory','event','fulfillment_rule','arrival']}]});
async function api(path,method='GET',body,business='test-a',rt=runtime){const r=await handleApi(new Request(`http://localhost/api/v1/${path}${path.includes('?')?'&':'?'}businessId=${business}`,{method,headers:{origin:'http://localhost',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}
const record=(kind,key,extra={})=>({kind,recordKey:key,entityId:'sku-a',businessDate:'2026-09-10',...extra});
test('canonical financial completeness, zero, missing costs, source gaps and overflow',()=>{
 const rows=[{kind:'orders',id:'o',sourceId:'erp',fact:{entry_type:'paid',order_id:'o',amount_cents:1000,variable_cost_cents:400}},{kind:'expenses',id:'e',sourceId:'erp',fact:{amount_cents:100}}];
 const spans=['orders','expenses'].map(kind=>({kind,sourceId:'erp',start:'2026-09-01',end:'2026-09-30'}));
 assert.equal(financialMetrics(rows,spans,'2026-09-01','2026-09-30').contributionMarginCents.value,500);
 assert.equal(financialMetrics(rows,spans.slice(0,1),'2026-09-01','2026-09-30').contributionMarginCents.value,null);
 assert.equal(financialMetrics([],spans,'2026-09-01','2026-09-30').netRevenueCents.value,0);
 assert.equal(financialMetrics([],[],'2026-09-01','2026-09-30').netRevenueCents.value,null);
 assert.equal(financialMetrics([{...rows[0],fact:{...rows[0].fact,variable_cost_cents:null}},rows[1]],spans,'2026-09-01','2026-09-30').contributionMarginCents.value,null);
 assert.throws(()=>validateBusinessInput(record('production','p',{quantity:1,warehouseId:'w',workCenterId:'c',status:'completed',leadDays:1}),'hotel'),/行业/);
 assert.throws(()=>validateBusinessInput(record('order','o',{quantity:-1,amountCents:0,entryType:'paid',orderId:'x'}),'ecommerce'),/非负/);
});
test('three industries × two tenants: real API import → canonical state, no company-specific code',async()=>{
 for(const industry of ['hotel','ecommerce','manufacturing'])for(const suffix of ['a','b']){
  const business=industry+'-'+suffix;
  const own=await api('business-profile','GET',undefined,business);
  const configured=await api('business-profile','POST',{dataNature:'demo',baseVersion:own.data.profile?.version??null,profile:profile(industry)},business);assert.equal(configured.status,201,JSON.stringify(configured));
  const order=industry==='hotel'?record('hotel_stay',industry+'stay',{quantity:2,amountCents:20000,variableCostCents:5000,customerId:'customer-a'}):record('order',industry+'order',{quantity:2,amountCents:20000,variableCostCents:5000,entryType:'paid',orderId:industry+'order',customerId:'customer-a'});
  const records=[order,record('expense',industry+'spend',{amountCents:1000})];
  const body={dataNature:'demo',requestId:industry+'initial',sourceId:'erp',records,expectedRowCount:2,expectedTotals:{amountCents:21000},coverageKinds:[industry==='hotel'?'hotel_stay':'order','expense'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30'};
  const imported=await api('business-inputs','POST',body,business);assert.equal(imported.status,201,JSON.stringify(imported));
  assert.equal((await api('business-inputs','POST',body,business)).data.reused,true);
  const read=await api('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30','GET',undefined,business);assert.equal(read.status,200,JSON.stringify(read));
  assert.equal(read.data.state.profile.industry,industry);
  assert.equal(read.data.state.metrics.netRevenueCents.value,20000);
  assert.equal(read.data.state.businessId,business);
 }
});
test('input corrections require explicit previous ID; old knowledge cutoff remains unchanged',async()=>{
 const own=(path,method='GET',body)=>api(path,method,body,'manufacturing-a');
 const state=await own('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30'),original=state.data.state.inputs.find(r=>r.recordKey==='manufacturingorder'),cutoff=state.data.state.knownAt;
 const corrected=record('order','manufacturingorder',{quantity:3,amountCents:30000,variableCostCents:6000,entryType:'paid',orderId:'manufacturingorder',customerId:'customer-a'});
 const body={dataNature:'demo',requestId:'correction',sourceId:'erp',records:[corrected],expectedRowCount:1,coverageKinds:['order'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30'};
 assert.equal((await own('business-inputs','POST',body)).status,409);
 const fixed=await own('business-inputs','POST',{...body,records:[{...corrected,supersedesId:original.id}]});assert.equal(fixed.status,201,JSON.stringify(fixed));
 const updated=await own('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30');assert.equal(updated.data.state.metrics.netRevenueCents.value,30000);
 const old=await own('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30&knownAt='+encodeURIComponent(cutoff));assert.equal(old.data.state.metrics.netRevenueCents.value,20000);
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};assert.equal((await api('business-inputs','POST',body,'test-a',reader)).status,403);
 const denied={...runtime,local:{...runtime.local,userId:'local-b-only'}};assert.equal((await api('business-state','GET',undefined,'test-a',denied)).status,403);
 assert.equal((await own('business-inputs','POST',{...body,requestId:'bad-totals',expectedTotals:{amountCents:1}})).status,422);
});

test('persistent generations advance automatically on import and profile publication; retry and leases are scoped',async()=>{
 const business='ecommerce-b',own=(path,method='GET',body)=>api(path,method,body,business);
 const before=await own('business-generations');assert.ok(before.data.generations.length>=2);
 assert.ok(before.data.generations.some(g=>g.state.metrics.netRevenueCents.value===20000));
 const current=(await own('business-profile')).data.profile;
 const published=await own('business-profile','POST',{dataNature:'demo',baseVersion:current.version,profile:{...current.settings,cashBudgetCents:50000}});assert.equal(published.status,201);
 const after=await own('business-generations');assert.ok(after.data.generations.some(g=>g.state.profile.cashBudgetCents===50000));
 assert.notEqual(after.data.generations[0].sourceKey,before.data.generations[0].sourceKey);
 const updates=await own('business-updates');assert.ok(updates.data.updates.every(e=>e.status==='completed'));
 const now=new Date().toISOString(),id='lease-test';
 await runtime.DB.prepare("INSERT INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,lease_until,created_at) VALUES(?,?,'demo','import','test','running',?,?)").bind(id,business,'2000-01-01T00:00:00.000Z',now).run();
 const drained=await own('business-updates','POST',{dataNature:'demo'});assert.ok(drained.data.results.some(r=>r.updateId===id&&r.status==='completed'));
 assert.equal((await api('business-updates/'+id,'POST',{dataNature:'demo'},'ecommerce-a')).status,409);
 await runtime.DB.prepare("UPDATE neo_business_updates SET status='failed',last_error='TEST' WHERE id=?").bind(id).run();
 assert.equal((await own('business-updates/'+id,'POST',{dataNature:'demo'})).data.results[0].status,'completed');
});

test('scenario APIs calculate from frozen generation and preserve scope/idempotency',async()=>{
 const own=(path,method='GET',body)=>api(path,method,body,'ecommerce-b');
 const generation=(await own('business-generations')).data.generations[0];
 const body={dataNature:'demo',requestId:'compare',generationId:generation.id,scenarios:[{id:'baseline',name:'维持现状',demandBps:10000,actions:[]}]};
 const saved=await own('business-scenarios','POST',body);assert.equal(saved.status,201,JSON.stringify(saved));assert.equal(saved.data.results[0].status,'insufficient');assert.equal(saved.data.recommendation.scenarioId,null);
 assert.equal((await own('business-scenarios','POST',body)).data.reused,true);
 assert.equal((await own('business-scenarios','POST',{...body,scenarios:[{...body.scenarios[0],demandBps:12000}]})).status,409);
 assert.equal((await api('business-scenarios','POST',body,'ecommerce-a')).status,404);
 const list=(await own('business-scenarios/'+saved.data.id)).data.bundles;assert.equal(list.length,1);assert.equal(list[0].generationId,generation.id);
});
test('saved decision → evidence-backed execution → new actual inputs → closed-window outcome',async()=>{
 const own=(path,method='GET',body)=>api(path,method,body,'ecommerce-a');
 const p=(await own('business-profile')).data.profile;
 assert.equal((await own('business-profile','POST',{dataNature:'demo',baseVersion:p.version,profile:{...p.settings,horizonDays:3}})).status,201);
 const ingest=(requestId,records,kinds,start,end)=>own('business-inputs','POST',{dataNature:'demo',requestId,sourceId:'erp',records,expectedRowCount:records.length,coverageKinds:kinds,coverageStart:start,coverageEnd:end});
 const supplied=await ingest('constraints',[record('inventory','stock',{businessDate:'2026-09-30',warehouseId:'east',quantity:3}),record('fulfillment_rule','rule',{businessDate:'2026-09-30',warehouseId:'east',channelId:'shop',leadDays:0,costCents:0})],['inventory','fulfillment_rule'],'2026-09-30','2026-10-03');assert.equal(supplied.status,201);
 const original=(await own('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30')).data.state.inputs.find(r=>r.kind==='order');
 // Purchase source originally omitted channel. Correct it explicitly rather than relabeling historical inputs.
 assert.equal((await ingest('channel-correction',[{...record('order','ecommerceorder',{quantity:2,amountCents:20000,variableCostCents:5000,entryType:'paid',orderId:'ecommerceorder',customerId:'customer-a',channelId:'shop'}),supersedesId:original.id}],['order'],'2026-09-01','2026-09-30')).status,201);
 const g=(await own('business-generations')).data.generations[0];assert.equal(g.baseline.status,'calculated',JSON.stringify(g.baseline));
 const scenario={id:'supply',name:'确认补货',demandBps:10000,actions:[{kind:'arrival',entityId:'sku-a',warehouseId:'east',date:'2026-10-01',quantity:1,leadDays:0,costCents:500,confirmed:true}]};
 const b=await own('business-scenarios','POST',{dataNature:'demo',requestId:'supply',generationId:g.id,scenarios:[scenario]});assert.equal(b.status,201);
 const d=await own('business-decisions','POST',{dataNature:'demo',requestId:'choice',bundleId:b.data.id,scenarioId:'supply'});assert.equal(d.status,201,JSON.stringify(d));assert.equal(d.data.status,'saved_decision');
 const early=await own('business-outcomes','POST',{dataNature:'demo',requestId:'experience-early',decisionId:d.data.id,confirmed:true});assert.equal(early.status,201);assert.equal(early.data.status,'inactive');assert.equal(early.data.supportStatus,'insufficient');
 const execution={dataNature:'demo',requestId:'execution',decisionId:d.data.id,actionIndex:0,status:'executed',executionDate:'2026-10-01',quantity:1,costCents:500,proofIds:[]};
 assert.equal((await own('business-executions','POST',execution)).status,422);
 assert.equal((await ingest('receipt',[record('arrival','receipt',{businessDate:'2026-10-01',warehouseId:'east',quantity:1,costCents:500,status:'completed'})],['arrival'],'2026-10-01','2026-10-03')).status,201);
 const receipt=(await own('business-state?asOf=2026-10-03&start=2026-10-01&end=2026-10-03')).data.state.inputs.find(r=>r.recordKey==='receipt');
 const e=await own('business-executions','POST',{...execution,proofIds:[receipt.id]});assert.equal(e.status,201,JSON.stringify(e));
 assert.equal((await own('business-executions','POST',{...execution,requestId:'false-quantity',quantity:2,proofIds:[receipt.id]})).status,422);
 assert.equal((await ingest('actuals',[record('order','actual',{businessDate:'2026-10-02',quantity:3,amountCents:30000,variableCostCents:6000,entryType:'paid',orderId:'actual',channelId:'shop'}),record('expense','actual-spend',{businessDate:'2026-10-02',amountCents:500})],['order','expense'],'2026-10-01','2026-10-03')).status,201);
 const outcome=await own('business-outcomes/'+d.data.id);assert.equal(outcome.status,200);assert.equal(outcome.data.status,'complete');assert.equal(outcome.data.actual.fulfilled,3);assert.equal(outcome.data.actual.contributionMarginCents,23500);assert.equal(outcome.data.executions.length,1);assert.match(outcome.data.notice,/不能.*归因/);
 assert.equal((await api('business-outcomes/'+d.data.id,'GET',undefined,'ecommerce-b')).status,404);
 const confirmed=await own('business-outcomes','POST',{dataNature:'demo',requestId:'experience-final',decisionId:d.data.id,confirmed:true});assert.equal(confirmed.status,201);assert.equal(confirmed.data.status,'active');assert.equal(confirmed.data.attribution,'not_identified');assert.equal(confirmed.data.supportStatus,'supported');
 const replay=await own('business-outcomes','POST',{dataNature:'demo',requestId:'experience-final',decisionId:d.data.id,confirmed:true});assert.equal(replay.data.id,confirmed.data.id);
 assert.equal((await own('business-outcomes','POST',{dataNature:'demo',requestId:'not-confirmed',decisionId:d.data.id,confirmed:false})).status,422);
});
test('operating review gateway uses server-frozen scope, capped budget and model-aware idempotency; GET never dispatches',async()=>{
 const {createServer}=await import('node:http');let submitted=[],requests=0;
 const server=createServer(async(req,res)=>{requests++;const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
  res.setHeader('content-type','application/json');
  if(req.url==='/health')return res.end(JSON.stringify({modelConfigured:true,model:'isolated-test-model'}));
  if(req.method==='POST'&&req.url==='/runs')submitted.push(body);
  const job=body??submitted[0];res.end(JSON.stringify({id:job?.id,status:'queued',businessId:job?.businessId,snapshotId:job?.snapshotId,dataNature:job?.dataNature,steps:[],result:null}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const rt={...runtime,agentExecutionMode:'live',NEO_AGENT_URL:'http://127.0.0.1:'+server.address().port,NEO_SERVICE_TOKEN:'isolated-service-token-'.repeat(2)};
 try{
  const own=(path,method='GET',body)=>api(path,method,body,'ecommerce-b',rt);const g=(await own('business-generations')).data.generations[0];
  assert.equal((await own('business-reviews/'+g.id)).data.status,'not_generated');assert.equal(requests,0);
  const input={dataNature:'demo',generationId:g.id,envelope:{businessId:'foreign'},budget:{maxModelCalls:32}};
  const started=await own('business-reviews','POST',input);assert.equal(started.status,202,JSON.stringify(started));assert.equal(submitted.length,1);
  const job=submitted[0];assert.equal(job.purpose,'operating');assert.equal(job.envelope.operatingBasis.generationId,g.id);assert.equal(job.envelope.snapshot.businessId,'ecommerce-b');assert.equal(job.budget.maxModelCalls,null);assert.equal(job.envelope.operatingBasis.modelIdentity,'isolated-test-model');
  assert.equal((await own('business-reviews','POST',input)).data.id,started.data.id);assert.equal(submitted.length,1);
  const count=requests;assert.equal((await own('business-reviews/'+g.id)).data.status,'queued');assert.equal(requests,count);
  assert.equal((await api('business-reviews','POST',input,'ecommerce-a',rt)).status,404);
  const typed=await own('business-reviews','POST',{dataNature:'demo',generationId:g.id,refreshId:'typed-decide',question:'优先选择哪个',mode:'joint',scenarios:[{id:'one',name:'现状',demandBps:10000,actions:[]},{id:'two',name:'需求条件',demandBps:11000,actions:[]}]});
  assert.equal(typed.status,202,JSON.stringify(typed));const typedJob=submitted.at(-1);assert.equal(typedJob.taskType,'DECIDE');assert.equal(typedJob.budget.maxModelCalls,null);assert.equal(typedJob.envelope.operatingBasis.scenarioContext.results.length,2);assert.ok(typedJob.envelope.operatingBasis.scenarioContext.results.every(r=>r.inputGeneration===g.id));
  const follow=await own('business-reviews','POST',{dataNature:'demo',generationId:g.id,refreshId:'typed-continue',question:'继续核对条件',mode:'joint',sessionId:typed.data.sessionId});assert.equal(follow.status,202,JSON.stringify(follow));assert.deepEqual(submitted.at(-1).envelope.operatingBasis.scenarioContext.results,typedJob.envelope.operatingBasis.scenarioContext.results);
  const focused=await own('business-reviews','POST',{dataNature:'demo',generationId:g.id,refreshId:'scope-first',question:'核对当前SKU',mode:'conversion',dialogueScope:{entityId:'sku-a',period:{start:'2026-09-01',end:'2026-09-02'}}});assert.equal(focused.status,202,JSON.stringify(focused));
  const focusBasis=submitted.at(-1).envelope.operatingBasis;assert.equal(focusBasis.metrics.paidOrders.value,0);assert.ok(focusBasis.generalContext.metrics.paidOrders.value>0);assert.deepEqual(focusBasis.diagnostics.scope,focusBasis.metricScope);
  const followScope=await own('business-reviews','POST',{dataNature:'demo',generationId:g.id,refreshId:'scope-follow',question:'那库存呢',mode:'supply',sessionId:focused.data.sessionId});assert.equal(followScope.status,202,JSON.stringify(followScope));assert.deepEqual(submitted.at(-1).envelope.operatingBasis.metricScope,focusBasis.metricScope);assert.equal(submitted.at(-1).envelope.operatingBasis.metrics.paidOrders.value,0);
  assert.equal((await own('business-reviews','POST',{dataNature:'demo',generationId:g.id,refreshId:'typed-invalid',question:'优先选择哪个',mode:'joint',scenarios:[{id:'bad'}]})).status,422);

 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('saved-record query gateway freezes scoped registry and retains simple budgets and idempotency',async()=>{
 const {operatingReviews,frozenSavedRecordRegistry}=await import('../server/business-reviews.ts');
 const {createServer}=await import('node:http');const submitted=[];
 const server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;res.setHeader('content-type','application/json');if(req.url==='/health')return res.end(JSON.stringify({modelConfigured:true,model:'record-test'}));if(body)submitted.push(body);const job=body??submitted.at(-1);res.end(JSON.stringify({id:job?.id,status:'queued',businessId:job?.businessId,dataNature:job?.dataNature,snapshotId:job?.snapshotId,result:null,steps:[]}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const rt={...runtime,agentExecutionMode:'live',NEO_AGENT_URL:'http://127.0.0.1:'+server.address().port,NEO_SERVICE_TOKEN:'record-test-'.repeat(4)};
  const g=(await api('business-generations','GET',undefined,'ecommerce-b')).data.generations[0];
  const ctx={db:runtime.DB,runtime:rt,businessId:'ecommerce-b',businessName:'record-test',role:'admin',userId:'local-owner'};
  for(const [id,nature,generation] of [['registry-own','demo',g.id],['registry-foreign-nature','business',g.id],['registry-other-generation','demo','other-g']]){
   const value={id,businessId:'ecommerce-b',dataNature:nature,generationId:generation,status:'saved_decision',createdAt:'2026-10-07',reason:'先确认供给',scenario:{id:'supply',name:'确认到货'}};
   await runtime.DB.prepare("INSERT INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,payload,created_at) VALUES(?,?,?,?,'business_decision',?,?,?,?)").bind(id,'ecommerce-b',nature,generation,id,id,JSON.stringify(value),value.createdAt).run();
  }
  const registry=await frozenSavedRecordRegistry(ctx,'demo',g.id);assert.ok(registry.records.some(r=>r.id==='registry-own'));assert.ok(registry.records.every(r=>r.generationId===g.id&&!['registry-foreign-nature','registry-other-generation'].includes(r.id)));assert.match(registry.registryHash,/^[a-f0-9]{64}$/);
  const before=(await runtime.DB.prepare('SELECT COUNT(*) n FROM neo_artifacts').first()).n;
  const interaction={question:'列出已保存选择记录',role:'orchestrator'};
  const started=await operatingReviews(ctx,'demo',g.id,true,'registry-query',interaction);
  const job=submitted.at(-1);assert.equal(job.taskType,'QUERY');assert.equal(job.budget.maxTokens,null);assert.equal(job.budget.maxModelCalls,null);assert.equal(job.envelope.operatingBasis.savedRecords.registryHash,registry.registryHash);
  assert.equal(job.envelope.operatingBasis.savedRecords.records.find(r=>r.id==='registry-own').status,'saved_decision');assert.equal(job.envelope.operatingBasis.savedRecords.records.find(r=>r.id==='registry-own').reasonExcerpt,'先确认供给');
  assert.equal((await operatingReviews(ctx,'demo',g.id,true,'registry-query',interaction)).id,started.id);assert.equal(submitted.length,1);
  assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM neo_artifacts').first()).n,before);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
