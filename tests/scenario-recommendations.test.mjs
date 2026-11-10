import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {decodeInput} from '../server/input-storage.ts';
let mf,runtime,server;const jobs=new Map(),requests=[],calculations=[];
const scope={snapshotId:'ai-options-test',dataNature:'demo'},q='businessId=test-a&snapshotId=ai-options-test&dataNature=demo';
before(async()=>{
 ({mf,runtime}=await localRuntime());
 const snapshot={id:scope.snapshotId,businessId:'test-a',dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-06-01',periodEnd:'2026-09-20',coverage:[],data:{inventory:[],weeks:[],financial:{},events:{}},evidenceIds:{paidUnits:'paid-evidence'},limitations:[]};
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(snapshot.id,'test-a','demo','2026-10-03',JSON.stringify(snapshot)).run();
 const baseline={id:'ai-baseline',kind:'forecast',businessId:'test-a',dataNature:'demo',snapshotId:snapshot.id,calculationVersion:'fixture-v1',inputHash:'frozen',unit:'件',asOf:snapshot.asOf,totals:{units:10,contributionMarginCents:1000},evidenceIds:['paid-evidence'],backtest:{status:'insufficient_history'}};
 await runtime.DB.prepare('INSERT INTO neo_artifacts VALUES(?,?,?,?,?,?,?,?,?,?)').bind(baseline.id,'test-a','demo',snapshot.id,'forecast','ai-baseline','frozen',null,JSON.stringify(baseline),new Date().toISOString()).run();
 server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const input=raw?JSON.parse(raw):null;res.setHeader('Content-Type','application/json');
  if(req.url==='/runs'){
   if(typeof input.budget?.maxToolCalls==='number'&&input.budget.maxToolCalls<1){res.statusCode=422;res.end(JSON.stringify({detail:'invalid tool limit'}));return;}
   const contract=spawnSync('agent-service/.venv/bin/python',['-c','import sys,json; from neo_agent.contracts import Job; Job.model_validate(json.load(sys.stdin))'],{input:JSON.stringify(input),env:{...process.env,PYTHONPATH:'agent-service'},encoding:'utf8'});if(contract.status!==0){res.statusCode=422;res.end(JSON.stringify({detail:contract.stderr}));return;}
   requests.push(input);let env=input.envelope;if(env.envelopePacked)env=await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',...env.envelopePacked}));
   const b=env.scenarioRecommendationBasis;
   const options='ABC'.split('').map((id,i)=>({id,title:'AI建议'+id,summary:'依照经营资料提出的假设',rationale:'经营依据',conditions:['响应需要核对'],evidenceIds:['paid-evidence'],externalEvidenceIds:[],assumptions:input.snapshotId.startsWith('generation-')?{operating:{id,name:'AI条件'+id,demandBps:9000+i*1000,actions:[]}}:{extraCostCents:(i+1)*100,extraCostAssumption:{source:'model_hypothesis',confirmed:false,note:'AI作用假设'}}}));
   jobs.set(input.id,{id:input.id,status:'completed',steps:[],result:{specialists:{},marketEvidence:[],model:'fixture',scenarioRecommendations:{...b,options,snapshotId:input.snapshotId,businessId:'test-a',dataNature:'demo'}}});res.end(JSON.stringify(jobs.get(input.id)));
  }else if(req.url.startsWith('/runs/'))res.end(JSON.stringify(jobs.get(req.url.split('/')[2])));
  else if(req.url==='/calculate/scenario-replay'){calculations.push(input.assumptions);res.end(JSON.stringify({status:'unavailable',historyStatus:'insufficient_history',foldCount:0,scenarioMetrics:null,baselineMetrics:null,notice:'历史不足'}));}
  else if(req.url==='/calculate/scenario'){res.end(JSON.stringify({...baseline,assumptions:input.assumptions,delta:{contributionMarginCents:-input.assumptions.extraCostCents}}));}
  else{res.statusCode=404;res.end('{}');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));runtime={...runtime,NEO_AGENT_URL:`http://127.0.0.1:${server.address().port}`,NEO_SERVICE_TOKEN:'fixture-token'};
});
after(async()=>{server?.close();await mf?.dispose();});
async function req(path,method='GET',body,rt=runtime){const r=await handleApi(new Request('http://localhost/api/v1/'+path,{method,headers:{origin:'http://localhost','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}

test('AI options are durable, baseline-scoped and calculation uses all three exact suggestions',async()=>{
 const body={...scope,baselineId:'ai-baseline',requestId:'options-1'},path='scenario-recommendations?'+q+'&baselineId=ai-baseline';
 const initial=await req(path);assert.equal(initial.data.run,null);
 const created=await req(path,'POST',body);assert.equal(created.status,200,JSON.stringify(created));assert.equal(created.data.recommendations.options.length,3);assert.equal(requests.length,1);assert.equal(requests[0].budget.maxTokens,null);assert.equal(requests[0].budget.maxModelCalls,null);
 assert.equal((await req(path,'POST',body)).data.run.id,created.data.run.id);assert.equal(requests.length,1,'HTTP replay must not invoke the model again');
 assert.equal((await req(path,'POST',{...body,baselineId:'foreign-baseline'})).status,409);
 const id=created.data.run.id;assert.equal((await req('scenario-recommendations/'+id+'?businessId=test-b&snapshotId=ai-options-test&dataNature=demo')).status,404);
 const evaluated=await req(`scenario-recommendations/${id}/evaluate?${q}`,'POST',scope);assert.equal(evaluated.status,201,JSON.stringify(evaluated));assert.equal(evaluated.data.items.length,3);
 assert.deepEqual(calculations,created.data.recommendations.options.map(o=>o.assumptions));
 assert.ok(evaluated.data.items.every(x=>x.scenario.parentId==='ai-baseline'&&x.replay.scenarioMetrics===null));
 const again=await req(`scenario-recommendations/${id}/evaluate?${q}`,'POST',scope);assert.equal(again.data.id,evaluated.data.id);assert.equal(calculations.length,3);
 const readback=await req(path);assert.equal(readback.data.evaluation.id,evaluated.data.id);
 const rows=await runtime.DB.prepare("SELECT count(*) n FROM neo_artifacts WHERE kind='scenario'").first();assert.equal(rows.n,3);
});

test('readers, different input versions and unavailable service never produce mock suggestions',async()=>{
 const rt={...runtime,local:{...runtime.local,userId:'local-reader'}};
 assert.equal((await req('scenario-recommendations?'+q,'POST',{...scope,baselineId:'ai-baseline',requestId:'reader'},rt)).status,403);
 assert.equal((await req('scenario-recommendations?'+q,'POST',{...scope,snapshotId:'foreign',baselineId:'ai-baseline',requestId:'wrong'})).status,409);
 const missing=await req('scenario-recommendations?'+q,'POST',{...scope,baselineId:'ai-baseline',requestId:'missing-service'},{...runtime,NEO_AGENT_URL:undefined});assert.equal(missing.data.run.status,'pending_dispatch');assert.equal(missing.data.recommendations,null);
});


test('canonical operating generations generate and evaluate against their frozen projected baseline',async()=>{
 const {buildBusinessState}=await import('../lib/business-state.ts'),{calculateScenario}=await import('../lib/business-scenarios.ts');
 const {defaultPlatformSettings}=await import('../lib/platform-settings.ts');
 const profile={industry:'ecommerce',name:'隔离企业',timezone:'Asia/Shanghai',region:'CN',objective:'contribution_margin',cashBudgetCents:50000,horizonDays:3,expectedSources:[{sourceId:'erp',kinds:['order','expense','inventory','fulfillment_rule']}],competitors:[]};
 const input=(kind,extra)=>({kind,entityId:'sku',recordKey:kind,id:kind,sourceId:'erp',revision:1,knownAt:'2026-10-01T00:00:00Z',businessDate:'2026-09-30',...extra});
 const state=buildBusinessState({businessId:'test-a',dataNature:'demo',profileVersion:'p',profile,asOf:'2026-09-30',knownAt:'2026-10-01T00:00:00Z',start:'2026-09-24',end:'2026-09-30'},[input('order',{quantity:21,amountCents:210000,variableCostCents:42000,entryType:'paid',orderId:'paid',channelId:'shop'}),input('expense',{amountCents:7000}),input('inventory',{warehouseId:'east',quantity:100,inventoryCostCents:10000}),input('fulfillment_rule',{warehouseId:'east',channelId:'shop',leadDays:0,costCents:0})],profile.expectedSources[0].kinds.map(kind=>({kind,sourceId:'erp',start:'2026-09-01',end:'2026-10-03'})));
 const id='generation-ai-options',g={version:'operating-generation-v1.1',id,sourceKey:'canonical-options-input',state,configuration:{settings:defaultPlatformSettings()},baseline:calculateScenario(state,{id:'baseline',name:'维持现状',demandBps:10000,actions:[]},id),steps:[],createdAt:state.knownAt};
 assert.equal(g.baseline.status,'calculated');await runtime.DB.prepare("INSERT INTO neo_business_generations(id,business_id,data_nature,source_key,status,payload,created_at,updated_at) VALUES(?,'test-a','demo',?,'calculated',?,?,?)").bind(id,g.sourceKey,JSON.stringify(g),g.createdAt,g.createdAt).run();
 const query=`businessId=test-a&dataNature=demo&snapshotId=${id}&baselineId=forecast-${id}`,body={dataNature:'demo',snapshotId:id,baselineId:`forecast-${id}`,requestId:'canonical-options'};
 const created=await req('scenario-recommendations?'+query,'POST',body);assert.equal(created.status,200,JSON.stringify(created));
 const result=await req(`scenario-recommendations/${created.data.run.id}/evaluate?${query}`,'POST',body);assert.equal(result.status,201,JSON.stringify(result));
 assert.equal(result.data.items.length,3);assert.ok(result.data.items.every(x=>x.scenario?.parentId===body.baselineId),JSON.stringify(result));
 assert.deepEqual(result.data.items.map(x=>x.scenario.assumptions.operating.demandBps),[9000,10000,11000]);
});


test('received dispatch validation rejection is terminal and never repeatedly submitted',async()=>{
 const row=await runtime.DB.prepare("SELECT * FROM neo_runs WHERE request_id='scenario-options:options-1'").first();const payload=JSON.parse(row.payload);payload.id='run-rejected-contract';payload.budget.maxToolCalls=0;
 const observation={runtime:{gatewayDispatch:'not_sent',gatewayRevision:'rejected-test'}};
 await runtime.DB.prepare("INSERT INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) VALUES(?,'test-a','demo',?,?,?,? ,?,'pending_dispatch','[]',?,?,?)").bind(payload.id,scope.snapshotId,payload.sessionId,'rejected-contract','rejected',JSON.stringify(payload),JSON.stringify(observation),new Date().toISOString(),new Date().toISOString()).run();
 const rejected=await req(`agent-runs/${payload.id}?${q}`);assert.equal(rejected.data.status,'failed',JSON.stringify(rejected));assert.equal(rejected.data.observability.errorCode,'DISPATCH_REJECTED');assert.equal((await req(`agent-runs/${payload.id}?${q}`)).data.status,'failed');
});
