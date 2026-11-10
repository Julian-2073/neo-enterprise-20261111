import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {configuredRuntime} from '../server/runtime-config.ts';
import {handleApi} from '../server/api.ts';
import {validatedBudget} from '../server/agent-state.ts';
import {runNeedsRefresh,canResumeRun,runBusinessStatus} from '../components/neo-demo/agent-presentation.ts';
import {synchronizeAgentRuns} from '../server/agents.ts';
const OUT='outputs/ts-cancel-dispatch-handoff';
let mf,db,bucket,local,server,base;const jobs=new Map(),payloads=new Map(),calls=[];let healthReady=true;
const finding={conclusion:'支付订单资料已取得，库存条件仍需核查。',evidenceIds:['ev-orders','market-1'],alternatives:['不能据同期变化判断因果'],gaps:['客户关联资料待补'],candidates:['先核查商品库存'],followups:[]};
const market={id:'market-1',title:'离线原文样本',url:'https://example.invalid/offline',publishedAt:null,retrievedAt:'2026-10-04T08:00:00Z',verificationStatus:'source_read',excerpt:'离线原文样本正文。'.repeat(30),limitations:['离线验收资料，不是实时市场结果']};
function observation(payload,overrides={}){return {priorityClass:'interactive',queuePosition:1,attemptCount:1,cancellationPending:false,inputHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),limits:{maxAttempts:3,maxModelCalls:32,maxTokens:256000,maxToolCalls:64,maxMarketSearches:2,completionTokens:6000,timeoutSeconds:600,...payload.budget},waitSeconds:1.25,runSeconds:2.5,reportedTokens:12,estimatedOrReservedTokens:100,modelInvocations:1,modelCallsCompleted:1,modelCallsUncertain:0,modelReplays:0,errorCode:null,retryable:false,...overrides};}
function result(final=false){return {finding:final?structuredClone(finding):null,specialists:{conversion:structuredClone(finding)},marketEvidence:[structuredClone(market)],partial:!final,model:'OFFLINE_CONTROLLED_ADAPTER'};}
function runtime(vars={}){return configuredRuntime({DB:db,RAW_FILES:bucket,NEO_AGENT_EXECUTION_MODE:'offline',NEO_OFFLINE_AGENT_URL:base,NEO_SERVICE_TOKEN:'offline-token',...vars},local);}
async function request(path,method='GET',body,rt=runtime(),headers={}){const r=await handleApi(new Request('http://localhost/api/v1/'+path,{method,headers:{origin:'http://localhost','content-type':'application/json',...headers},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)}),rt);return {status:r.status,data:await r.json()};}
async function raw(id){return db.prepare('SELECT * FROM neo_runs WHERE id=?').bind(id).first();}
const scope={snapshotId:'runtime-snap',dataNature:'demo'};
const q='businessId=test-a&snapshotId=runtime-snap&dataNature=demo';
async function submit(question,options={}){const body={...scope,mode:'joint',question,requestId:'request-'+question,...options};const r=await request('agent-runs?'+q,'POST',body);assert.equal(r.status,202,JSON.stringify(r));return {run:r.data,body};}
before(async()=>{
 await mkdir(OUT,{recursive:true});
 const created=await localRuntime();mf=created.mf;db=created.runtime.DB;bucket=created.runtime.RAW_FILES;local=created.runtime.local;
 server=createServer(async(req,res)=>{
  let text='';for await(const c of req)text+=c;const body=text?JSON.parse(text):null;calls.push({method:req.method,path:req.url,id:body?.id});res.setHeader('content-type','application/json');
  if(req.headers.authorization!=='Bearer offline-token'){res.writeHead(401);res.end('{}');return;}
  if(req.url==='/health'){res.end(JSON.stringify({executionMode:'offline',modelConfigured:!healthReady,marketConfigured:false,autoPatrolEnabled:false}));return;}
  if(req.url==='/runs'){
   if(!payloads.has(body.id)){payloads.set(body.id,structuredClone(body));jobs.set(body.id,{id:body.id,status:'queued',steps:[{message:'等待分析',at:'2026-10-04T08:00:00Z'}],result:null,error:null,observability:observation(body)});}
   else assert.deepEqual(body,payloads.get(body.id));
   res.end(JSON.stringify(jobs.get(body.id)));return;
  }
  if(req.url.startsWith('/calculate/')){res.end(JSON.stringify({snapshotId:body.envelope.snapshot.id,calculationVersion:'scenario-v1.2',totals:{units:3,netRevenueCents:30000,contributionMarginCents:null},limitations:['离线计算传输样本']}));return;}
  const [,prefix,id,action]=req.url.split('/');const job=jobs.get(id);if(prefix!=='runs'||!job){res.writeHead(404);res.end('{}');return;}
  if(action==='cancel'){
   job.status='cancelled';job.observability.cancellationPending=true;job.result=result();job.steps.push({message:'停止新的分析，保存已有结论',at:'2026-10-04T08:00:01Z'});job.settleReads=0;
  }else if(action==='resume'){
   if(job.blocked){res.writeHead(409);res.end(JSON.stringify({detail:job.error}));return;}
   job.status='completed';job.result=result(true);job.error=null;job.observability={...job.observability,cancellationPending:false,retryable:false,queuePosition:null,modelReplays:1};
  }else if(job.status==='cancelled'&&job.observability.cancellationPending){
   job.settleReads++;if(job.settleReads>=2){job.observability.cancellationPending=false;job.observability.finishedAt='2026-10-04T08:00:04Z';job.observability.runSeconds=4.25;}
  }
  if(job.disconnect){job.disconnect=false;req.socket.destroy();return;}
  const reply={...job};delete reply.blocked;delete reply.disconnect;delete reply.settleReads;res.end(JSON.stringify(reply));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 await db.prepare('INSERT INTO businesses(id,name) VALUES(?,?)').bind('neo-sim-runtime-isolated','隔离合成企业').run();
 await db.prepare('INSERT INTO business_members(id,business_id,user_id,role) VALUES(?,?,?,?)').bind('isolated-owner','neo-sim-runtime-isolated','local-owner','admin').run();
 for(const business of ['test-a','test-b','neo-sim-runtime-isolated']){
  const id=business==='test-a'?'runtime-snap':'runtime-'+business;
  const s={id,businessId:business,dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-09-14',periodEnd:'2026-09-20',data:{inventory:[]},evidenceIds:{orders:'ev-orders'},limitations:[]};
  await db.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(id,business,'demo','2026-10-04',JSON.stringify(s)).run();
 }
});
after(async()=>{await writeFile(OUT+'/offline-http-calls.json',JSON.stringify({calls,total:calls.length,realModelCalls:0,realSearchCalls:0},null,2));await mf?.dispose();server?.closeAllConnections();await new Promise(r=>server.close(r));});

test('queued observation persists without inventing a finding or currency cost',async()=>{
 const {run}=await submit('queue');assert.equal(run.status,'queued');assert.equal(run.result,null);assert.equal(run.observability.reportedTokens,12);assert.equal(run.observability.estimatedOrReservedTokens,100);
 const again=await request('agent-runs/'+run.id+'/observability?'+q);assert.equal(again.data.observability.inputHash,run.observability.inputHash);assert.equal(again.data.observability.queuePosition,1);
 assert.equal(runBusinessStatus(run),'等待分析');assert.ok(runNeedsRefresh(run));
});
test('metric verification requests reach the worker as factual queries',async()=>{
 for(const question of ['请核对一下库存量。','帮我核对收入','核对毛利']){
  const {run}=await submit(question);
  assert.equal(payloads.get(run.id).taskType,'QUERY',question);
  assert.equal(JSON.parse((await raw(run.id)).payload).taskType,'QUERY',question);
 }
});
test('cancel two readbacks preserve partial specialists, steps, evidence and immutable payload',async()=>{
 const {run}=await submit('cancel');const before=await raw(run.id);
 const cancelled=await request(`agent-runs/${run.id}/cancel?${q}`,'POST',{});assert.equal(cancelled.data.observability.cancellationPending,true);assert.ok(runNeedsRefresh(cancelled.data));assert.equal(cancelled.data.result.finding,null);
 assert.equal(cancelled.data.result.specialists.conversion.conclusion,finding.conclusion);assert.equal(cancelled.data.result.marketEvidence.length,1);
 const blocked=await request(`agent-runs/${run.id}/resume?${q}`,'POST',{});assert.equal(blocked.status,409);assert.match(blocked.data.error.message,/收尾/);
 const first=await request(`agent-runs/${run.id}?${q}`);assert.equal(first.data.observability.cancellationPending,true);assert.ok(runNeedsRefresh(first.data));
 const second=await request(`agent-runs/${run.id}?${q}`);assert.equal(second.data.observability.cancellationPending,false);assert.equal(runNeedsRefresh(second.data),false);assert.ok(canResumeRun(second.data));
 assert.equal(second.data.result.specialists.conversion.conclusion,finding.conclusion);assert.equal(second.data.result.marketEvidence.length,1);assert.equal(second.data.steps.length,2);assert.match(runBusinessStatus(second.data),/保留已有结论/);
 const after=await raw(run.id);assert.equal(after.payload,before.payload);assert.equal(after.request_hash,before.request_hash);
});
test('explicit resume returns actual already completed state without creating a new run',async()=>{
 const {run}=await submit('resume-completed');jobs.get(run.id).status='failed';jobs.get(run.id).result=result();jobs.get(run.id).error='已知拒绝，可恢复';jobs.get(run.id).observability.retryable=true;
 await request(`agent-runs/${run.id}?${q}`);const n=payloads.size;const resumed=await request(`agent-runs/${run.id}/resume?${q}`,'POST',{});
 assert.equal(resumed.data.status,'completed');assert.equal(resumed.data.id,run.id);assert.equal(resumed.data.result.partial,false);assert.equal(resumed.data.observability.modelReplays,1);assert.equal(payloads.size,n);
});
test('failed legacy record gets one current partial readback even when previously terminal',async()=>{
 const {run}=await submit('failed-old');jobs.get(run.id).status='failed';jobs.get(run.id).result=result();jobs.get(run.id).error='后续调查未完成';
 await db.prepare("UPDATE neo_runs SET status='failed',result=NULL WHERE id=?").bind(run.id).run();
 const r=await request(`agent-runs/${run.id}?${q}`);assert.equal(r.status,200);assert.equal(r.data.result.finding,null);assert.equal(r.data.result.specialists.conversion.conclusion,finding.conclusion);assert.equal(r.data.error,'后续调查未完成');
});
test('unknown model call and budget boundaries retain original reasons; no implicit retry',async()=>{
 for(const [code,error] of [['MODEL_CALL_UNCERTAIN','模型调用计费状态未知，不能恢复'],['MODEL_CALL_BUDGET','本任务已达到模型调用次数上限']]){
  const {run}=await submit(code);const job=jobs.get(run.id);job.status='failed';job.blocked=true;job.error=error;job.result=result();job.observability.errorCode=code;job.observability.retryable=false;
  const before=payloads.size;const observed=await request(`agent-runs/${run.id}?${q}`);assert.equal(canResumeRun(observed.data),false);
  const resume=await request(`agent-runs/${run.id}/resume?${q}`,'POST',{});assert.equal(resume.status,409);assert.equal(resume.data.error.message,error);assert.equal(payloads.size,before);
  const cached=await raw(run.id);assert.equal(cached.error,error);assert.equal(JSON.parse(cached.result).specialists.conversion.conclusion,finding.conclusion);
 }
});
test('unlimited budget travels in immutable payload; retries with reordered keys are idempotent',async()=>{
 const {run,body}=await submit('budget',{budget:{maxModelCalls:2,maxMarketSearches:0,timeoutSeconds:10}});const p=payloads.get(run.id);assert.deepEqual(p.budget,{maxMarketSearches:0,maxModelCalls:null,maxToolCalls:null,timeoutSeconds:10,maxTokens:null,completionTokens:null});
 const repeated=await request('agent-runs?'+q,'POST',{...body,budget:{timeoutSeconds:10,maxMarketSearches:0,maxModelCalls:2}});assert.equal(repeated.data.id,run.id);
 assert.equal((await request('agent-runs?'+q,'POST',{...body,budget:{maxModelCalls:3}})).status,409);
 assert.equal(validatedBudget({timeoutSeconds:1800}).timeoutSeconds,1800);
 for(const budget of [{maxTokens:0},{timeoutSeconds:1801},{unknown:1},{maxMarketSearches:-1}])assert.equal((await request('agent-runs?'+q,'POST',{...body,requestId:crypto.randomUUID(),budget})).status,422);
});
test('stored terminal failure does not fan out remote reads; pending communication failure remains recoverable',async()=>{
 const {run}=await submit('communication');const job=jobs.get(run.id);job.status='failed';job.result=result();job.error='原始调查错误';await request(`agent-runs/${run.id}?${q}`);const original=await raw(run.id);
 job.disconnect=true;const callCount=calls.length;const read=await request(`agent-runs/${run.id}?${q}`);assert.equal(read.data.error,'原始调查错误');assert.equal(read.data.communicationError,undefined);assert.equal(read.data.result.specialists.conversion.conclusion,finding.conclusion);assert.equal(calls.length,callCount);
 const pending=await submit('dispatch-failure');const pBefore=await raw(pending.run.id);await db.prepare("UPDATE neo_runs SET status='pending_dispatch' WHERE id=?").bind(pending.run.id).run();jobs.get(pending.run.id).disconnect=true;
 const failure=await request(`agent-runs/${pending.run.id}?${q}`);assert.equal(failure.data.status,'pending_dispatch');assert.ok(failure.data.communicationError);
 const recovered=await request('agent-runs?'+q,'POST',pending.body);assert.equal(recovered.data.id,pending.run.id);assert.equal(recovered.data.status,'queued');assert.equal((await raw(pending.run.id)).payload,pBefore.payload);assert.equal((await raw(run.id)).payload,original.payload);
});
test('tenant, nature, snapshot, membership and write permissions rejected before HTTP',async()=>{
 const {run}=await submit('scope');let n=calls.length;
 for(const suffix of ['businessId=test-b','businessId=test-a&snapshotId=another','businessId=test-a&dataNature=business'])assert.equal((await request(`agent-runs/${run.id}?${suffix}`)).status,404);
 assert.equal((await request(`agent-runs/${run.id}/cancel?${q}`,'POST',{},configuredRuntime({DB:db,NEO_AGENT_EXECUTION_MODE:'offline',NEO_OFFLINE_AGENT_URL:base,NEO_SERVICE_TOKEN:'offline-token'},{...local,userId:'local-reader'}))).status,403);
 assert.equal(calls.length,n);
});
test('input hash drift or foreign service response cannot replace saved payload and result',async()=>{
 const {run}=await submit('hash');const before=await raw(run.id);jobs.get(run.id).observability.inputHash='different-version';assert.equal((await request(`agent-runs/${run.id}?${q}`)).status,409);assert.equal((await raw(run.id)).result,before.result);
 jobs.get(run.id).observability.inputHash=run.observability.inputHash;jobs.get(run.id).id='foreign';assert.equal((await request(`agent-runs/${run.id}?${q}`)).status,200);assert.ok((await request(`agent-runs/${run.id}?${q}`)).data.communicationError);assert.equal((await raw(run.id)).payload,before.payload);
});
test('later import and fresh domain rows never refresh the frozen retry payload',async()=>{
 const {run,body}=await submit('frozen');const original=await raw(run.id);const originalInput=payloads.get(run.id).envelope;
 await db.prepare('INSERT INTO neo_domain_records VALUES(?,?,?,?,?,?)').bind('late-row','test-a','demo','products',JSON.stringify({id:'late-product',name:'后来的商品'}),'2026-10-05').run();
 const repeated=await request('agent-runs?'+q,'POST',body);assert.equal(repeated.data.id,run.id);assert.equal((await raw(run.id)).payload,original.payload);assert.deepEqual(payloads.get(run.id).envelope,originalInput);
});
test('real product runtime bindings close patrol; client cannot reopen it or enable autoRepeat',async()=>{
 const rt=runtime({NEO_DISABLE_AUTOMATIC_PATROL:'true'});const n=calls.length;
 const policy=await request('agent-policy?'+q,'GET',undefined,rt);assert.equal(policy.data.automaticPatrolAllowed,false);
 const blocked=await request('agent-runs?'+q,'POST',{...scope,mode:'joint',purpose:'patrol',question:'巡检',requestId:'fake-switch',disableAutomaticPatrol:false,autoRepeat:true},rt);assert.equal(blocked.status,403);assert.equal(calls.length,n);
 const manual=await request('agent-runs?'+q,'POST',{...scope,mode:'conversion',question:'人工离线查询',requestId:'manual-offline',autoRepeat:true},rt);assert.equal(manual.status,202);assert.equal(payloads.get(manual.data.id).autoRepeat,false);
});
test('isolated business cannot reach normal agent service even without an explicit disable flag',async()=>{
 const sq='businessId=neo-sim-runtime-isolated&snapshotId=runtime-neo-sim-runtime-isolated&dataNature=demo';const rt=runtime({NEO_AGENT_EXECUTION_MODE:'live',NEO_AGENT_URL:base,NEO_DISABLE_AUTOMATIC_PATROL:'false'});const n=calls.length;
 const policy=await request('agent-policy?'+sq,'GET',undefined,rt);assert.equal(policy.data.isolated,true);assert.equal(policy.data.interactiveAllowed,false);
 const patrol=await request('agent-runs?'+sq,'POST',{snapshotId:'runtime-neo-sim-runtime-isolated',dataNature:'demo',mode:'joint',purpose:'patrol',question:'页面启动巡检',requestId:'sim-patrol',NEO_AGENT_EXECUTION_MODE:'offline'},rt);assert.equal(patrol.status,403);assert.equal(calls.length,n);
 const run=await request('agent-runs?'+sq,'POST',{snapshotId:'runtime-neo-sim-runtime-isolated',dataNature:'demo',mode:'market',question:'尝试搜索',requestId:'sim-search'},rt);assert.equal(run.status,403);assert.equal(calls.length,n);
});
test('normal snapshot creation and original frontend patrol request make zero service calls for isolated scope',async()=>{
 const business='neo-sim-runtime-isolated';const rt=runtime({NEO_AGENT_EXECUTION_MODE:'live',NEO_AGENT_URL:base});
 const csv=await readFile('public/import-samples/demo-orders.csv','utf8');const form=new FormData();for(const [k,v] of Object.entries({kind:'orders',sourceName:'隔离订单源',dataNature:'demo',coverageStart:'2026-09-01',coverageEnd:'2026-09-02',templateVersion:'1'}))form.set(k,v);form.set('file',new File([csv],'orders.csv'));
 const upload=await handleApi(new Request('http://localhost/api/v1/ingestion-batches?businessId='+business,{method:'POST',headers:{origin:'http://localhost'},body:form}),rt);const u=await upload.json();assert.equal(upload.status,201,JSON.stringify(u));
 assert.equal((await request(`ingestion-batches/${u.batch.id}/commit?businessId=${business}`,'POST',{validationVersion:u.batch.validation_version},rt)).status,200);
 const n=calls.length;const snap=await request('operating-snapshots?businessId='+business,'POST',{dataNature:'demo',asOf:'2026-09-02',periodStart:'2026-09-01',periodEnd:'2026-09-02'},rt);assert.equal(snap.status,201,JSON.stringify(snap));assert.equal(snap.data.patrol.status,'disabled');assert.equal(calls.length,n);
 const frontend=await request('agent-runs?businessId='+business,'POST',{snapshotId:snap.data.snapshot.id,dataNature:'demo',mode:'joint',purpose:'patrol',requestId:'frontend-patrol',question:'主动巡检当前经营快照'},rt);assert.equal(frontend.status,403);assert.equal(calls.length,n);
 await writeFile(OUT+'/patrol-isolation-calls.json',JSON.stringify({snapshotId:snap.data.snapshot.id,businessId:business,normalSnapshotStatus:snap.status,frontendPatrolStatus:frontend.status,callsBefore:n,callsAfter:calls.length,externalOrAgentCallsDuringIsolatedSnapshotAndPatrol:0,usesActualConfiguredRuntimeAndD1:true},null,2));
});
test('offline endpoints cannot point to original ports or external servers; invalid modes fail closed',async()=>{
 const {run}=await submit('offline-base');const n=calls.length;
 for(const url of ['http://127.0.0.1:8127','http://127.0.0.1:3000','https://external.invalid:9000']){const response=await request(`agent-runs/${run.id}?${q}`,'GET',undefined,runtime({NEO_OFFLINE_AGENT_URL:url}));assert.ok(response.data.communicationError);}
 assert.equal(calls.length,n);
 const rt=runtime({NEO_AGENT_EXECUTION_MODE:'typo'});assert.equal((await request('agent-runs?'+q,'POST',{...scope,mode:'joint',question:'无效模式',requestId:'invalid-mode'},rt)).status,403);
});

test('offline service must attest no model/search/patrol before any run is submitted',async()=>{
 const before=calls.filter(x=>x.path==='/runs').length;
 healthReady=false;
 try{const response=await request('agent-runs?'+q,'POST',{...scope,mode:'conversion',question:'健康声明不符',requestId:'health-proof'});assert.equal(response.status,202);assert.equal(response.data.status,'pending_dispatch');assert.match(response.data.communicationError,/未证明/);assert.equal(calls.filter(x=>x.path==='/runs').length,before);}finally{healthReady=true;}
});
test('closed automatic patrol preserves deterministic forecast calculation for isolated data',async()=>{
 const business='neo-sim-runtime-isolated';const rt=runtime({NEO_AGENT_EXECUTION_MODE:'live',NEO_AGENT_URL:base,NEO_DISABLE_AUTOMATIC_PATROL:'true'});
 const before=calls.filter(x=>x.path==='/runs').length;
 const response=await request('forecasts?businessId='+business,'POST',{snapshotId:'runtime-neo-sim-runtime-isolated',dataNature:'demo',requestId:'deterministic-only'},rt);
 assert.equal(response.status,201,JSON.stringify(response));assert.equal(response.data.calculationVersion,'scenario-v1.2');assert.equal(response.data.totals.netRevenueCents,30000);assert.equal(calls.filter(x=>x.path==='/runs').length,before);
});
test('completed legacy business result is not rewritten during ordinary readback',async()=>{
 const {run}=await submit('legacy-complete');const original=JSON.stringify({finding,specialists:{conversion:finding},marketEvidence:[],model:'legacy'});await db.prepare("UPDATE neo_runs SET status='completed',result=? WHERE id=?").bind(original,run.id).run();const before=await raw(run.id);const n=calls.length;
 const response=await request(`agent-runs/${run.id}?${q}`);assert.equal(response.data.status,'completed');assert.equal((await raw(run.id)).result,before.result);assert.equal((await raw(run.id)).payload,before.payload);assert.equal(calls.length,n);
});

test('server shutdown of new analysis still permits stopping and reading an existing task',async()=>{
 const {run}=await submit('disabled-existing');const rt=runtime({NEO_AGENT_EXECUTION_MODE:'disabled',NEO_AGENT_URL:base});
 const blocked=await request('agent-runs?'+q,'POST',{...scope,mode:'joint',question:'不能新发起',requestId:'disabled-new'},rt);assert.equal(blocked.status,403);
 const stopped=await request(`agent-runs/${run.id}/cancel?${q}`,'POST',{},rt);assert.equal(stopped.status,200);assert.equal(stopped.data.observability.cancellationPending,true);
 const read=await request(`agent-runs/${run.id}?${q}`,'GET',undefined,rt);assert.equal(read.status,200);
 assert.equal((await request(`agent-runs/${run.id}/resume?${q}`,'POST',{},rt)).status,403);
});

test('calculation-only offline policy blocks chat before saving a session or calling service',async()=>{
 const rt=runtime({NEO_OFFLINE_AGENT_INTERACTIVE:'false'}),n=calls.length;
 const before=(await db.prepare('SELECT count(*) n FROM neo_sessions').first()).n;
 assert.equal((await request('agent-policy?'+q,'GET',undefined,rt)).data.interactiveAllowed,false);
 assert.equal((await request('agent-runs?'+q,'POST',{...scope,mode:'conversion',question:'查看订单',requestId:'offline-blocked'},rt)).status,403);
 assert.equal((await db.prepare('SELECT count(*) n FROM neo_sessions').first()).n,before);assert.equal(calls.length,n);
});
test('only a server allowlist enables manual synthetic chat and browser cannot restore patrol/search',async()=>{
 const business='neo-sim-runtime-isolated',sq='businessId='+business+'&snapshotId=runtime-'+business+'&dataNature=demo';
 const rt=runtime({NEO_AGENT_EXECUTION_MODE:'live',NEO_AGENT_URL:base,NEO_MANUAL_AGENT_BUSINESSES:business,NEO_DISABLE_AUTOMATIC_PATROL:'false'});
 const policy=(await request('agent-policy?'+sq,'GET',undefined,rt)).data;assert.equal(policy.interactiveAllowed,true);assert.equal(policy.manualModelAllowed,true);assert.equal(policy.automaticPatrolAllowed,false);
 const body={snapshotId:'runtime-'+business,dataNature:'demo',mode:'market',question:'核对已保存渠道费用',requestId:'manual-authorized',autoRepeat:true,budget:{maxMarketSearches:2}};
 const submitted=await request('agent-runs?'+sq,'POST',body,rt);assert.equal(submitted.status,202,JSON.stringify(submitted));const p=payloads.get(submitted.data.id);assert.equal(p.autoRepeat,false);assert.equal(p.budget.maxMarketSearches,0);
 const again=await request('agent-runs?'+sq,'POST',body,rt);assert.equal(again.data.id,submitted.data.id);
 const n=calls.length;assert.equal((await request('agent-runs?'+sq,'POST',{...body,requestId:'manual-patrol',mode:'joint',purpose:'patrol'},rt)).status,403);assert.equal(calls.length,n);
 assert.equal((await request('agent-policy?businessId=test-a&snapshotId=runtime-snap&dataNature=demo','GET',undefined,rt)).data.manualModelAllowed,false);
});
test('large conversation retains every frozen fact in a compact durable job and remains idempotent',async()=>{
 const {encodeInput,decodeInput}=await import('../server/input-storage.ts');
 const original=JSON.parse((await db.prepare('SELECT payload FROM operating_snapshots WHERE id=?').bind(scope.snapshotId).first()).payload);
 const at='2026-10-04T08:00:00Z',s={...original,id:'chat-large-snapshot',knownAt:at};await db.prepare('INSERT INTO operating_snapshots(id,business_id,data_nature,generated_at,payload) VALUES(?,?,?,?,?)').bind(s.id,'test-a','demo',at,JSON.stringify(s)).run();
 await db.prepare("INSERT INTO data_sources(id,business_id,name) VALUES('chat-large-source','test-a','大输入测试来源')").run();
 await db.prepare("INSERT INTO ingestion_batches(id,business_id,source_id,kind,data_nature,template_version,file_hash,object_key,filename,coverage_start,coverage_end,status,created_at,committed_at,actor_id) VALUES('chat-large-batch','test-a','chat-large-source','events','demo','v1','chat-large','test','test.csv','2026-09-01','2026-09-24','committed',?,?, 'local-owner')").bind(at,at).run();
 await db.prepare("INSERT INTO evidence_records(id,business_id,snapshot_id,payload) VALUES('chat-large-evidence','test-a',?,'{}')").bind(s.id).run();
 const facts=Array.from({length:3259},(_,i)=>({id:'chat-fact-'+i,kind:'events',sourceId:'chat-large-source',availableAt:at,fact:{note:'保留原始资料与证据'.repeat(100),quantity:1}}));
 for(let offset=0;offset<facts.length;offset+=50)await db.batch(facts.slice(offset,offset+50).flatMap((f,i)=>[
  db.prepare("INSERT INTO business_facts(id,business_id,source_id,batch_id,row_number,kind,data_nature,record_key,content_hash,occurred_at,business_date,payload) VALUES(?,'test-a','chat-large-source','chat-large-batch',?,'events','demo',?,?,'2026-09-01T00:00:00Z','2026-09-01',?)").bind(f.id,offset+i+1,f.id,f.id,JSON.stringify(f.fact)),
  db.prepare("INSERT INTO evidence_facts(id,evidence_id,fact_id) VALUES(?,'chat-large-evidence',?)").bind('link-'+f.id,f.id)
 ]));
 const fixed={snapshot:s,facts,domain:{products:[],skus:[],roles:[],arrivals:[]}};assert.ok(Buffer.byteLength(JSON.stringify(fixed))>1900000);
 await db.prepare('INSERT INTO neo_inputs(id,business_id,snapshot_id,payload,created_at) VALUES(?,?,?,?,?)').bind('large-fixed-input','test-a',s.id,await encodeInput(fixed),'2026-10-04T08:00:00Z').run();
 const query='businessId=test-a&snapshotId='+s.id+'&dataNature=demo',body={snapshotId:s.id,dataNature:'demo',mode:'conversion',question:'从完整资料核对订单',requestId:'chat-large-once'};
 const answer=await request('agent-runs?'+query,'POST',body);assert.equal(answer.status,202,JSON.stringify(answer));const saved=await raw(answer.data.id),payload=JSON.parse(saved.payload);assert.ok(payload.envelope.envelopePacked);assert.ok(Buffer.byteLength(saved.payload)<1900000);
 const p=payload.envelope.envelopePacked,expanded=await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',rawBytes:p.rawBytes,payload:p.payload}));assert.deepEqual(expanded.facts,facts);assert.equal(expanded.snapshot.id,s.id);assert.ok(expanded.decisionContext);assert.deepEqual(payloads.get(answer.data.id),payload);
 assert.equal((await request('agent-runs?'+query,'POST',body)).data.id,answer.data.id);assert.equal((await db.prepare('SELECT count(*) n FROM neo_runs WHERE request_id=?').bind(body.requestId).first()).n,1);
});

test('assessment projections persist identical scoped external references and do not regenerate on read',async()=>{
 const {run}=await submit('shared-assessment-reference');const job=jobs.get(run.id);
 const professional=Object.fromEntries(['conversion','supply','market'].map(role=>[role,{title:role,summary:finding.conclusion,evidenceIds:['market-1']}]))
 const final={...structuredClone(finding),organization:{headline:'同一经营判断',summary:finding.conclusion,priorities:[],comparisons:[],savedChoices:[],nextChecks:[]},homeDecision:{judgment:professional.market}};
 const specialists=Object.fromEntries(Object.entries(professional).map(([role,r])=>[role,{...structuredClone(finding),businessReview:r}]));
 const operatingReviews={market:{evidenceIds:['market-1'],selectedSourceIds:['market-1']}};
 job.status='completed';job.result={finding:final,specialists,marketEvidence:[structuredClone(market)],operatingReviews,businessAssessment:{version:'business-assessment-v1',scope:{businessId:'test-a',dataNature:'demo',inputId:scope.snapshotId,configurationVersion:'legacy:legacy-unversioned'},context:{completeReview:true,semanticValidation:{status:'verified',version:'semantic-support-v1'}},projections:{finding:final,specialists,professional,operatingReviews,marketEvidence:[structuredClone(market)],brief:final.organization}}};
 const observed=await request(`agent-runs/${run.id}?${q}`);assert.equal(observed.status,200);
 const saved=JSON.parse((await raw(run.id)).result),id=run.id+':market-1';
 assert.deepEqual(saved.operatingReviews.market.selectedSourceIds,[id]);
 assert.deepEqual(saved.businessAssessment.projections.operatingReviews,saved.operatingReviews);
 assert.deepEqual(saved.businessAssessment.projections.finding,saved.finding);
 assert.deepEqual(saved.businessAssessment.projections.professional.market.evidenceIds,[id]);
 assert.deepEqual(saved.finding.homeDecision.judgment.evidenceIds,[id]);
 const count=payloads.size;
 const shared=await request('growth-reviews?'+q);assert.equal(shared.status,200);
 assert.ok(Object.values(shared.data.reviews).every(r=>r.id===run.id));
 const brief=await request('briefings/today?'+q);assert.equal(brief.data.organization.id,run.id);assert.equal(brief.data.organization.result.finding.organization.headline,'同一经营判断');
 const manual=await submit('later-independent-query',{mode:'conversion'});jobs.get(manual.run.id).status='completed';jobs.get(manual.run.id).result=result(true);await request(`agent-runs/${manual.run.id}?${q}`);
 const repeated=await request('growth-reviews?'+q);assert.ok(Object.values(repeated.data.reviews).every(r=>r.id===run.id));assert.equal(payloads.size,count+1);
});

test('canonical explicit replay preserves frozen saved records after new artifacts and rejects changed intent',async()=>{
 const {buildBusinessState}=await import('../lib/business-state.ts');const {calculateScenario}=await import('../lib/business-scenarios.ts');const {defaultPlatformSettings}=await import('../lib/platform-settings.ts');
 const profile={industry:'ecommerce',timezone:'Asia/Shanghai',name:'离线重试验收',region:'CN',horizonDays:3,objective:'contribution_margin',cashBudgetCents:null,competitors:[],expectedSources:[{sourceId:'erp',kinds:['order','expense','inventory']}]};
 const state=buildBusinessState({businessId:'test-a',dataNature:'demo',profileVersion:'retry-profile',profile,asOf:'2026-09-30',knownAt:'2026-10-07T00:00:00Z',start:'2026-09-01',end:'2026-09-30'},[],[]);
 const g={version:'operating-generation-v1.1',id:'generation-retry-a',sourceKey:'retry-source-a',state,configuration:{id:'retry-config',settings:defaultPlatformSettings()},baseline:calculateScenario(state,{id:'baseline',name:'维持现状',demandBps:10000,actions:[]},'generation-retry-a'),steps:[],createdAt:state.knownAt};
 for(const value of [g,{...g,id:'generation-retry-other',sourceKey:'retry-source-other'}])await db.prepare("INSERT INTO neo_business_generations(id,business_id,data_nature,source_key,status,payload,created_at,updated_at) VALUES(?,'test-a','demo',?,'calculated',?,?,?)").bind(value.id,value.sourceKey,JSON.stringify(value),g.createdAt,g.createdAt).run();
 const artifact=async(id)=>{const v={id,businessId:'test-a',dataNature:'demo',generationId:g.id,status:'saved_decision',createdAt:'2026-10-07T01:00:00Z',scenario:{id:'supply',name:'确认供给'},reason:'先核对约束'};await db.prepare("INSERT INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,payload,created_at) VALUES(?,'test-a','demo',?,'business_decision',?,?,?,?)").bind(id,g.id,id,id,JSON.stringify(v),v.createdAt).run();};
 await artifact('retry-choice-before');
 const rt=runtime({NEO_AGENT_EXECUTION_MODE:'live',NEO_AGENT_URL:base}),query=`businessId=test-a&dataNature=demo&snapshotId=${g.id}`;
 const body={snapshotId:g.id,dataNature:'demo',mode:'orchestrator',question:'列出已保存选择记录',requestId:'canonical-stable-request',budget:{maxTokens:11000,maxModelCalls:2}};
 healthReady=false;
 try{
  const first=await request('agent-runs?'+query,'POST',body,rt);assert.equal(first.status,202,JSON.stringify(first));const id=first.data.id.split('~')[0],original=await raw(id),frozen=JSON.parse(original.payload),basisHash=createHash('sha256').update(JSON.stringify(frozen.envelope.operatingBasis)).digest('hex');
  assert.equal(frozen.taskType,'QUERY');assert.equal(frozen.budget.maxTokens,null);assert.equal(frozen.budget.maxModelCalls,null);assert.deepEqual(frozen.envelope.operatingBasis.savedRecords.records.map(r=>r.id),['retry-choice-before']);
  await artifact('retry-choice-after');const count=payloads.size,healthCalls=calls.filter(c=>c.path==='/health').length;
  const repeated=await request('agent-runs?'+query,'POST',body,rt);assert.equal(repeated.status,202,JSON.stringify(repeated));assert.equal(repeated.data.id,first.data.id);assert.equal(payloads.size,count);assert.equal(calls.filter(c=>c.path==='/health').length,healthCalls);
  const saved=await raw(id);assert.equal(saved.payload,original.payload);assert.equal(saved.request_hash,original.request_hash);assert.equal(createHash('sha256').update(JSON.stringify(JSON.parse(saved.payload).envelope.operatingBasis)).digest('hex'),basisHash);
  for(const change of [{question:'解释已保存选择记录'},{mode:'joint'},{sessionId:frozen.sessionId},{budget:{maxTokens:10000,maxModelCalls:2}},{budget:{maxTokens:11000,maxModelCalls:1}}]){const r=await request('agent-runs?'+query,'POST',{...body,...change},rt);assert.equal(r.status,409,JSON.stringify(r));}
  const changedGeneration=await request('agent-runs?'+query.replace(g.id,'generation-retry-other'),'POST',{...body,snapshotId:'generation-retry-other'},rt);assert.equal(changedGeneration.status,409,JSON.stringify(changedGeneration));
  const changedNature=await request('agent-runs?'+query.replace('dataNature=demo','dataNature=business'),'POST',{...body,dataNature:'business'},rt);assert.equal(changedNature.status,404);
  const foreign=await request('agent-runs?'+query.replace('businessId=test-a','businessId=test-b'),'POST',body,rt);assert.equal(foreign.status,404);assert.equal(payloads.size,count);
  // Existing pre-fix request keys also reuse their verified original envelope.
  const legacy=structuredClone(frozen);legacy.id='run-canonical-legacy-retry';delete legacy.envelope.operatingRequest;delete legacy.envelope.requestedBudget;
  legacy.budget={maxAttempts:3,maxToolCalls:4,maxMarketSearches:0,timeoutSeconds:600,maxTokens:12000,maxModelCalls:3,completionTokens:1200};
  const {runtimeScope,...oldFixed}=legacy.envelope,oldHash=createHash('sha256').update(JSON.stringify(oldFixed)).digest('hex'),legacyRaw=JSON.stringify(legacy);
  await db.prepare("INSERT INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) SELECT ?,business_id,data_nature,snapshot_id,session_id,?,?,?,status,steps,result,created_at,updated_at FROM neo_runs WHERE id=?").bind(legacy.id,'operating-review:old-source:legacy-stable-request',oldHash,legacyRaw,id).run();
  await db.prepare('UPDATE neo_runs SET result=? WHERE id=?').bind(JSON.stringify({__observationOnly:true,runtime:observation(legacy)}),legacy.id).run();
  payloads.set(legacy.id,legacy);jobs.set(legacy.id,{...structuredClone(jobs.get(id)),id:legacy.id,observability:observation(legacy)});
  const {budget,...legacyBody}=body,legacyCount=payloads.size;
  const oldReplay=await request('agent-runs?'+query,'POST',{...legacyBody,requestId:'legacy-stable-request'},rt);assert.equal(oldReplay.status,202,JSON.stringify(oldReplay));assert.equal(oldReplay.data.id.split('~')[0],legacy.id);assert.equal(payloads.size,legacyCount);assert.equal((await raw(legacy.id)).payload,legacyRaw);

 }finally{healthReady=true;}
});

test('canonical growth refresh POST and GET expose delayed/failed full review and trace previous complete display',async()=>{
 const {calculateScenario}=await import('../lib/business-scenarios.ts');
 const g=JSON.parse((await db.prepare('SELECT payload FROM neo_business_generations WHERE id=?').bind('generation-retry-a').first()).payload);
 g.id='generation-canonical-lifecycle';g.sourceKey='canonical-lifecycle-source';delete g.configuration.id;g.baseline=calculateScenario(g.state,{id:'baseline',name:'维持现状',demandBps:10000,actions:[]},g.id);
 await db.prepare("INSERT INTO neo_business_generations(id,business_id,data_nature,source_key,status,payload,created_at,updated_at) VALUES(?,'test-a','demo',?,'calculated',?,?,?)").bind(g.id,g.sourceKey,JSON.stringify(g),g.createdAt,g.createdAt).run();
 const rt=runtime({NEO_AGENT_EXECUTION_MODE:'live',NEO_AGENT_URL:base}),query=`businessId=test-a&dataNature=demo&snapshotId=${g.id}`,body={snapshotId:g.id,dataNature:'demo'};
 const read=()=>request('growth-reviews?'+query,'GET',undefined,rt),start=id=>request('growth-reviews?'+query,'POST',{...body,requestId:id},rt),sync=()=>synchronizeAgentRuns({db:rt.DB,runtime:rt,userId:'computation-worker',businessId:'test-a',businessName:'测试企业A',role:'admin'},'demo',100),rawId=r=>r.data.reviews.conversion.id.split('~')[0];
 const full=label=>{const review={headline:label,explanation:label+'，条件仍须核对。',claims:[],confirmations:[],nextAction:{title:'核对约束',reason:'基于已保存依据',condition:'约束确认后'},limitations:[],evidenceIds:[],selectedSourceIds:[]};const reviews=Object.fromEntries(['conversion','supply','market','joint'].map(role=>[role,structuredClone(review)])),specialists=Object.fromEntries(['conversion','supply','market'].map(role=>[role,{...structuredClone(finding),conclusion:review.explanation,evidenceIds:[]}]));const final={...structuredClone(finding),conclusion:review.explanation,evidenceIds:[]};return {finding:final,specialists,marketEvidence:[],operatingReviews:reviews,businessAssessment:{version:'business-assessment-v1',scope:{businessId:'test-a',dataNature:'demo',inputId:g.id,configurationVersion:'retry-profile:legacy-unversioned'},context:{completeReview:true,semanticValidation:{status:'verified',version:'semantic-support-v1'}},projections:{finding:final,specialists,marketEvidence:[],operatingReviews:reviews}}};};
 healthReady=false;
 try{
  const count=payloads.size;assert.deepEqual((await read()).data.reviews,{});
  const first=await start('canonical-first-review');assert.equal(first.status,202,JSON.stringify(first));const firstId=rawId(first);assert.ok(Object.values(first.data.reviews).every(r=>r.status==='queued'&&r.id.startsWith(firstId)));assert.equal(payloads.size,count+1);
  const queued=await read();assert.equal(rawId(queued),firstId);assert.equal(queued.data.reviews.conversion.status,'queued');assert.deepEqual(queued.data.completeReviews,{});
  jobs.set(firstId,{...jobs.get(firstId),status:'running'});await sync();const running=await read();assert.equal(running.data.reviews.conversion.status,'running');
  jobs.set(firstId,{...jobs.get(firstId),status:'completed',result:full('首轮完整判断')});await sync();const done=await read();assert.equal(done.data.reviews.conversion.status,'completed');assert.equal(done.data.reviews.conversion.result.finding.businessReview.title,'首轮完整判断');
  const refreshed=await start('canonical-delayed-refresh');const secondId=rawId(refreshed);assert.notEqual(secondId,firstId);assert.equal(refreshed.data.reviews.conversion.status,'queued');assert.equal(refreshed.data.reviews.conversion.result.displayOnly,true);assert.equal(refreshed.data.reviews.conversion.result.displaySourceRunId,firstId);assert.equal(refreshed.data.completeReviews.conversion.id,firstId+'~conversion');assert.equal(refreshed.data.reviews.conversion.result.finding.businessReview.title,'首轮完整判断');
  const refreshGet=await read();assert.equal(rawId(refreshGet),secondId);assert.equal(refreshGet.data.reviews.conversion.status,'queued');
  jobs.set(secondId,{...jobs.get(secondId),status:'running'});await sync();const refreshing=await read();assert.equal(rawId(refreshing),secondId);assert.equal(refreshing.data.reviews.conversion.status,'running');assert.equal(refreshing.data.reviews.conversion.result.displaySourceRunId,firstId);assert.equal(JSON.parse((await raw(secondId)).result).businessAssessment,undefined);
  jobs.set(secondId,{...jobs.get(secondId),status:'completed',result:full('刷新后的完整判断')});await sync();const updated=await read();assert.equal(rawId(updated),secondId);assert.equal(updated.data.reviews.conversion.status,'completed');assert.equal(updated.data.reviews.conversion.result.displayOnly,undefined);assert.equal(updated.data.reviews.conversion.result.finding.businessReview.title,'刷新后的完整判断');
  const queryRun=await request('agent-runs?'+query,'POST',{...body,mode:'conversion',question:'支付订单多少',requestId:'independent-query-after-full'},rt);assert.equal(queryRun.status,202);const queryId=queryRun.data.id.split('~')[0];jobs.get(queryId).status='completed';jobs.get(queryId).result=full('独立查询');jobs.get(queryId).result.businessAssessment.context.completeReview=false;await request(`agent-runs/${queryRun.data.id}?${query}`,'GET',undefined,rt);
  const afterQuery=await read();assert.equal(rawId(afterQuery),secondId);assert.equal(afterQuery.data.reviews.conversion.result.finding.businessReview.title,'刷新后的完整判断');
  const failStarted=await start('canonical-failed-refresh');const failedId=rawId(failStarted);assert.notEqual(failedId,secondId);assert.equal(failStarted.data.reviews.conversion.status,'queued');assert.equal(failStarted.data.reviews.conversion.result.displaySourceRunId,secondId);
  jobs.set(failedId,{...jobs.get(failedId),status:'failed',error:'离线控制失败',observability:{...jobs.get(failedId).observability,errorCode:'CONTROLLED_FAILURE'}});await sync();const failed=await read();assert.equal(rawId(failed),failedId);assert.equal(failed.data.reviews.conversion.status,'failed');assert.equal(failed.data.reviews.conversion.error,'离线控制失败');assert.equal(failed.data.reviews.conversion.result.displayOnly,true);assert.equal(failed.data.reviews.conversion.result.displaySourceRunId,secondId);assert.equal(failed.data.reviews.conversion.result.finding.businessReview.title,'刷新后的完整判断');assert.equal(failed.data.completeReviews.conversion.id,secondId+'~conversion');
  const readback=await request(`business-reviews/${g.id}?businessId=test-a&dataNature=demo`,'GET',undefined,rt);assert.equal(readback.data.runId,failedId);assert.equal(readback.data.status,'failed');assert.equal(readback.data.result.displaySourceRunId,secondId);
  assert.equal(payloads.size,count+4);const posted=calls.filter(c=>c.path==='/runs').length;await read();assert.equal(calls.filter(c=>c.path==='/runs').length,posted);assert.equal(payloads.size,count+4);
 }finally{healthReady=true;}
});

test('snapshot dialogue keeps session identity across versions, four turns and traceable summary; denies actor/nature/tenant',async()=>{
 let sessionId;const originalRows=[];
 for(let i=0;i<6;i++){
  const {run}=await submit('dialogue-'+i,{...(sessionId?{sessionId}:{}),dialogueScope:{topic:'库存成本'}});sessionId=run.sessionId;
  jobs.get(run.id).status='completed';jobs.get(run.id).result=result(true);await request(`agent-runs/${run.id}?${q}`);originalRows.push(await raw(run.id));
 }
 const baseSnapshot=JSON.parse((await db.prepare('SELECT payload FROM operating_snapshots WHERE id=?').bind(scope.snapshotId).first()).payload),next={...baseSnapshot,id:'dialogue-new-snapshot'};
 await db.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(next.id,'test-a','demo','2026-10-07',JSON.stringify(next)).run();
 const body={...scope,snapshotId:next.id,sessionId,question:'继续核对库存',mode:'joint',requestId:'dialogue-new-version'};
 const r=await request('agent-runs?businessId=test-a','POST',body);assert.equal(r.status,202,JSON.stringify(r));assert.equal(r.data.sessionId,sessionId);
 const p=payloads.get(r.data.id),c=p.envelope.conversation;assert.equal(c.versionChanged,true);assert.equal(c.previousInputId,scope.snapshotId);assert.equal(c.currentInputId,next.id);assert.equal(c.recentTurns.length,4);assert.equal(c.summary.length,2);assert.equal(c.active.topic,'库存成本');assert.ok(c.summary.every(x=>x.runId&&x.evidenceStatus==='historical_not_current'));assert.ok(p.history.filter(x=>x.role==='assistant').every(x=>!x.content.includes(finding.conclusion)));
 for(const old of originalRows){const now=await raw(old.id);assert.equal(now.payload,old.payload);assert.equal(now.result,old.result);}
 const count=payloads.size;
 assert.equal((await request('agent-runs?businessId=test-b','POST',{...body,snapshotId:'runtime-test-b',requestId:'dialogue-foreign'})).status,404);
 const businessSnapshot={...next,id:'dialogue-business-snapshot',dataNature:'business'};await db.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(businessSnapshot.id,'test-a','business','2026-10-07',JSON.stringify(businessSnapshot)).run();
 assert.equal((await request('agent-runs?businessId=test-a','POST',{...body,snapshotId:businessSnapshot.id,dataNature:'business',requestId:'dialogue-nature'})).status,404);
 const otherActor=runtime();otherActor.local={...otherActor.local,userId:'local-reader'};
 assert.equal((await request('agent-sessions/'+sessionId+'?businessId=test-a','GET',undefined,otherActor)).status,404);
 assert.equal(payloads.size,count);
});

test('canonical dialogue reuses session across generations and scoped paged saved details do not call model',async()=>{
 const rt=runtime({NEO_AGENT_EXECUTION_MODE:'live',NEO_AGENT_URL:base});healthReady=false;
 try{
  const start=await request('business-reviews?businessId=test-a','POST',{dataNature:'demo',generationId:'generation-retry-a',refreshId:'dialogue-first',question:'支付订单多少',mode:'conversion',dialogueScope:{topic:'成本'}},rt);assert.equal(start.status,202,JSON.stringify(start));
  const session=start.data.sessionId,first=await raw(start.data.id);
  const continued=await request('business-reviews?businessId=test-a','POST',{dataNature:'demo',generationId:'generation-retry-other',refreshId:'dialogue-second',question:'继续核对成本',mode:'conversion',sessionId:session},rt);assert.equal(continued.status,202,JSON.stringify(continued));assert.equal(continued.data.sessionId,session);
  const p=JSON.parse((await raw(continued.data.id)).payload);assert.equal(p.envelope.conversation.versionChanged,true);assert.equal(p.envelope.conversation.active.topic,'成本');assert.equal((await raw(start.data.id)).payload,first.payload);
  const migrated=await request('business-reviews?businessId=test-a','POST',{dataNature:'demo',generationId:'generation-retry-a',refreshId:'dialogue-wrong-type',question:'继续',mode:'conversion',sessionId:(await db.prepare("SELECT id FROM neo_sessions WHERE snapshot_id='runtime-snap' LIMIT 1").first()).id},rt);assert.equal(migrated.status,202,JSON.stringify(migrated));const migration=JSON.parse((await raw(migrated.data.id)).payload).envelope.conversation;assert.equal(migration.sourceChanged,true);assert.equal(migration.previousSourceKind,'snapshot');assert.equal(migration.currentSourceKind,'generation');
  const count=payloads.size,read=await request('business-saved-records?businessId=test-a&dataNature=demo&generationId=generation-retry-a&limit=1','GET',undefined,rt);assert.equal(read.status,200);assert.ok(read.data.total>=2);assert.equal(read.data.hasMore,true);assert.equal(read.data.nextCursor,1);
  const next=await request('business-saved-records?businessId=test-a&dataNature=demo&generationId=generation-retry-a&limit=1&cursor=1','GET',undefined,rt);assert.notEqual(next.data.records[0].id,read.data.records[0].id);assert.equal(payloads.size,count);
 }finally{healthReady=true;}
});

test('publication gate clears legacy draft on failed checker and never resurrects it after resume or readback',async()=>{
 const {run}=await submit('semantic-publication');
 const bad={...finding,conclusion:'公司确认该政策适用本企业',homeDecision:{jointReview:{nextAction:{title:'补货确保利润增长',decisionGate:'没有任何履约风险'}}}};
 const prior={finding:bad,specialists:{conversion:bad},operatingReviews:{joint:{nextAction:{title:'补货确保利润增长'}}},marketEvidence:[],partial:true};
 await db.prepare('UPDATE neo_runs SET result=? WHERE id=?').bind(JSON.stringify(prior),run.id).run();
 const remote=jobs.get(run.id);remote.status='failed';remote.error='模型服务暂不可用';remote.result={...prior,runtimePlan:{taskType:'DIAGNOSE'},semanticValidation:{version:'semantic-support-v1',status:'pending'},verifiedMetrics:{orders:20}};
 let read=await request('agent-runs/'+run.id+'?'+q);assert.equal(read.data.result.finding,null);assert.deepEqual(read.data.result.specialists,{});assert.deepEqual(read.data.result.operatingReviews,{});assert.equal(read.data.result.semanticValidation.status,'pending');
 remote.observability.retryable=true;remote.result={finding:null,specialists:{},operatingReviews:{},partial:true,semanticValidation:{version:'semantic-support-v1',status:'rejected'},verifiedMetrics:{orders:20}};
 await db.prepare("UPDATE neo_runs SET status='running' WHERE id=?").bind(run.id).run();
 read=await request('agent-runs/'+run.id+'?'+q);assert.equal(read.data.result.semanticValidation.status,'rejected');assert.equal(read.data.result.finding,null);assert.deepEqual(read.data.result.operatingReviews,{});
 const saved=JSON.parse((await raw(run.id)).result);assert.equal(saved.semanticValidation.status,'rejected');assert.equal(JSON.stringify(saved).includes('确保利润'),false);
 const again=await request('agent-runs/'+run.id+'?'+q);assert.equal(again.data.result.semanticValidation.status,'rejected');assert.equal(again.data.result.finding,null);
});

test('normal same-session metric-name followup queues QUERY with inherited period and unchanged simple caps',async()=>{
 const {recognizeTask}=await import('../server/neo-task-plan.ts');
 for(const question of ['那支付和退款的商品件数呢？','退款商品数量呢','那支付笔数？','本期退款金额呢？'])assert.equal(recognizeTask(question),'QUERY',question);
 assert.equal(recognizeTask('为什么退款件数增加？'),'EXPLAIN');assert.equal(recognizeTask('诊断退款件数异常'),'DIAGNOSE');assert.equal(recognizeTask('分析退款件数呢？'),'DIAGNOSE');assert.equal(recognizeTask('如果退款件数增加呢？'),'SIMULATE');
 const first=await submit('当前统计期支付订单和退款分别有多少笔？',{mode:'conversion',requestId:'count-followup-first',dialogueScope:{period:{start:'2026-09-14',end:'2026-09-20'}}});
 const follow=await submit('那支付和退款的商品件数呢？',{mode:'conversion',sessionId:first.run.sessionId,requestId:'count-followup-next'}),payload=payloads.get(follow.run.id);
 assert.equal(follow.run.sessionId,first.run.sessionId);assert.equal(payload.taskType,'QUERY');assert.equal(payload.budget.maxTokens,null);assert.equal(payload.budget.maxModelCalls,null);assert.equal(payload.budget.completionTokens,null);
 const {decodeInput}=await import('../server/input-storage.ts');const env=payload.envelope.envelopePacked?await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',...payload.envelope.envelopePacked})):payload.envelope;
 assert.deepEqual(env.conversation.active.period,{start:'2026-09-14',end:'2026-09-20'});assert.equal(env.conversation.previousInputId,scope.snapshotId);assert.ok(JSON.stringify(env.conversation.history).includes('当前统计期支付订单和退款分别有多少笔？'));
});
