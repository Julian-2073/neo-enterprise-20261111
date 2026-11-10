import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {configuredRuntime} from '../server/runtime-config.ts';
import {handleApi} from '../server/api.ts';
import {runNeedsRefresh,canResumeRun} from '../components/neo-demo/agent-presentation.ts';
const OUT=process.cwd()+'/outputs/ts-cancel-dispatch-handoff';
const gates=new Map();
function gate(key){let arrive,release;const arrived=new Promise(r=>arrive=r),released=new Promise(r=>release=r);const value={arrived,release,arrive,released};gates.set(key,value);return value;}
async function barrier(key,id){const value=gates.get(key);if(value){gates.delete(key);value.arrive(id);await value.released;}}
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
   await barrier('dispatch:'+body.question,body.id);
   if(body.question==='unknown-dispatch'&&!jobs.get(body.id).disconnectedDispatch){jobs.get(body.id).disconnectedDispatch=true;req.socket.destroy();return;}
   res.end(JSON.stringify(jobs.get(body.id)));return;
  }
  if(req.url.startsWith('/calculate/')){res.end(JSON.stringify({snapshotId:body.envelope.snapshot.id,calculationVersion:'scenario-v1.2',totals:{units:3,netRevenueCents:30000,contributionMarginCents:null},limitations:['离线计算传输样本']}));return;}
  const [,prefix,id,action]=req.url.split('/');const job=jobs.get(id);if(prefix!=='runs'||!job){res.writeHead(404);res.end('{}');return;}
  if(action==='cancel'){
   await barrier('cancel:'+id,id);
   if(job.cancelDisconnectBefore){job.cancelDisconnectBefore=false;req.socket.destroy();return;}
   job.status='cancelled';job.observability.cancellationPending=true;job.result=result();job.steps.push({message:'停止新的分析，保存已有结论',at:'2026-10-04T08:00:01Z'});job.settleReads=0;
  }else if(action==='resume'){
   await barrier('resume:'+id,id);
   if(job.resumeDisconnectBefore){job.resumeDisconnectBefore=false;req.socket.destroy();return;}
   if(job.blocked){res.writeHead(409);res.end(JSON.stringify({detail:job.error}));return;}
   job.status=job.resumeQueued?'queued':'completed';job.result=result(true);job.error=null;job.observability={...job.observability,cancellationPending:false,retryable:false,queuePosition:null,modelReplays:1};
  }else if(job.status==='cancelled'&&job.observability.cancellationPending){
   job.settleReads++;if(job.settleReads>=2){job.observability.cancellationPending=false;job.observability.finishedAt='2026-10-04T08:00:04Z';job.observability.runSeconds=4.25;}
  }
  if(job.disconnect){job.disconnect=false;req.socket.destroy();return;}
  const reply={...job};delete reply.blocked;delete reply.disconnect;delete reply.settleReads;const captured=structuredClone(reply);await barrier('read:'+id,id);res.end(JSON.stringify(captured));
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
after(async()=>{await writeFile(OUT+'/concurrency-http-calls.json',JSON.stringify({calls,total:calls.length,realModelCalls:0,realSearchCalls:0},null,2));await mf?.dispose();server?.closeAllConnections();await new Promise(r=>server.close(r));});

const evidence=[];
after(async()=>{await writeFile(OUT+'/concurrency-evidence.json',JSON.stringify(evidence,null,2));});
async function readRun(id){return request(`agent-runs/${id}?${q}`);}
async function cancel(id){return request(`agent-runs/${id}/cancel?${q}`,'POST',{});}
async function resume(id){return request(`agent-runs/${id}/resume?${q}`,'POST',{});}
async function settle(id){let r;for(let i=0;i<5;i++){r=await readRun(id);if(!r.data.observability?.cancellationPending)break;}return r;}
async function immutable(id,before){const after=await raw(id);assert.equal(after.payload,before.payload);assert.equal(after.request_hash,before.request_hash);}

test('dispatch acknowledgement barrier: cancellation stops remote queued work and late submit cannot undo intent',async()=>{
 const block=gate('dispatch:cancel-inflight'),body={...scope,mode:'joint',question:'cancel-inflight',requestId:'cancel-inflight'};
 const submitting=request('agent-runs?'+q,'POST',body);const id=await block.arrived;const before=await raw(id);
 assert.equal(before.status,'pending_dispatch');assert.equal(jobs.get(id).status,'queued');
 let stopped;
 try{stopped=await cancel(id);assert.equal(stopped.status,200);assert.equal(stopped.data.observability.localCancelledBeforeDispatch,false);assert.equal(stopped.data.observability.cancellationPending,true);assert.equal((await resume(id)).status,409);assert.equal(jobs.get(id).status,'cancelled');}finally{block.release();}
 const late=await submitting;assert.equal(late.data.observability.gatewayCancellationRequested,true);
 const final=await settle(id);assert.equal(final.data.status,'cancelled');assert.equal(final.data.observability.cancellationPending,false);assert.ok(calls.some(x=>x.path===`/runs/${id}/cancel`));await immutable(id,before);
 evidence.push({case:'dispatch-inflight',id,remoteStatus:jobs.get(id).status,final:final.data,late:late.data,immutable:true});
});

