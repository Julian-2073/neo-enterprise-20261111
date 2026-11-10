import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createServer} from 'node:http';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {envelope,normalizeMarketEvidence,queuePatrol} from '../server/agents.ts';
import {context} from '../server/auth.ts';
let mf,runtime,server,base;const jobs=new Map();
before(async()=>{
 ({mf,runtime}=await localRuntime());
 server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const input=body?JSON.parse(body):null;res.setHeader('Content-Type','application/json');if(req.headers.authorization!=='Bearer test-token'){res.writeHead(401);res.end('{}');return;}
 if(req.url==='/runs'){jobs.set(input.id,{id:input.id,status:'completed',steps:[{message:'OFFLINE_TRANSPORT_TEST',at:'2026-10-03'}],result:{finding:{conclusion:'测试传输结果',evidenceIds:['e1'],alternatives:[],gaps:[],candidates:[],followups:[]},specialists:{},marketEvidence:[],model:'OFFLINE_TEST'}});res.end(JSON.stringify(jobs.get(input.id)));}
 else if(req.url.startsWith('/runs/'))res.end(JSON.stringify(jobs.get(req.url.split('/')[2])));
 else if(req.url.startsWith('/calculate/'))res.end(JSON.stringify({snapshotId:input.envelope.snapshot.id,calculationVersion:'OFFLINE_TRANSPORT_TEST',inputHash:'test',totals:{units:1,netRevenueCents:100,contributionMarginCents:50},assumptions:input.assumptions,limitations:['OFFLINE_TRANSPORT_TEST']}));
 else{res.writeHead(404);res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;runtime={...runtime,NEO_AGENT_URL:base,NEO_SERVICE_TOKEN:'test-token'};
 const snap={id:'agent-test-snapshot',businessId:'test-a',dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-07-27',periodEnd:'2026-09-20',data:{inventory:[]},evidenceIds:{},limitations:[]};
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(snap.id,'test-a','demo','2026-10-03',JSON.stringify(snap)).run();
});
after(async()=>{await mf?.dispose();server?.close();});
async function req(path,method='GET',body,rt=runtime){const r=await handleApi(new Request('http://localhost/api/v1/'+path,{method,headers:{origin:'http://localhost','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}
const scope={snapshotId:'agent-test-snapshot',dataNature:'demo'};const q='businessId=test-a&snapshotId=agent-test-snapshot&dataNature=demo';
test('new APIs preserve authentication and tenant isolation',async()=>{
 assert.equal((await req('agent-runs?businessId=test-a','POST',{...scope,mode:'joint',question:'q',requestId:'unauth'},{...runtime,local:undefined})).status,401);
 assert.equal((await req('agent-runs?businessId=test-b','POST',{...scope,mode:'joint',question:'q',requestId:'bad-scope'})).status,404);
 assert.equal((await req('agent-runs?businessId=test-a','POST',{...scope,dataNature:'business',mode:'joint',question:'q',requestId:'bad-nature'})).status,404);
});
test('persistent run, request replay, conflict and session readback',async()=>{
 const body={...scope,mode:'conversion',question:'调查',requestId:'run-one'};
 const first=await req('agent-runs?businessId=test-a','POST',body);assert.equal(first.status,202,JSON.stringify(first));assert.equal(first.data.status,'completed');
 const again=await req('agent-runs?businessId=test-a','POST',body);assert.equal(again.data.id,first.data.id);
 assert.equal((await req('agent-runs?businessId=test-a','POST',{...body,question:'不同问题'})).status,409);
 assert.equal((await req(`agent-runs/${first.data.id}?businessId=test-b`)).status,404);
 const session=await req(`agent-sessions/${first.data.sessionId}?businessId=test-a`);assert.equal(session.data.runs.length,1);
 const next=await req('agent-runs?businessId=test-a','POST',{...body,requestId:'followup',sessionId:first.data.sessionId});assert.equal(next.data.sessionId,first.data.sessionId);
});
test('freeze input once; later domain writes never rewrite a running snapshot',async()=>{
 const ctx=await context(new Request('http://localhost/api/v1/x?businessId=test-a'),runtime);const a=await envelope(ctx,{id:scope.snapshotId});
 const d=await req('agent-domain?businessId=test-a','POST',{dataNature:'demo',records:[{id:'P1',kind:'products',payload:{id:'P1',name:'样例'}}]});assert.equal(d.status,200);
 assert.deepEqual(await envelope(ctx,{id:scope.snapshotId}),a);
 assert.equal((await req('agent-domain?businessId=test-a','POST',{dataNature:'business',records:[]})).status,422);
});
test('forecast/scenario/decision persist versions and never execute',async()=>{
 const f=await req('forecasts?businessId=test-a','POST',{...scope,requestId:'forecast'});assert.equal(f.status,201,JSON.stringify(f));
 const input={...scope,requestId:'scenario',baselineId:f.data.id,assumptions:{},title:'保持现状'};
 const s=await req('scenarios?businessId=test-a','POST',input);assert.equal(s.status,201,JSON.stringify(s));assert.equal(s.data.parentId,f.data.id);
 assert.equal((await req('scenarios?businessId=test-a','POST',input)).data.id,s.data.id);
 assert.equal((await req(`scenarios/${s.data.id}?businessId=test-b`)).status,404);
 const d=await req('decisions?businessId=test-a','POST',{...scope,requestId:'decision',scenarioId:s.data.id,reason:'记录比较依据'});assert.equal(d.status,201);assert.equal(d.data.status,'saved_decision');assert.equal(d.data.actualOutcome,null);
 const report=await req('reports/weekly?'+q);assert.equal(report.data.decisions.length,1);
});
test('read-only role cannot persist decisions or agent tasks',async()=>{
 const rt={...runtime,local:{...runtime.local,userId:'local-reader'}};
 assert.equal((await req('forecasts?businessId=test-a','POST',{...scope,requestId:'read-only'},rt)).status,403);
 assert.equal((await req('agent-runs?businessId=test-a','POST',{...scope,mode:'joint',question:'q',requestId:'read-only'},rt)).status,403);
});
test('missing service leaves a recoverable saved run, never a mock answer',async()=>{
 const r=await req('agent-runs?businessId=test-a','POST',{...scope,mode:'market',question:'研究',requestId:'no-service'},{...runtime,NEO_AGENT_URL:undefined});assert.equal(r.status,202);assert.equal(r.data.status,'pending_dispatch');assert.equal(r.data.result,null);assert.match(r.data.error,/未连接/);
 const cancelled=await req(`agent-runs/${r.data.id}/cancel?businessId=test-a`,'POST',{});assert.equal(cancelled.data.status,'cancelled');
});

test('cached 405 pages are not verified evidence and readable sources keep text',()=>{
 const bad={title:'405',verificationStatus:'source_read',limitations:[],content:'![](https://cdn.example/405.png)'};
 assert.equal(normalizeMarketEvidence(bad).verificationStatus,'unavailable');assert.equal(bad.verificationStatus,'source_read');
 const good={...bad,title:'官方政策',content:'已读取政策正文。'.repeat(50)};assert.equal(normalizeMarketEvidence(good).verificationStatus,'source_read');
});

test('snapshot patrol uses the same scope and one persistent request per day',async()=>{
 const patrolRuntime={...runtime,disableAutomaticPatrol:false};
 const ctx=await context(new Request('http://localhost/api/v1/x?businessId=test-a'),patrolRuntime);
 const snap=JSON.parse((await runtime.DB.prepare('SELECT payload FROM operating_snapshots WHERE id=?').bind(scope.snapshotId).first()).payload);
 const request=new Request('http://localhost/api/v1/operating-snapshots?businessId=test-a',{method:'POST',headers:{origin:'http://localhost','Content-Type':'application/json'}});
 const a=await queuePatrol(request,ctx,snap);const b=await queuePatrol(request,ctx,snap);
 const third=await req('agent-runs?businessId=test-a','POST',{...scope,mode:'joint',purpose:'patrol',requestId:'another-browser-tab',question:'主动巡检'},patrolRuntime);assert.equal(third.data.id,a.id);
 assert.equal(a.id,b.id);assert.equal(a.purpose,'patrol');assert.equal(a.snapshotId,scope.snapshotId);
 const row=await runtime.DB.prepare('SELECT payload FROM neo_runs WHERE id=?').bind(a.id).first();const payload=JSON.parse(row.payload);
 assert.equal(payload.businessId,'test-a');assert.equal(payload.dataNature,'demo');assert.equal(payload.envelope.snapshot.id,scope.snapshotId);
});

test('weekly reads ordinary and legacy object-version choices; broken parents stay local',async()=>{
 const original={id:'legacy-scenario',kind:'scenario',businessId:'test-a',dataNature:'demo',snapshotId:scope.snapshotId,parentId:'legacy-baseline',ontologyRef:{buildId:'object-v1'},totals:{units:3,netRevenueCents:900,contributionMarginCents:200}};
 const legacy={...original,id:'legacy-choice',kind:'decision',scenarioId:original.id,parentId:original.id,title:'后台保存的选择',reason:'保留原理由'};delete legacy.totals;
 const variants=[original,legacy,{...legacy,id:'missing-choice',scenarioId:'absent-parent',title:'缺方案的选择'},{...legacy,id:'wrong-version-choice',ontologyRef:{buildId:'object-v2'}}];
 for(const v of variants)await runtime.DB.prepare('INSERT INTO neo_artifacts VALUES(?,?,?,?,?,?,?,?,?,?)').bind(v.id,'test-a','demo',scope.snapshotId,v.kind,v.id,'test',v.parentId,JSON.stringify(v),new Date().toISOString()).run();
 const report=await req('reports/weekly?'+q);assert.equal(report.status,200);const choice=report.data.decisions.find(d=>d.id==='legacy-choice');assert.equal(choice.resultStatus,'ready');assert.equal(choice.selectedScenario.totals.units,3);
 assert.equal(report.data.decisions.find(d=>d.id==='missing-choice').resultStatus,'unavailable');assert.equal(report.data.decisions.find(d=>d.id==='wrong-version-choice').selectedScenario,null);
 const raw=JSON.parse((await runtime.DB.prepare('SELECT payload FROM neo_artifacts WHERE id=?').bind(legacy.id).first()).payload);assert.equal(raw.selectedScenario,undefined,'immutable original stays untouched');
 assert.equal((await req(`decisions/${legacy.id}?${q}`)).data.selectedScenario.id,original.id);
 assert.equal((await req(`scenarios/${original.id}?businessId=test-a&snapshotId=another&dataNature=demo`)).status,404);
 assert.equal((await req(`scenarios/${original.id}?businessId=test-a&dataNature=business`)).status,404);
 assert.equal((await req(`decisions/${legacy.id}?businessId=test-b`)).status,404);
});
