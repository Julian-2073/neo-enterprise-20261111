import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {buildBusinessState} from '../lib/business-state.ts';
import {calculateScenario} from '../lib/business-scenarios.ts';
import {projectedMarketReview} from '../server/workbench-projection.ts';
test('audit F01–F06: published ledger, staging conflict, monotonic head, stock conservation, proof and market references',async()=>{
const {mf,runtime}=await localRuntime();
const results=[];
const profile={industry:'ecommerce',timezone:'Asia/Shanghai',name:'只读审查隔离样本',region:'CN',horizonDays:3,objective:'contribution_margin',cashBudgetCents:100000,competitors:[],expectedSources:[{sourceId:'erp',kinds:['order','expense','inventory','fulfillment_rule','arrival']}]};
const req=async(path,body,rt=runtime)=>{const response=await handleApi(new Request('http://localhost/api/v1/'+path+(path.includes('?')?'&':'?')+'businessId=test-a',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),rt);return {status:response.status,data:await response.json()};};
const ingest=(requestId,records,extra={})=>req('business-inputs',{dataNature:'demo',sourceId:'erp',requestId,records,expectedRowCount:records.length,coverageKinds:['order','expense'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30',...extra});
try {
 assert.equal((await req('business-profile',{dataNature:'demo',baseVersion:null,profile})).status,201);
 const orphan={kind:'order',recordKey:'orphan-refund',entityId:'sku',orderId:'nonexistent-order',businessDate:'2026-09-30',entryType:'refund',quantity:5,amountCents:10000,variableCostCents:1000};
 const orphanImport=await ingest('orphan-refund',[orphan]);
 assert.equal(orphanImport.status,422);assert.equal(orphanImport.data.error.code,'BUSINESS_LEDGER');
 const orphanState=(await req('business-state?dataNature=demo&asOf=2026-09-30&start=2026-09-01&end=2026-09-30')).data.state;
 assert.equal(orphanState.metrics.netRevenueCents.value,null);
 results.push({id:'F01',case:'未有支付记录的退款被正式接收',httpStatus:orphanImport.status,netRevenue:orphanState.metrics.netRevenueCents,fulfilled:orphanState.metrics.fulfilledUnits});
 // Reset only ephemeral Miniflare records between cases.
 await runtime.DB.batch(['neo_business_inputs','neo_business_imports','neo_business_updates','neo_business_generations'].map(t=>runtime.DB.prepare('DELETE FROM '+t)));
 const order={kind:'order',recordKey:'fragment-order',entityId:'sku',orderId:'order-one',businessDate:'2026-09-30',entryType:'paid',quantity:10,amountCents:10000,variableCostCents:1000};
 const part=await ingest('unused',[order],{groupId:'incomplete',partIndex:0,partCount:2});assert.equal(part.status,201);
 const standalone=await ingest('standalone',[order]);assert.equal(standalone.status,409);assert.equal(standalone.data.error.code,'IMPORT_PENDING');
 const fragmentState=(await req('business-state?dataNature=demo&asOf=2026-09-30&start=2026-09-01&end=2026-09-30')).data.state;
 assert.equal(fragmentState.metrics.netRevenueCents.value,null);
 results.push({id:'F02',case:'未封存分片抢占正式导入去重键',standaloneReport:standalone.data,inputCount:fragmentState.inputs.length,netRevenue:fragmentState.metrics.netRevenueCents});
 // Two versions, old failed event without any generation, then a newer completed event.
 await runtime.DB.batch(['neo_business_inputs','neo_business_imports','neo_business_updates','neo_business_generations','neo_business_profiles'].map(t=>runtime.DB.prepare('DELETE FROM '+t)));
 const earlier='2026-10-01T00:00:00.000Z',later='2026-10-02T00:00:00.000Z';
 await runtime.DB.batch([
  runtime.DB.prepare("INSERT INTO neo_business_profiles VALUES('old-profile','test-a','demo',1,?,?)").bind(JSON.stringify({...profile,name:'旧企业档案'}),earlier),
  runtime.DB.prepare("INSERT INTO neo_business_profiles VALUES('new-profile','test-a','demo',2,?,?)").bind(JSON.stringify({...profile,name:'新企业档案'}),later),
  runtime.DB.prepare("INSERT INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,created_at) VALUES('old-update','test-a','demo','profile','old-profile','failed',?)").bind(earlier),
  runtime.DB.prepare("INSERT INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,created_at) VALUES('new-update','test-a','demo','profile','new-profile','pending',?)").bind(later),
 ]);
 assert.equal((await req('business-updates',{dataNature:'demo'})).status,200);
 const before=(await req('business-generations?dataNature=demo')).data.generations[0];assert.equal(before.state.profileVersion,'new-profile');
 assert.equal((await req('business-updates/old-update',{dataNature:'demo'})).status,200);
 const after=(await req('business-generations?dataNature=demo')).data.generations[0];assert.equal(after.state.profileVersion,'new-profile');assert.ok((await req('business-generations?dataNature=demo')).data.generations.some(g=>g.state.profileVersion==='old-profile'));
 const workbench=(await req('business-workbench?dataNature=demo')).data;
 assert.equal(workbench.generation.state.profileVersion,'new-profile');const snapshot=(await req('operating-snapshot?dataNature=demo')).data.snapshot;assert.equal(snapshot.id,before.id);
 results.push({id:'F03',case:'旧事件恢复后成为默认最新经营代次',before:{id:before.id,profile:before.state.profileVersion,knownAt:before.state.knownAt},after:{id:after.id,profile:after.state.profileVersion,knownAt:after.state.knownAt},defaultWorkbenchProfile:workbench.generation.state.profileVersion});
 // Pure scenario: registered planned transfer adds at destination but never subtracts origin.
 const frozen=(id,kind,extra)=>({id,recordKey:id,sourceId:'erp',revision:1,knownAt:earlier,businessDate:'2026-09-30',kind,entityId:'sku',...extra});
 const inputs=[frozen('paid','order',{entryType:'paid',orderId:'paid',quantity:21,amountCents:210000,variableCostCents:42000,channelId:'shop'}),frozen('expense','expense',{amountCents:0}),frozen('stock-west','inventory',{warehouseId:'west',quantity:10}),frozen('stock-east','inventory',{warehouseId:'east',quantity:0}),frozen('rule','fulfillment_rule',{warehouseId:'east',channelId:'shop',leadDays:0,costCents:0}),frozen('planned-transfer','arrival',{warehouseId:'east',fromWarehouseId:'west',quantity:6,businessDate:'2026-10-01',status:'planned',costCents:1000})];
 const state=buildBusinessState({businessId:'test-a',dataNature:'demo',profileVersion:'p',profile,asOf:'2026-09-30',knownAt:earlier,start:'2026-09-24',end:'2026-09-30'},inputs,profile.expectedSources[0].kinds.map(kind=>({kind,sourceId:'erp',start:'2026-09-01',end:'2026-10-03'})));
 const forecast=calculateScenario(state,{id:'baseline',name:'现状',demandBps:10000,actions:[]},'isolated');
 assert.equal(forecast.totals.fulfilled,6);assert.equal(forecast.totals.endingSellable,4);assert.equal(forecast.totals.actionCostCents,1000);
 results.push({id:'F04',case:'登记的调拨计划被按新增外购收货计算',initialStock:10,transferQuantity:6,forecast,conservationCheck:forecast.totals.fulfilled+forecast.totals.endingSellable});
 // Valid saved choice, then an unsealed actual receipt fragment used as proof.
 const executionState={...state,inputs:state.inputs.filter(r=>r.id!=='planned-transfer')};
 const executionGeneration={id:'generation-execution-fixture',version:'audit-fixture',sourceKey:'execution-fixture',state:executionState,configuration:{settings:{customerFunnel:null}},baseline:calculateScenario(executionState,{id:'base',name:'现状',demandBps:10000,actions:[]},'generation-execution-fixture'),steps:[],createdAt:new Date().toISOString()};
 await runtime.DB.prepare("INSERT INTO neo_business_generations VALUES(?,?,'demo',?,'calculated',?,?,?)").bind(executionGeneration.id,'test-a',executionGeneration.sourceKey,JSON.stringify(executionGeneration),executionGeneration.createdAt,executionGeneration.createdAt).run();
 const executionSpec={id:'receipt',name:'已确认外购',demandBps:10000,actions:[{kind:'arrival',entityId:'sku',warehouseId:'east',date:'2026-10-01',quantity:1,leadDays:0,costCents:500,confirmed:true}]};
 const bundle=await req('business-scenarios',{dataNature:'demo',generationId:executionGeneration.id,requestId:'execution-scenario',scenarios:[executionSpec]});assert.equal(bundle.status,201);
 const choice=await req('business-decisions',{dataNature:'demo',requestId:'execution-choice',bundleId:bundle.data.id,scenarioId:'receipt'});assert.equal(choice.status,201);
 const receipt={kind:'arrival',recordKey:'hidden-receipt',entityId:'sku',warehouseId:'east',businessDate:'2026-10-01',quantity:1,costCents:500,status:'completed'};
 assert.equal((await ingest('unused',[receipt],{groupId:'hidden-proof',partIndex:0,partCount:2,coverageKinds:['arrival'],coverageStart:'2026-10-01',coverageEnd:'2026-10-01'})).status,201);
 const proof=await runtime.DB.prepare("SELECT id FROM neo_business_inputs WHERE record_key='hidden-receipt'").first();
 const visible=(await req('business-state?dataNature=demo&asOf=2026-10-01&start=2026-10-01&end=2026-10-01')).data.state.inputs.some(r=>r.id===proof.id);assert.equal(visible,false);
 const recorded=await req('business-executions',{dataNature:'demo',requestId:'hidden-execution',decisionId:choice.data.id,actionIndex:0,status:'executed',executionDate:'2026-10-01',quantity:1,costCents:500,proofIds:[proof.id]});assert.equal(recorded.status,422);
 results.push({id:'F06',case:'未封存、经营状态不可见的资料被用作已执行凭据',proofId:proof.id,visibleInBusinessState:visible,executionHttpStatus:recorded.status,execution:recorded.data});
 // Seal publishes the same proof; replay survives later correction, but new use does not.
 const fee={kind:'expense',recordKey:'receipt-fee',entityId:'sku',businessDate:'2026-10-01',amountCents:500};
 assert.equal((await ingest('unused',[fee],{groupId:'hidden-proof',partIndex:1,partCount:2,coverageKinds:['arrival'],coverageStart:'2026-10-01',coverageEnd:'2026-10-01'})).status,201);
 assert.equal((await req('business-inputs/seal',{dataNature:'demo',groupId:'hidden-proof',expectedRowCount:2,expectedTotals:{amountCents:500,quantity:1}})).status,201);
 const execution={dataNature:'demo',requestId:'published-execution',decisionId:choice.data.id,actionIndex:0,status:'executed',executionDate:'2026-10-01',quantity:1,costCents:500,proofIds:[proof.id]};
 assert.equal((await req('business-executions',execution)).status,201);
 assert.equal((await req('business-executions',{...execution,requestId:'reuse-proof'})).status,409);
 assert.equal((await ingest('receipt-correction',[{...receipt,quantity:2,supersedesId:proof.id}],{coverageKinds:['arrival'],coverageStart:'2026-10-01',coverageEnd:'2026-10-01'})).status,201);
 assert.equal((await req('business-executions',execution)).data.reused,true);
 assert.equal((await req('business-executions',{...execution,requestId:'superseded-proof'})).status,422);
 const revised=(await runtime.DB.prepare("SELECT id FROM neo_business_inputs WHERE record_key='hidden-receipt' ORDER BY revision DESC LIMIT 1").first()).id;
 assert.equal((await req('business-executions',{...execution,requestId:'revised-proof-reuse',quantity:2,proofIds:[revised]})).status,409);
 const outcome=(await req('business-outcomes/'+choice.data.id)).data;
 assert.equal(outcome.status,'needs_revalidation');assert.deepEqual(outcome.executions[0].proofVerification.invalidProofIds,[proof.id]);assert.equal(outcome.variance,null);
 // A local mock makes no model or external search requests.
 const source={id:'market-original',url:'https://example.org/official',title:'隔离来源',verificationStatus:'source_read',excerpt:'原文样本'.repeat(80),limitations:[],retrievedAt:later,publishedAt:earlier};
 const review={headline:'冻结判断',explanation:'引用已读原文并核查经营条件。',claims:[],evidenceIds:['market-original'],confirmations:[],nextAction:{title:'核对条件',reason:'已登记资料仍需确认。',condition:'确认后再决定。'},limitations:[],selectedSourceIds:['market-original']};
 const jobs=new Map();
 const server=createServer(async(request,response)=>{const chunks=[];for await(const chunk of request)chunks.push(chunk);let job=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;if(job)jobs.set(job.id,job);else job=jobs.get(request.url.split('/').at(-1));response.setHeader('content-type','application/json');if(request.url==='/health')return response.end(JSON.stringify({modelConfigured:true,model:'ISOLATED_TEST_MODEL'}));response.end(JSON.stringify({id:job?.id,status:'completed',businessId:job?.businessId,snapshotId:job?.snapshotId,dataNature:job?.dataNature,steps:[],result:{operatingReviews:{conversion:review,supply:review,market:review,joint:review},marketEvidence:[source],usage:[],toolReads:[],model:'ISOLATED_TEST_MODEL'}}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const rt={...runtime,NEO_AGENT_URL:'http://127.0.0.1:'+server.address().port,NEO_SERVICE_TOKEN:'isolated-review-token-'.repeat(3),agentExecutionMode:'live'};
  const run=await req('business-reviews',{dataNature:'demo',generationId:after.id,refreshId:'audit'},rt);assert.equal(run.status,202);
  const selected=run.data.result.operatingReviews.market.selectedSourceIds,sources=run.data.result.marketEvidence.map(s=>s.id);
  assert.ok(sources.every(id=>selected.includes(id)));assert.ok(sources.every(id=>!id.includes(run.data.id+':'+run.data.id+':')));
  const projected=projectedMarketReview({},run.data);assert.equal(projected.sources.filter(s=>s.selected).length,1);
  results.push({id:'F05',case:'市场证据ID加前缀后专业审查引用未同步',selectedSourceIds:selected,storedEvidenceIds:sources,projectedSelectedSources:projected.sources.filter(s=>s.selected).length});
 } finally {await new Promise(resolve=>server.close(resolve));}
 assert.equal(results.length,6);
} finally {await mf.dispose();}
});