test('unknown dispatch transport result: cancel reconciles original remote task without creating or replaying work',async()=>{
 const {run,body}=await submit('unknown-dispatch');assert.equal(run.status,'pending_dispatch');assert.equal(run.observability.gatewayDispatch,'unknown');assert.ok(run.communicationError);
 const before=await raw(run.id),n=calls.filter(x=>x.path==='/runs'&&x.id===run.id).length;assert.equal(jobs.get(run.id).status,'queued');
 const stopped=await cancel(run.id);assert.equal(stopped.status,200);await settle(run.id);
 const repeated=await request('agent-runs?'+q,'POST',body);assert.equal(repeated.data.id,run.id);assert.equal(jobs.get(run.id).status,'cancelled');assert.equal(calls.filter(x=>x.path==='/runs'&&x.id===run.id).length,n);await immutable(run.id,before);
 evidence.push({case:'unknown-dispatch',id:run.id,remoteStatus:jobs.get(run.id).status,dispatchPosts:n});
});

test('cancel communication failure persists intent and partial result; polling retries cancel, never dispatch or resume',async()=>{
 const {run}=await submit('cancel-transport');const job=jobs.get(run.id);job.status='failed';job.result=result();job.error='原始专业调查未完成';job.observability.retryable=true;await readRun(run.id);const before=await raw(run.id);
 job.cancelDisconnectBefore=true;const stopped=await cancel(run.id);assert.equal(stopped.status,200);assert.equal(stopped.data.error,job.error);assert.ok(stopped.data.communicationError);assert.equal(stopped.data.observability.cancellationPending,true);assert.equal(stopped.data.result.specialists.conversion.conclusion,finding.conclusion);assert.equal((await resume(run.id)).status,409);
 const final=await settle(run.id);assert.equal(final.data.observability.cancellationPending,false);assert.equal(jobs.get(run.id).status,'cancelled');assert.equal(final.data.error,job.error);await immutable(run.id,before);
 evidence.push({case:'cancel-transport',id:run.id,final:final.data});
});

test('repeated concurrent cancel is idempotent and cannot authorize resume while stopping',async()=>{
 const {run}=await submit('cancel-repeat');const block=gate('cancel:'+run.id),first=cancel(run.id);await block.arrived;
 let second;try{second=await cancel(run.id);assert.equal((await resume(run.id)).status,409);}finally{block.release();}
 await first;const final=await settle(run.id);assert.equal(final.data.status,'cancelled');assert.equal(final.data.observability.cancellationPending,false);assert.equal(jobs.get(run.id).status,'cancelled');assert.equal(payloads.size,jobs.size);
 evidence.push({case:'repeat-cancel',id:run.id,remoteStatus:jobs.get(run.id).status,second:second.data});
});

test('two concurrent resume requests dispatch only one resume with original identity',async()=>{
 const {run}=await submit('resume-concurrent');const job=jobs.get(run.id);job.status='failed';job.error='已知失败';job.result=result();job.observability.retryable=true;await readRun(run.id);const before=await raw(run.id);
 const block=gate('resume:'+run.id),first=resume(run.id);await block.arrived;
 try{const duplicate=await resume(run.id);assert.equal(duplicate.status,409);assert.equal(duplicate.data.error.code,'RESUME_PENDING');assert.equal(canResumeRun((await readRun(run.id)).data),false);}finally{block.release();}
 const final=await first;assert.equal(final.data.status,'completed');assert.equal(final.data.observability.resumePending,false);assert.equal(calls.filter(x=>x.path===`/runs/${run.id}/resume`).length,1);await immutable(run.id,before);
 evidence.push({case:'concurrent-resume',id:run.id,resumeCalls:1});
});

test('terminal failed runs stay local during list refresh and still allow explicit resume',async()=>{
 const {run}=await submit('terminal-failed-list');const job=jobs.get(run.id);job.status='failed';job.error='已知失败';job.result=result();job.observability.retryable=true;
 await readRun(run.id);const before=calls.filter(x=>x.path===`/runs/${run.id}`).length;
 await request('agent-runs?'+q);await request('agent-runs?'+q);
 assert.equal(calls.filter(x=>x.path===`/runs/${run.id}`).length,before,'列表刷新不应重复轮询失败终态');
 const resumed=await resume(run.id);assert.equal(resumed.status,200);assert.equal(resumed.data.status,'completed');
 assert.equal(calls.filter(x=>x.path===`/runs/${run.id}/resume`).length,1);
 evidence.push({case:'failed-list-terminal',id:run.id,listRemoteReads:0,resumeCalls:1});
});

