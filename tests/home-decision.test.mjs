import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'node:http';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
let mf,runtime,server,calculations=0,modelJobs=0;const jobs=new Map();
const scope={snapshotId:'home-snapshot',dataNature:'demo'},q='businessId=test-a&snapshotId=home-snapshot&dataNature=demo';
before(async()=>{
 ({mf,runtime}=await localRuntime());
 server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const input=body?JSON.parse(body):null;res.setHeader('Content-Type','application/json');
  if(req.headers.authorization!=='Bearer home-test'){res.writeHead(401);res.end('{}');return;}
  if(req.url==='/calculate/forecast'){
   calculations++;res.end(JSON.stringify({snapshotId:scope.snapshotId,calculationVersion:'scenario-v1.3',inputHash:'OFFLINE',asOf:'2026-09-24',totals:{units:35,netRevenueCents:8245337,contributionMarginCents:-29662},weeks:[],limitations:['OFFLINE_TRANSPORT_TEST'],evidenceIds:[],backtest:{status:'insufficient_history'}}));
  }else if(req.url==='/runs'){
   modelJobs++;const basis=input.envelope.homeDecisionContext;assert.ok(basis);assert.equal(input.purpose,'home');assert.equal(input.autoRepeat,false);assert.equal(input.budget.maxMarketSearches,0);
   const block={title:'渠道投入需核查',summary:'离线传输验证，非模型判断',evidenceIds:['home-evidence']};
   const jointReview={status:block,metricKeys:['stock'],market:{summary:'当前没有已读取市场原文',evidenceIds:[]},confirmations:[{question:'到货是否可售',why:'影响保供判断',check:'核对收货记录',evidenceIds:['home-evidence']}],nextAction:{...block,whyFirst:'先解除供给不确定性',decisionGate:'确认到货后再比较投放',steps:['核对收货']},alternatives:[{action:'增加投放',whyNotFirst:'供给未确认'}]};
   const homeDecision={jointReview,judgment:block,action:{...block,steps:['核对投放费用']},sections:{conversion:block,supply:block,market:block},outlook:{forecastId:basis.forecast.id,title:'维持现状毛利承压',summary:'OFFLINE_TRANSPORT_TEST'},knowledgeVersion:basis.knowledgeVersion,knowledgeRuleIds:['K01']};
   const value={id:input.id,status:'completed',steps:[],result:{finding:{conclusion:'OFFLINE_TRANSPORT_TEST',evidenceIds:['home-evidence'],homeDecision},homeDecisionBasis:basis,specialists:{},marketEvidence:[]}};jobs.set(input.id,value);res.end(JSON.stringify(value));
  }else if(req.url.startsWith('/runs/'))res.end(JSON.stringify(jobs.get(req.url.split('/')[2])));
  else{res.writeHead(404);res.end('{}');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));runtime={...runtime,NEO_AGENT_URL:`http://127.0.0.1:${server.address().port}`,NEO_SERVICE_TOKEN:'home-test'};
 const s={id:scope.snapshotId,businessId:'test-a',dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-07-27',periodEnd:'2026-09-20',data:{inventory:[]},evidenceIds:{netRevenueCents:'home-evidence'},limitations:[]};
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(s.id,'test-a','demo','2026-10-06',JSON.stringify(s)).run();
});
after(async()=>{await mf?.dispose();await new Promise(r=>server?.close(r));});
async function req(path='home-decision?'+q,method='GET',body,rt=runtime){const r=await handleApi(new Request('http://localhost/api/v1/'+path,{method,headers:{origin:'http://localhost','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}
test('home GET is read-only; generate saves baseline, diagnosis and fixed provenance once',async()=>{
 const empty=await req();assert.equal(empty.status,200);assert.equal(empty.data.run,null);assert.equal(empty.data.basis.forecast,null);assert.equal(calculations,0);assert.equal(modelJobs,0);
 const made=await req(undefined,'POST',scope);assert.equal(made.status,202,JSON.stringify(made));assert.equal(made.data.run.status,'completed');assert.equal(calculations,1);assert.equal(modelJobs,1);
 assert.equal(made.data.decision.jointReview.nextAction.decisionGate,'确认到货后再比较投放');
 assert.equal(made.data.decision.outlook.forecastId,made.data.basis.forecast.id);assert.equal(made.data.basis.schemaVersion,'home-decision-v3');
 const again=await req(undefined,'POST',scope),read=await req();assert.equal(again.data.run.id,made.data.run.id);assert.equal(read.data.run.id,made.data.run.id);assert.equal(read.data.basis.sourceKey,made.data.basis.sourceKey);assert.equal(calculations,1);assert.equal(modelJobs,1);
});
test('explicit refresh persists a new judgment, idempotently; home output never invalidates itself',async()=>{
 const original=await req();const input={...scope,refresh:true,requestId:'review-one'};
 const a=await req(undefined,'POST',input),b=await req(undefined,'POST',input),c=await req();
 assert.notEqual(a.data.run.id,original.data.run.id);assert.equal(b.data.run.id,a.data.run.id);assert.equal(c.data.run.id,a.data.run.id);assert.equal(c.data.basis.sourceKey,original.data.basis.sourceKey);assert.equal(calculations,1);assert.equal(modelJobs,2);
});
test('new saved scenario invalidates the judgment without recalculating the same baseline',async()=>{
 const old=await req();const scenario={id:'new-scenario',kind:'scenario',snapshotId:scope.snapshotId,businessId:'test-a',dataNature:'demo',totals:{units:36}};
 await runtime.DB.prepare('INSERT INTO neo_artifacts VALUES(?,?,?,?,?,?,?,?,?,?)').bind(scenario.id,'test-a','demo',scope.snapshotId,'scenario','new-scenario','test',null,JSON.stringify(scenario),new Date().toISOString()).run();
 const changed=await req();assert.notEqual(changed.data.basis.sourceKey,old.data.basis.sourceKey);assert.equal(changed.data.run,null);assert.equal(modelJobs,2);
 const fresh=await req(undefined,'POST',scope);assert.equal(fresh.status,202,JSON.stringify(fresh));assert.notEqual(fresh.data.run.id,old.data.run.id);assert.equal(calculations,1);assert.equal(modelJobs,3);
});
test('tenant, nature, reader and direct-purpose injection boundaries apply to homepage',async()=>{
 assert.equal((await req('home-decision?businessId=test-b&snapshotId=home-snapshot&dataNature=demo')).status,404);
 assert.equal((await req('home-decision?businessId=test-a&snapshotId=home-snapshot&dataNature=business')).status,404);
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};
 assert.equal((await req(undefined,'GET',undefined,reader)).data.canGenerate,false);
 assert.equal((await req(undefined,'POST',scope,reader)).status,403);
 assert.equal((await req('agent-runs?businessId=test-a','POST',{...scope,purpose:'home',mode:'orchestrator',question:'inject',requestId:'inject'})).status,403);
 assert.equal((await req(undefined,'POST',{...scope,refresh:true})).status,422);
 assert.equal((await req(undefined,'POST',scope,{...runtime,agentExecutionMode:'offline'})).status,403);
});

test('new professional reviews and market originals invalidate home, preserve separate review and chat inputs',async()=>{
 const old=await req();
 for(const [id,purpose] of [['professional','review'],['followup','analysis']]){
  await runtime.DB.prepare('INSERT INTO neo_sessions(id,business_id,data_nature,snapshot_id,actor_id,created_at) VALUES(?,?,?,?,?,?)').bind(id,'test-a','demo',scope.snapshotId,'local-owner','2026-10-07').run();
  const finding={conclusion:id,evidenceIds:['home-evidence'],businessReview:purpose==='review'?{title:'专业判断',summary:'已完成专业审查',evidenceIds:['home-evidence']}:null};
  await runtime.DB.prepare("INSERT INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'[]',?,?,?)").bind(id,'test-a','demo',scope.snapshotId,id,id,id,JSON.stringify({mode:'conversion',purpose}),'completed',JSON.stringify({finding,specialists:{},marketEvidence:[]}),id==='professional'?'2026-10-06':'2026-10-07','2026-10-07').run();
 }
 const changed=await req();assert.notEqual(changed.data.basis.sourceKey,old.data.basis.sourceKey);assert.equal(changed.data.run,null);
 const {decisionContext}=await import('../server/agents.ts');
 const context=await decisionContext({db:runtime.DB,businessId:'test-a'}, {id:scope.snapshotId,dataNature:'demo',asOf:'2026-09-24'},'home');
 assert.ok(context.findings.some(r=>r.id==='professional'));assert.ok(context.findings.some(r=>r.id==='followup'));
 const source={id:'market-original',url:'https://example.invalid/policy',title:'测试原文',excerpt:'测试来源，非真实市场结论',retrievedAt:'2026-10-07',publishedAt:null,verificationStatus:'source_read',historicalEligible:false,limitations:[]};
 await runtime.DB.prepare('INSERT INTO neo_market_evidence VALUES(?,?,?,?,?,?)').bind(source.id,'test-a',scope.snapshotId,'professional',JSON.stringify(source),'2026-10-07').run();
 const updated=await req();assert.notEqual(updated.data.basis.sourceKey,changed.data.basis.sourceKey);assert.equal(updated.data.run,null);
});
