import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'node:http';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {agentPolicy} from '../server/agent-policy.ts';
let mf,runtime,server,nextStatus='completed';const jobs=new Map(),payloads=[];
const scope={snapshotId:'review-snapshot',dataNature:'demo'},q='businessId=test-a&snapshotId=review-snapshot&dataNature=demo';
before(async()=>{
 ({mf,runtime}=await localRuntime());
 server=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;const input=text?JSON.parse(text):null;res.setHeader('Content-Type','application/json');
  if(req.url==='/runs'){
   payloads.push(input);assert.equal(input.purpose,'review');assert.equal(input.autoRepeat,false);assert.equal(input.budget.maxMarketSearches,['market','joint'].includes(input.mode)?null:0);assert.equal(input.history.length,0);
   const professional=Object.fromEntries(['conversion','supply','market'].map(mode=>[mode,{title:mode+'专业审查',summary:'离线传输验证',evidenceIds:['review-ev']}]));
   const finding={conclusion:'OFFLINE_REVIEW_TEST',businessReview:professional[input.mode]??null,evidenceIds:['review-ev'],gaps:[],candidates:[],alternatives:[],followups:[]};
   const specialists=Object.fromEntries(Object.entries(professional).map(([mode,r])=>[mode,{...finding,businessReview:r}]));
   const assessment=input.mode==='joint'?{version:'business-assessment-v1',scope:{businessId:input.businessId,dataNature:input.dataNature,inputId:input.snapshotId,configurationVersion:'legacy:legacy-unversioned'},context:{completeReview:true,semanticValidation:{status:'verified',version:'semantic-support-v1'}},projections:{finding,specialists,professional,marketEvidence:[]}}:undefined;
   const completedResult={finding,specialists:{},marketEvidence:[],...(assessment?{businessAssessment:assessment}:{})};const value={id:input.id,status:nextStatus,steps:[],result:nextStatus==='completed'?completedResult:null};jobs.set(input.id,value);value.completedResult=completedResult;nextStatus='completed';res.end(JSON.stringify(value));
  }else if(req.url.startsWith('/runs/'))res.end(JSON.stringify(jobs.get(req.url.split('/')[2])));
  else{res.writeHead(404);res.end('{}');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));runtime={...runtime,NEO_AGENT_URL:`http://127.0.0.1:${server.address().port}`,NEO_SERVICE_TOKEN:'review-test'};
 const s={id:scope.snapshotId,businessId:'test-a',dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-07-27',periodEnd:'2026-09-20',data:{inventory:[]},evidenceIds:{netRevenueCents:'review-ev'},limitations:[]};
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(s.id,'test-a','demo','2026-10-06',JSON.stringify(s)).run();
});
after(async()=>{await mf?.dispose();await new Promise(r=>server?.close(r));});
async function req(path='growth-reviews?'+q,method='GET',body,rt=runtime){const r=await handleApi(new Request('http://localhost/api/v1/'+path,{method,headers:{origin:'http://localhost','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}
test('GET is pure; POST dispatches one shared assessment and projects three specialist views',async()=>{
 const empty=await req();assert.equal(empty.status,200);assert.deepEqual(empty.data.reviews,{});assert.equal(payloads.length,0);
 const made=await req(undefined,'POST',scope);assert.equal(made.status,202,JSON.stringify(made));assert.equal(payloads.length,1);
 assert.equal(payloads[0].mode,'joint');assert.match(payloads[0].question,/客户转化、供给库存与市场渠道/);
 assert.equal(new Set(Object.values(made.data.reviews).map(p=>p.id)).size,1);
 const again=await req(undefined,'POST',scope),read=await req();assert.deepEqual(again.data.reviews,made.data.reviews);assert.deepEqual(Object.fromEntries(Object.entries(read.data.reviews).map(([k,{knowledgeFreshness,...v}])=>[k,v])),Object.fromEntries(Object.entries(made.data.reviews).map(([k,{knowledgeFreshness,...v}])=>[k,v])));assert.equal(read.data.reviews.conversion.knowledgeFreshness.status,'current');assert.equal(payloads.length,1);
 const input={...scope,refresh:true,requestId:'one-refresh'};
 const fresh=await req(undefined,'POST',input),retry=await req(undefined,'POST',input);assert.equal(payloads.length,2);assert.deepEqual(fresh.data.reviews,retry.data.reviews);assert.notEqual(fresh.data.reviews.conversion.id,made.data.reviews.conversion.id);
});
test('scope and review execution are server controlled',async()=>{
 assert.equal((await req('growth-reviews?businessId=test-b&snapshotId=review-snapshot&dataNature=demo')).status,404);
 assert.equal((await req('growth-reviews?businessId=test-a&snapshotId=review-snapshot&dataNature=business')).status,404);
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};
 assert.equal((await req(undefined,'GET',undefined,reader)).data.canGenerate,false);assert.equal((await req(undefined,'POST',scope,reader)).status,403);
 assert.equal((await req('agent-runs?businessId=test-a','POST',{...scope,purpose:'review',mode:'conversion',question:'inject',requestId:'inject'})).status,403);
 assert.equal((await req(undefined,'POST',{...scope,refresh:true})).status,422);
 const isolated={agentExecutionMode:'live',manualAgentBusinesses:['neo-sim-review']};
 assert.equal(agentPolicy(isolated,'neo-sim-review').marketSearchAllowed,false);
 assert.equal(agentPolicy({...isolated,manualMarketBusinesses:['neo-sim-review']},'neo-sim-review').marketSearchAllowed,true);
 assert.equal(agentPolicy({...isolated,manualMarketBusinesses:['neo-sim-other']},'neo-sim-review').marketSearchAllowed,false);
 assert.equal(agentPolicy({...isolated,manualMarketBusinesses:['neo-sim-review']},'neo-sim-review').automaticPatrolAllowed,false);
});
test('customer journey is scoped and read-only, returns unavailable ratios for legacy inputs',async()=>{
 const before=payloads.length,read=await req('customer-journey?'+q);
 assert.equal(read.status,200,JSON.stringify(read));assert.equal(read.data.journey.snapshotId,scope.snapshotId);assert.equal(read.data.journey.rule,null);assert.equal(read.data.journey.period.transitions[0].rate,null);assert.equal(read.data.review.title,'conversion专业审查');assert.equal(payloads.length,before);
 assert.equal((await req('customer-journey?businessId=test-b&snapshotId=review-snapshot&dataNature=demo')).status,404);
 assert.equal((await req('customer-journey?businessId=test-a&snapshotId=review-snapshot&dataNature=business')).status,404);
 assert.equal((await req('customer-journey?'+q,'POST',scope)).status,405);
});

test('single supply update dispatches only that specialist and rejects unknown modes',async()=>{
 const before=payloads.length,answer=await req('growth-reviews?'+q+'&mode=supply','POST',{...scope,refresh:true,requestId:'supply-only'});
 assert.equal(answer.status,202,JSON.stringify(answer));assert.equal(payloads.length,before+1);assert.equal(payloads.at(-1).mode,'supply');assert.deepEqual(Object.keys(answer.data.reviews),['supply']);
 assert.equal((await req('growth-reviews?'+q+'&mode=invalid','POST',scope)).status,422);assert.equal(payloads.length,before+1);
});

test('unified review GET preserves queued/running/failed status and previous complete display during refresh',async()=>{
 const asyncScope={snapshotId:'async-review-snapshot',dataNature:'demo'},asyncQ='businessId=test-a&snapshotId=async-review-snapshot&dataNature=demo',endpoint='growth-reviews?'+asyncQ;
 const s={id:asyncScope.snapshotId,businessId:'test-a',dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-07-27',periodEnd:'2026-09-20',data:{inventory:[]},evidenceIds:{netRevenueCents:'review-ev'},limitations:[]};
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(s.id,'test-a','demo','2026-10-06',JSON.stringify(s)).run();
 const before=payloads.length;nextStatus='queued';const made=await req(endpoint,'POST',asyncScope),firstId=made.data.reviews.conversion.id;
 assert.equal(made.status,202);assert.ok(Object.values(made.data.reviews).every(r=>r.status==='queued'));
 const queued=await req(endpoint);assert.ok(Object.values(queued.data.reviews).every(r=>r.id===firstId&&r.status==='queued'));assert.equal(payloads.length,before+1);
 jobs.get(firstId).status='running';const checkpoint={conclusion:'本轮转化检查点',businessReview:{title:'本轮转化检查点',summary:'其他专业未完成',evidenceIds:['review-ev']},evidenceIds:['review-ev'],alternatives:[],gaps:[],candidates:[],followups:[]};jobs.get(firstId).result={finding:checkpoint,specialists:{conversion:checkpoint},marketEvidence:[],partial:true};await req(`agent-runs/${firstId}?${asyncQ}`);
 const running=await req(endpoint);assert.ok(Object.values(running.data.reviews).every(r=>r.id===firstId&&r.status==='running'));assert.equal(running.data.reviews.conversion.result.finding.conclusion,'本轮转化检查点');assert.equal(running.data.reviews.supply.result,null);assert.equal(running.data.reviews.market.result,null);
 jobs.get(firstId).status='completed';jobs.get(firstId).result=jobs.get(firstId).completedResult;await req(`agent-runs/${firstId}?${asyncQ}`);
 const complete=await req(endpoint);assert.ok(Object.values(complete.data.reviews).every(r=>r.id===firstId&&r.status==='completed'));
 nextStatus='queued';const refresh=await req(endpoint,'POST',{...asyncScope,refresh:true,requestId:'async-refresh'}),nextId=refresh.data.reviews.conversion.id;assert.notEqual(nextId,firstId);
 const pending=await req(endpoint);assert.ok(Object.values(pending.data.reviews).every(r=>r.id===nextId&&r.status==='queued'&&r.result.displayOnly&&r.result.displaySourceRunId===firstId));
 assert.ok(Object.values(pending.data.completeReviews).every(r=>r.id===firstId&&r.status==='completed'));
 assert.equal(pending.data.reviews.conversion.result.finding.businessReview.title,'conversion专业审查');
 jobs.get(nextId).status='failed';jobs.get(nextId).error='后续审查预算不足，尚未完成';await req(`agent-runs/${nextId}?${asyncQ}`);
 const failed=await req(endpoint);assert.ok(Object.values(failed.data.reviews).every(r=>r.id===nextId&&r.status==='failed'&&r.error==='后续审查预算不足，尚未完成'));
 assert.equal(failed.data.completeReviews.conversion.id,firstId);assert.equal(failed.data.reviews.conversion.result.displaySourceRunId,firstId);assert.equal(payloads.length,before+2);
});