test('cancel wins over in-flight resume, including remote work created after first cancellation acknowledgement',async()=>{
 const {run}=await submit('resume-cancel-race');const job=jobs.get(run.id);job.status='failed';job.result=result();job.error='已知失败';job.observability.retryable=true;job.resumeQueued=true;await readRun(run.id);const before=await raw(run.id);
 const block=gate('resume:'+run.id),resuming=resume(run.id);await block.arrived;
 try{const stopped=await cancel(run.id);assert.equal(stopped.data.observability.cancellationPending,true);assert.equal((await resume(run.id)).status,409);}finally{block.release();}
 const late=await resuming;assert.equal(late.data.observability.gatewayCancellationRequested,true);const final=await settle(run.id);assert.equal(jobs.get(run.id).status,'cancelled');assert.equal(final.data.observability.cancellationPending,false);assert.equal(final.data.observability.resumePending,false);assert.equal(calls.filter(x=>x.path===`/runs/${run.id}/resume`).length,1);await immutable(run.id,before);
 evidence.push({case:'cancel-over-resume',id:run.id,late:late.data,final:final.data,remoteStatus:jobs.get(run.id).status});
});

test('unknown resume response is not automatically retried; cancel can still reconcile the same task',async()=>{
 const {run}=await submit('resume-unknown');const job=jobs.get(run.id);job.status='failed';job.result=result();job.error='已知失败';job.observability.retryable=true;await readRun(run.id);job.resumeDisconnectBefore=true;
 const first=await resume(run.id);assert.equal(first.status,503);const observed=await readRun(run.id);assert.equal(observed.data.observability.resumePending,true);assert.equal(canResumeRun(observed.data),false);assert.ok(runNeedsRefresh(observed.data));assert.equal((await resume(run.id)).status,409);assert.equal(calls.filter(x=>x.path===`/runs/${run.id}/resume`).length,1);
 const stopped=await cancel(run.id);assert.equal(stopped.status,200);const final=await settle(run.id);assert.equal(final.data.observability.cancellationPending,true);assert.equal(final.data.observability.resumePending,true);assert.equal((await resume(run.id)).status,409);assert.equal(jobs.get(run.id).status,'cancelled');
 evidence.push({case:'unknown-resume',id:run.id,resumeCalls:1,final:final.data});
});

test('stale GET reply loses state CAS and cannot insert its exclusive evidence after cancel',async()=>{
 const {run}=await submit('read-cancel-race');const before=await raw(run.id);const job=jobs.get(run.id);job.result=result();job.result.marketEvidence=[{...market,id:'stale-only',title:'迟到回应专属证据'}];job.result.specialists.conversion.conclusion='迟到回应，不应被接受';
 const block=gate('read:'+run.id),reading=readRun(run.id);await block.arrived;
 try{job.result=result();const stopped=await cancel(run.id);assert.equal(stopped.data.result.specialists.conversion.conclusion,finding.conclusion);}finally{block.release();}
 const late=await reading;assert.equal(late.data.observability.gatewayCancellationRequested,true);assert.equal(late.data.result.specialists.conversion.conclusion,finding.conclusion);
 const leaked=await db.prepare('SELECT id FROM neo_market_evidence WHERE id=?').bind(run.id+':stale-only').first();assert.equal(leaked,null);assert.ok(!JSON.parse((await raw(run.id)).result).marketEvidence.some(x=>x.id.endsWith('stale-only')));await settle(run.id);await immutable(run.id,before);
 evidence.push({case:'state-and-evidence-CAS',id:run.id,staleEvidenceWritten:false,late:late.data});
});

test('legacy false never-dispatched marker is treated as unconfirmed cancellation, not skipped forever',async()=>{
 const {run}=await submit('legacy-false-cancel');const before=await raw(run.id);
 await db.prepare("UPDATE neo_runs SET status='cancelled',result=? WHERE id=?").bind(JSON.stringify({__observationOnly:true,runtime:{localCancelledBeforeDispatch:true,cancellationPending:false,retryable:true}}),run.id).run();assert.equal(jobs.get(run.id).status,'queued');
 assert.equal((await resume(run.id)).status,409);const final=await settle(run.id);assert.equal(jobs.get(run.id).status,'cancelled');assert.equal(final.data.observability.cancellationPending,false);assert.equal(final.data.observability.localCancelledBeforeDispatch,false);await immutable(run.id,before);
 evidence.push({case:'legacy-uncertain-marker',id:run.id,remoteStatus:jobs.get(run.id).status});
});

test('interrupted sender lease is reconciled as unknown rather than preventing cancellation readback forever',async()=>{
 const {run}=await submit('expired-sender');const before=await raw(run.id),stored=JSON.parse(before.result);stored.runtime.gatewayDispatch='sending';stored.runtime.gatewayDispatchStartedAt=Date.now()-91000;
 await db.prepare("UPDATE neo_runs SET status='pending_dispatch',result=? WHERE id=?").bind(JSON.stringify(stored),run.id).run();
 const stopped=await cancel(run.id);assert.equal(stopped.data.observability.gatewayDispatch,'unknown');const final=await settle(run.id);assert.equal(final.data.observability.cancellationPending,false);assert.equal(jobs.get(run.id).status,'cancelled');await immutable(run.id,before);
 evidence.push({case:'expired-dispatch-lease',id:run.id,remoteStatus:jobs.get(run.id).status});
});
