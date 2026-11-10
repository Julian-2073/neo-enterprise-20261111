import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {safeSourceUrl,readKnowledgeDocument,scheduleWindow} from '../server/knowledge.ts';
let mf,runtime;
before(async()=>({mf,runtime}=await localRuntime()));after(async()=>mf?.dispose());
async function request(resource,body,rt=runtime,business='test-a'){
 const r=await handleApi(new Request(`http://localhost/api/v1/${resource}?businessId=${business}&dataNature=demo`,{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},...(body?{body:JSON.stringify({dataNature:'demo',...body})}:{})}),rt);return {status:r.status,...await r.json()};
}
test('source registration is scoped idempotent and reader cannot activate enterprise rules',async()=>{
 const input={requestId:'register-1',url:'https://www.samr.gov.cn/example.html',title:'市场监管政策',kind:'policy'};
 const saved=await request('knowledge-sources',input);assert.equal(saved.status,201,JSON.stringify(saved));
 assert.equal((await request('knowledge-sources',input)).source.id,saved.source.id);
 assert.equal((await request('knowledge-sources',{...input,title:'different'})).status,409);
 assert.equal((await request('knowledge-sources',input,{...runtime,local:{...runtime.local,userId:'local-reader'}})).status,403);
 assert.equal((await request(`knowledge-sources/${saved.source.id}`,undefined,runtime,'test-b')).status,404);
 assert.equal((await request('knowledge-sources')).items.length,1);
 const memory=await request('agent-memory',{requestId:'memory-1',statement:'先核对缺货风险',references:[],scope:{entities:['sku-1']}});
 assert.equal(memory.status,201);assert.equal(memory.item.state,'candidate');
 assert.equal((await request(`agent-memory/${memory.item.id}/confirm`,{requestId:'confirm-1'})).status,422);
});
test('fetch guard blocks nonpublic URLs redirects unexpected types and partial reads',async()=>{
 for(const value of ['http://www.samr.gov.cn','https://localhost/a','https://127.0.0.1','https://a:password@www.samr.gov.cn','https://evil.com','https://www.samr.gov.cn:8443'])assert.throws(()=>safeSourceUrl(value));
 const url='https://www.samr.gov.cn/example.html';assert.equal(safeSourceUrl(url),url);
 const good=await readKnowledgeDocument(url,new Date('2026-10-08'),async()=>new Response('<p>'+('正式条款。'.repeat(60))+'</p>',{headers:{'content-type':'text/html'}}));assert.ok(good.paragraphs[0].text.length>100);assert.equal(good.coverage.kind,'current_observation');
 await assert.rejects(readKnowledgeDocument(url,new Date(),async()=>new Response('pdf',{headers:{'content-type':'application/pdf'}})));
 await assert.rejects(readKnowledgeDocument(url,new Date(),async()=>new Response('partial',{status:206,headers:{'content-type':'text/html'}})));
});
test('09:00 Shanghai catch-up bounds request to seven days and declares downtime gap',()=>{
 assert.equal(scheduleWindow(new Date('2026-10-08T00:59:00Z'),null).due,false);
 const w=scheduleWindow(new Date('2026-10-08T01:00:00Z'),'2026-09-01T01:00:00Z');assert.equal(w.due,true);assert.equal(w.requestStart,'2026-10-01T01:00:00.000Z');assert.ok(w.gaps.includes('downtime_exceeds_7_days'));
});

import {enqueueSource,invalidateKnowledge,recordKnowledgeDependencies,knowledgeContext,knowledgeFreshness} from '../server/knowledge.ts';
import {processMonitorTask,monitorBasis,reviewImportantChanges,enqueueBusinessObservation} from '../server/knowledge-monitor.ts';
import {monitoredPolicyBriefing} from '../server/knowledge-briefing.ts';
import {dispositionFixture} from './fixtures/document-disposition.mjs';
const ctx=()=>({db:runtime.DB,runtime,businessId:'test-a',businessName:'离线企业',userId:'local-owner',role:'admin'});
const day=new Date('2026-10-08T01:05:00Z');
async function eventProof(rt,bid,n,id,emergency=false){
 const sid=id+'-source',did=id+'-doc',cid=id+'-claim',mid=id+'-memory',deadline='2026-10-09T08:00:00+08:00';
 await rt.DB.batch([
  rt.DB.prepare('INSERT INTO neo_knowledge_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(sid,bid,n,'https://www.samr.gov.cn/'+id,id,'policy',1,1,'{}','local-owner',day.toISOString(),day.toISOString()),
  rt.DB.prepare('INSERT INTO neo_knowledge_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(did,bid,n,sid,1,'doc-v1',id,'证据原文','[]',null,day.toISOString(),'{}','active'),
  rt.DB.prepare('INSERT INTO neo_knowledge_claims VALUES(?,?,?,?,?,?,?,?,?)').bind(cid,bid,n,did,'claim-v1','active',JSON.stringify({paragraphIndices:[],supportStatus:'supported',statement:'已支持的变更'}),day.toISOString(),day.toISOString()),
  rt.DB.prepare('INSERT INTO neo_enterprise_memories VALUES(?,?,?,?,?,?,?,?,?,?)').bind(mid,bid,n,1,'active',JSON.stringify({statement:'人工确认履约限制',riskKind:'fulfillment',deadline}),'local-owner','local-owner',day.toISOString(),day.toISOString()),
 ]);
 return {configurationVersion:(await rt.DB.prepare('SELECT configuration_version FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?').bind(bid,n).first())?.configuration_version??0,supportStatus:'supported',applicabilityVerified:true,relations:[mid],relationVersions:[{id:mid,version:'1'}],claimId:cid,claimVersion:'claim-v1',documentId:did,documentVersion:'doc-v1',sourceId:sid,sourceVersion:'1',emergencyEligible:emergency,deadline};
}

let monitorSource,documentId;let modelSubmits=0;const modelJobs=new Map();
const bodyText='本规则适用于室内固定式健身器材。需要核对产品范围和生效时间。'.repeat(12);
const deps={read:readKnowledgeDocument,service:async(c,path,body)=>{
 if(path==='/knowledge-source')return {body:`<nav>每天变化的导航</nav><article><p>${bodyText}</p></article><footer>时间变化</footer>`,contentType:'text/html'};
 if(path==='/knowledge-runs'){if(!modelJobs.has(body.id)){modelSubmits++;modelJobs.set(body.id,{id:body.id,status:'completed',result:{documentId:body.document.id,documentVersion:body.document.version,semanticValidation:{status:'verified'},...(body.documentDispositionVersion?{documentDisposition:dispositionFixture(body)}:{}),claims:[{statement:'需核对室内固定式器材范围。',region:'全国',effectiveAt:null,expiresAt:null,limitations:['适用范围待核'],entities:[],paragraphIndices:[0],supportStatus:'supported',support:[],relations:[],impact:'待核',urgency:'normal',actionability:'research',classification:'research',reason:'尚未确认产品适用范围',applicabilityVerified:false,emergencyEligible:false}]}});}return modelJobs.get(body.id);}
 throw Error('unexpected '+path);
}};
test('explicit scoped competitor host and human attestation are usable without external policy',async()=>{
 const custom=await request('knowledge-sources',{requestId:'competitor1',url:'https://www.example.com/products',title:'企业许可竞品页',kind:'competitor',allowedHosts:['www.example.com']});assert.equal(custom.status,201,JSON.stringify(custom));
 const m=await request('agent-memory',{requestId:'human-rule',statement:'先核对已确认的履约期限',scope:{entities:['sku-1']},riskKind:'fulfillment',deadline:'2026-10-08'});
 const confirmed=await request(`agent-memory/${m.item.id}/confirm`,{requestId:'human-confirm',confirmationMode:'human_attestation',note:'本人确认企业约束，仅用于分析'});assert.equal(confirmed.status,201,JSON.stringify(confirmed));
 const k=await knowledgeContext(ctx(),'demo',day);assert.equal(k.rules.find(r=>r.id===m.item.id).state,'active');assert.equal(k.rules.find(r=>r.id===m.item.id).confirmedBy,'local-owner');
});
test('body hash ignores navigation/footer and records low quality whole-page coverage',async()=>{
 const read=async(extra)=>readKnowledgeDocument('https://www.samr.gov.cn/example.html',day,async()=>new Response(`<nav>${extra}</nav><main><p>${bodyText}</p></main><footer>${extra}</footer>`,{headers:{'content-type':'text/html'}}));
 assert.equal((await read('old')).contentHash,(await read('new')).contentHash);assert.equal((await read('new')).coverage.bodyScope,'main');
});
test('manual and scheduled processing dedupe actual model work; restart reads saved unchanged document',async()=>{
 const saved=await request('knowledge-sources',{requestId:'monitor-source',url:'https://www.samr.gov.cn/monitor.html',title:'离线监控来源',kind:'policy'});monitorSource=await runtime.DB.prepare('SELECT * FROM neo_knowledge_sources WHERE id=?').bind(saved.source.id).first();
 const task=await enqueueSource(ctx(),'demo',monitorSource,'manual-first',day,true);
 const raw=await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(task.id).first();
 await Promise.all([processMonitorTask(ctx(),raw,deps,day),processMonitorTask(ctx(),raw,deps,day)]);
 const done=await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(task.id).first();assert.equal(done.status,'completed',done.error);assert.equal(modelSubmits,1);documentId=JSON.parse(done.payload).documents[0].id;
 const next=await enqueueSource(ctx(),'demo',monitorSource,'daily',new Date('2026-10-09T01:00:00Z'));
 await processMonitorTask(ctx(),await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(next.id).first(),deps,new Date('2026-10-09T01:00:00Z'));assert.equal(modelSubmits,1);
 const count=await runtime.DB.prepare('SELECT count(*) count FROM neo_knowledge_events WHERE business_id=?').bind('test-a').first();assert.equal(count.count,1);
});
test('policy briefing excludes supported competitor claims from policy guidance',async()=>{
 const snapshot={dataNature:'demo',id:'policy-kind-check'};
 assert.equal((await monitoredPolicyBriefing(ctx(),snapshot)).items.length,1);
 await runtime.DB.prepare("UPDATE neo_knowledge_sources SET kind='competitor' WHERE id=?").bind(monitorSource.id).run();
 try{assert.equal(await monitoredPolicyBriefing(ctx(),snapshot),null);}finally{await runtime.DB.prepare("UPDATE neo_knowledge_sources SET kind='policy' WHERE id=?").bind(monitorSource.id).run();}
});
test('read failures and partially readable archives preserve successful cursor and expose gaps',async()=>{
 await request('monitor/configure',{requestId:'configure-monitor',industry:'ecommerce',enabled:true,region:'浙江',competitors:[]});
 const failed=await enqueueSource(ctx(),'demo',monitorSource,'failed-read',day,true);
 await processMonitorTask(ctx(),await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(failed.id).first(),{...deps,service:async()=>{throw Error('fixture read failure');}},day);
 const row=await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(failed.id).first();assert.equal(row.status,'failed');assert.match(row.error,/successful cursor/);
 const sub=await runtime.DB.prepare('SELECT * FROM neo_monitor_subscriptions WHERE business_id=?').bind('test-a').first();assert.equal(sub.last_success_at,null);
});
test('exact dependency invalidation leaves unrelated immutable judgments current',async()=>{
 const claim=await runtime.DB.prepare('SELECT * FROM neo_knowledge_claims WHERE document_id=?').bind(documentId).first();
 await recordKnowledgeDependencies(ctx(),'demo','dependent',{context:{versions:[{kind:'knowledge',id:claim.id,version:claim.body_hash,location:'test'}]}});
 await recordKnowledgeDependencies(ctx(),'demo','other',{context:{versions:[{kind:'knowledge_source',id:monitorSource.id,version:String(monitorSource.version),location:'test'}]}});
 await invalidateKnowledge(ctx(),'demo',claim.id,claim.body_hash,'withdrawn');assert.equal((await knowledgeFreshness(ctx(),'demo','dependent')).status,'stale');assert.equal((await knowledgeFreshness(ctx(),'demo','other')).status,'current');
});
test('legacy snapshot without profiles/generations freezes original identity and durable business observation',async()=>{
 const s={id:'legacy-monitor',businessId:'test-a',dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-09-14',periodEnd:'2026-09-20',domain:{products:[{id:'sku-1',name:'跑步机'}]},data:{financial:{paidOrders:10},inventory:[],channels:[],weeks:[],events:{}},evidenceIds:{},limitations:[]};
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(s.id,'test-a','demo','2026-10-08',JSON.stringify(s)).run();
 const basis=await monitorBasis(ctx(),'demo',{region:'浙江',version:1});assert.equal(basis.scope.snapshotId,s.id);assert.equal(basis.scope.asOf,s.asOf);assert.deepEqual(basis.scope.entities,['sku-1']);assert.equal(basis.configuration.constraints.length,1);
 const sub=await runtime.DB.prepare('SELECT * FROM neo_monitor_subscriptions WHERE business_id=?').bind('test-a').first();await enqueueBusinessObservation(ctx(),'demo',sub,day);await enqueueBusinessObservation(ctx(),'demo',sub,day);
 const rows=await runtime.DB.prepare("SELECT * FROM neo_monitor_tasks WHERE json_extract(payload,'$.internal')=1").all();assert.equal(rows.results.length,1);assert.equal(JSON.parse(rows.results[0].payload).basis.scope.snapshotId,s.id);
});

import {readFile} from 'node:fs/promises';
test('legacy original snapshot shape dispatches one full automatic review per day through existing gateway',async()=>{
 const s=JSON.parse(await readFile(new URL('./fixtures/knowledge-legacy-snapshot.json',import.meta.url),'utf8'));
 assert.equal(s.data.inventory.length,16);assert.equal(s.data.financial.paidOrders,223);
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(s.id,'test-a','demo','2026-10-10',JSON.stringify(s)).run();
 const basis=await monitorBasis(ctx(),'demo',{region:'浙江',version:1});assert.equal(basis.scope.snapshotId,s.id);assert.equal(basis.scope.asOf,s.asOf);
 const sub=await runtime.DB.prepare('SELECT * FROM neo_monitor_subscriptions WHERE business_id=?').bind('test-a').first();await enqueueBusinessObservation(ctx(),'demo',sub,day);
 const internal=await runtime.DB.prepare("SELECT payload FROM neo_monitor_tasks WHERE json_extract(payload,'$.basis.scope.snapshotId')=?").bind(s.id).first();const doc=await runtime.DB.prepare('SELECT raw_text FROM neo_knowledge_documents WHERE id=?').bind(JSON.parse(internal.payload).documents[0].id).first();const observed=JSON.parse(doc.raw_text);assert.equal(observed.summary.financial.paidOrders,223);assert.equal(observed.summary.inventoryCoverage.totalRows,16);assert.equal(observed.summary.inventoryCoverage.status,'snapshot_complete');
 const add=async(id,emergency=false)=>{const proof=await eventProof(runtime,'test-a','demo',id,emergency);return runtime.DB.prepare("INSERT INTO neo_knowledge_events VALUES(?,'test-a','demo',?,'affects_assessment','pending',?,NULL,?)").bind(id,id,JSON.stringify(proof),day.toISOString()).run();};
 const original=globalThis.fetch,payloads=[],runs=new Map();runtime.NEO_AGENT_URL='http://127.0.0.1:19999';runtime.NEO_SERVICE_TOKEN='offline-fixture-token';runtime.agentExecutionMode='live';
 globalThis.fetch=async(url,opts)=>{
  if(!String(url).startsWith(runtime.NEO_AGENT_URL))throw Error('external request forbidden in fixture');
  if(String(url).endsWith('/runs')){const p=JSON.parse(opts.body);payloads.push(p);const value={id:p.id,status:'queued',result:null,steps:[],observability:{inputHash:p.id}};runs.set(p.id,value);return Response.json(value);}
  return Response.json(runs.get(String(url).split('/').at(-1)));
 };
 try{
  await add('important-full');await reviewImportantChanges(ctx(),'demo',day);assert.equal(payloads.length,1);assert.equal(payloads[0].snapshotId,s.id);assert.equal(payloads[0].envelope.runtimeScope.asOf,s.asOf);assert.equal(payloads[0].envelope.monitorReview.kind,'full');assert.equal(payloads[0].budget.maxTokens,null);assert.equal(payloads[0].budget.maxModelCalls,null);
  await add('later-important');await reviewImportantChanges(ctx(),'demo',day);assert.equal(payloads.length,1);assert.equal((await runtime.DB.prepare('SELECT state FROM neo_knowledge_events WHERE id=?').bind('later-important').first()).state,'pending_next_day');
  await add('urgent-a',true);await reviewImportantChanges(ctx(),'demo',day);await add('urgent-b',true);await reviewImportantChanges(ctx(),'demo',day);await add('urgent-c',true);await reviewImportantChanges(ctx(),'demo',day);assert.equal(payloads.length,3);assert.equal(payloads[1].mode,'supply');assert.equal(payloads[1].budget.maxTokens,null);assert.equal(payloads[1].budget.maxModelCalls,null);
  await runtime.DB.prepare('INSERT INTO neo_monitor_subscriptions VALUES(?,?,?,?,?,?,?,?,?)').bind('business-nature-sub','test-a','business',1,1,JSON.stringify({industry:'ecommerce',emergencyMaxPerDay:2}),null,null,day.toISOString()).run();
  const other={...s,id:s.id+'-business',dataNature:'business'};await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(other.id,'test-a','business','2026-10-10',JSON.stringify(other)).run();
  for(const urgent of [false,true]){const id='crossnature-'+urgent,proof=await eventProof(runtime,'test-a','business',id,urgent);await runtime.DB.prepare("INSERT INTO neo_knowledge_events VALUES(?,'test-a','business',?,'affects_assessment','pending',?,NULL,?)").bind(id,id,JSON.stringify(proof),day.toISOString()).run();await reviewImportantChanges(ctx(),'business',day);}
  assert.equal(payloads.length,3,'other nature cannot gain another full or emergency slot');

 }finally{globalThis.fetch=original;}
});

test('archive partial failure does not advance this source successful cursor; same original repost is not independent evidence',async()=>{
 const source=await request('knowledge-sources',{requestId:'archive-registration',url:'https://www.samr.gov.cn/archive.html',pages:['https://www.samr.gov.cn/page2.html'],title:'归档',kind:'policy',originalId:'same-original-standard'});
 const row=await runtime.DB.prepare('SELECT * FROM neo_knowledge_sources WHERE id=?').bind(source.source.id).first(),task=await enqueueSource(ctx(),'demo',row,'archive-refresh',day,true);
 const partialDeps={...deps,service:async(c,path,b)=>path==='/knowledge-source'&&b.url.endsWith('page2.html')?Promise.reject(Error('unread page')):deps.service(c,path,b)};
 await processMonitorTask(ctx(),await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(task.id).first(),partialDeps,day);
 const result=await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(task.id).first();assert.equal(result.status,'partial');assert.ok(JSON.parse(result.payload).gaps.some(x=>x.includes('read_failure')));
 const reread=await runtime.DB.prepare('SELECT payload FROM neo_knowledge_sources WHERE id=?').bind(row.id).first();assert.equal(JSON.parse(reread.payload).lastSuccessAt,undefined);
 const beforeRepost=modelSubmits;
 const repost=await request('knowledge-sources',{requestId:'repost-registration',url:'https://www.samr.gov.cn/repost.html',title:'转载',kind:'policy',originalId:'same-original-standard'}),repostRow=await runtime.DB.prepare('SELECT * FROM neo_knowledge_sources WHERE id=?').bind(repost.source.id).first();
 const next=await enqueueSource(ctx(),'demo',repostRow,'repost',day,true);await processMonitorTask(ctx(),await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(next.id).first(),deps,day);
 const claims=await runtime.DB.prepare("SELECT count(*) count FROM neo_knowledge_claims WHERE json_extract(payload,'$.originalId')='same-original-standard'").first();assert.equal(claims.count,1);assert.equal(modelSubmits,beforeRepost);
});

import {initializeAcceptanceMonitoring} from '../server/knowledge-monitor.ts';
import {agentPolicy,automaticMonitorAllowed} from '../server/agent-policy.ts';
import {service as agentService} from '../server/agents.ts';
test('only server allowlisted isolated acceptance starts new monitor; isolation and manual market permissions remain intact',async()=>{
 const isolated=await localRuntime(),bid='neo-sim-acceptance-20261004',other='neo-sim-other-industry';
 const rt={...isolated.runtime,agentExecutionMode:'live',automaticMonitorBusinesses:[bid],NEO_AGENT_URL:'http://127.0.0.1:19998',NEO_SERVICE_TOKEN:'offline-fixture-monitor'};
 const originalFetch=globalThis.fetch;let submitted=[];
 try{
  for(const b of [bid,other]){await rt.DB.prepare('INSERT INTO businesses VALUES(?,?)').bind(b,b).run();const s=JSON.parse(await readFile(new URL('./fixtures/knowledge-legacy-snapshot.json',import.meta.url)));s.id='snapshot-'+b;s.businessId=b;await rt.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(s.id,b,'demo','2026-10-08',JSON.stringify(s)).run();}
  await initializeAcceptanceMonitoring(rt,bid);await initializeAcceptanceMonitoring(rt,other);await initializeAcceptanceMonitoring(rt,'test-a');
  assert.equal((await rt.DB.prepare('SELECT count(*) n FROM neo_monitor_subscriptions').first()).n,1);assert.equal(agentPolicy(rt,bid).isolated,true);assert.equal(agentPolicy(rt,bid).marketSearchAllowed,false);assert.equal(agentPolicy(rt,bid).automaticPatrolAllowed,false);assert.equal(automaticMonitorAllowed({...rt,knowledgeMonitorEnabled:false},bid),false);
  const c={db:rt.DB,runtime:rt,businessId:bid,businessName:bid,userId:'local-monitor',role:'admin'};
  globalThis.fetch=async(url,opts)=>{assert.ok(String(url).startsWith(rt.NEO_AGENT_URL));if(String(url).endsWith('/knowledge-source'))return Response.json({body:'fixture',contentType:'text/plain'});const body=JSON.parse(opts.body);submitted.push(body);return Response.json({id:body.id,status:'queued',steps:[],result:null});};
  await agentService(c,'/knowledge-source',{url:'https://www.samr.gov.cn/source.html'});
  await assert.rejects(agentService({...c,businessId:other},'/knowledge-source',{url:'https://www.samr.gov.cn/source.html'}),/隔离企业/);
  await rt.DB.prepare("INSERT INTO neo_knowledge_events VALUES(?,?,?,'acceptance-important','affects_assessment','pending',?,NULL,?)").bind('acceptance-event',bid,'demo',JSON.stringify(await eventProof(rt,bid,'demo','acceptance-event')),day.toISOString()).run();
  await reviewImportantChanges(c,'demo',day);assert.equal(submitted.length,1);assert.equal(submitted[0].envelope.monitorReview.kind,'full');assert.equal(submitted[0].businessId,bid);assert.equal(submitted[0].autoRepeat,false);assert.equal(submitted[0].budget.maxMarketSearches,0);
 }finally{globalThis.fetch=originalFetch;await isolated.mf.dispose();}
});

test('late dependency registration and GET compare exact claim document source and memory versions',async()=>{
 const source=await request('knowledge-sources',{requestId:'late-source',url:'https://www.samr.gov.cn/late.html',title:'版本回归',kind:'policy'});
 const sid=source.source.id,doc='late-document',cid='late-claim';
 await runtime.DB.prepare('INSERT INTO neo_knowledge_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(doc,'test-a','demo',sid,1,'doc-v2','late-original','原文','[]',null,day.toISOString(),'{}','active').run();
 await runtime.DB.prepare('INSERT INTO neo_knowledge_claims VALUES(?,?,?,?,?,?,?,?,?)').bind(cid,'test-a','demo',doc,'claim-v2','active',JSON.stringify({paragraphIndices:[],supportStatus:'supported'}),day.toISOString(),day.toISOString()).run();
 for(const [kind,id,version] of [['knowledge',cid,'claim-v1'],['document',doc,'doc-v1'],['knowledge_source',sid,'0']]){
  const consumer='late-'+kind;await recordKnowledgeDependencies(ctx(),'demo',consumer,{context:{versions:[{kind,id,version}]}});
  assert.equal((await knowledgeFreshness(ctx(),'demo',consumer)).status,'stale',kind);
 }
 await recordKnowledgeDependencies(ctx(),'demo','before-source-change',{context:{versions:[{kind:'knowledge',id:cid,version:'claim-v2'},{kind:'document',id:doc,version:'doc-v2'}]}});
 assert.equal((await knowledgeFreshness(ctx(),'demo','before-source-change')).status,'current');
 await runtime.DB.prepare('UPDATE neo_knowledge_sources SET enabled=0 WHERE id=?').bind(sid).run();
 assert.equal((await knowledgeFreshness(ctx(),'demo','before-source-change')).status,'stale');
 await recordKnowledgeDependencies(ctx(),'demo','late-disabled-source',{context:{versions:[{kind:'knowledge',id:cid,version:'claim-v2'}]}});
 assert.equal((await knowledgeFreshness(ctx(),'demo','late-disabled-source')).status,'stale');
});

test('monitor basis and retrieval share invalid memory exclusion without requiring expiry pump',async()=>{
 for(const [id,state,expiresAt] of [['memory-stale','stale',null],['memory-conflict','conflict',null],['memory-expired','current','2020-01-01']]){
  await runtime.DB.prepare('INSERT INTO neo_enterprise_memories VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,'test-a','demo',1,'active',JSON.stringify({statement:'已撤回履约规则',riskKind:'fulfillment',expiresAt}), 'local-owner','local-owner',day.toISOString(),day.toISOString()).run();
  await runtime.DB.prepare('INSERT INTO neo_knowledge_dependencies VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id+'-dep','test-a','demo',id,'memory','late-claim','claim-v1',state,null,day.toISOString()).run();
 }
 const k=await knowledgeContext(ctx(),'demo',day),basis=await monitorBasis(ctx(),'demo',{version:1});
 for(const id of ['memory-stale','memory-conflict','memory-expired']){assert.ok(!k.rules.some(r=>r.id===id));assert.ok(!basis.configuration.constraints.some(r=>r.id===id),id);}
});

test('failed changed document preserves last valid claims and cursor with pending change evidence',async()=>{
 const source=await request('knowledge-sources',{requestId:'replace-source',url:'https://www.samr.gov.cn/replacement.html',title:'正文替换回归',kind:'policy'});
 const row=await runtime.DB.prepare('SELECT * FROM neo_knowledge_sources WHERE id=?').bind(source.source.id).first();
 const first=await enqueueSource(ctx(),'demo',row,'replace-first',day,true);await processMonitorTask(ctx(),await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(first.id).first(),deps,day);
 const old=await runtime.DB.prepare('SELECT c.* FROM neo_knowledge_claims c JOIN neo_knowledge_documents d ON d.id=c.document_id WHERE d.source_id=?').bind(row.id).first();
 const saved=await runtime.DB.prepare('SELECT payload FROM neo_knowledge_sources WHERE id=?').bind(row.id).first();
 const next=await enqueueSource(ctx(),'demo',row,'replace-fail',day,true);
 await processMonitorTask(ctx(),await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(next.id).first(),{...deps,service:async(c,path)=>{if(path==='/knowledge-source')return {body:'<article><p>'+bodyText+'正文已经变化。</p></article>',contentType:'text/html'};throw Error('offline model failure');}},day);
 assert.equal((await runtime.DB.prepare('SELECT status FROM neo_monitor_tasks WHERE id=?').bind(next.id).first()).status,'failed');
 assert.equal((await runtime.DB.prepare('SELECT state FROM neo_knowledge_claims WHERE id=?').bind(old.id).first()).state,'active');
 assert.equal((await runtime.DB.prepare('SELECT payload FROM neo_knowledge_sources WHERE id=?').bind(row.id).first()).payload,saved.payload);
 const current=await knowledgeContext(ctx(),'demo',day);assert.ok(current.items.some(i=>i.id===old.id));assert.ok(current.gaps.includes('source_body_change_pending_verification'));
});

test('unresolved recheck is explicit bounded revision; unchanged refresh replays and unknown cannot retry',async()=>{
 const source=await request('knowledge-sources',{requestId:'unresolved-source',url:'https://www.samr.gov.cn/unresolved.html',title:'待核重试',kind:'policy'});
 const row=await runtime.DB.prepare('SELECT * FROM neo_knowledge_sources WHERE id=?').bind(source.source.id).first();let jobs=new Map(),calls=0;
 const candidateDeps={...deps,service:async(c,path,body)=>{if(path!='/knowledge-runs')return deps.service(c,path,body);if(!jobs.has(body.id)){calls++;const run=await deps.service(c,path,body);run.result.claims[0]={...run.result.claims[0],supportStatus:'insufficient'};jobs.set(body.id,run);}return jobs.get(body.id);}};
 const first=await enqueueSource(ctx(),'demo',row,'unresolved-first',day,true);await processMonitorTask(ctx(),await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(first.id).first(),candidateDeps,day);
 const task=await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(first.id).first(),documentId=JSON.parse(task.payload).documents[0].id;
 const refresh=await enqueueSource(ctx(),'demo',row,'unresolved-normal',day,true);await processMonitorTask(ctx(),await runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(refresh.id).first(),candidateDeps,day);assert.equal(calls,1);
 for(let i=1;i<=2;i++){const retry=await request(`monitor/${task.id}/recheck`,{requestId:'explicit-recheck-'+i,documentId});assert.equal(retry.status,201,JSON.stringify(retry));await processMonitorTask(ctx(),retry.task,candidateDeps,day);assert.equal(calls,i+1);}
 assert.equal((await request(`monitor/${task.id}/recheck`,{requestId:'explicit-recheck-limit',documentId})).status,409);
 // A completed source job plus a failed/unknown later attempt is not a license
 // to evade the queue's non-retryable uncertain-call record.
 await runtime.DB.prepare("UPDATE neo_monitor_tasks SET status='failed',error='MODEL_CALL_UNCERTAIN' WHERE id=?").bind(first.id).run();
 assert.equal((await request(`monitor/${task.id}/recheck`,{requestId:'explicit-recheck-unknown',documentId})).status,409);
});

import {researchTime,emergencyDeadline} from '../server/knowledge-time.ts';
test('Shanghai dates and emergency window use next 09:00 and require precise timezone',()=>{
 const now=new Date('2026-10-07T18:30:00Z');assert.equal(researchTime(now.toISOString()).researchAsOf,'2026-10-08');
 assert.equal(emergencyDeadline('2026-10-08T08:00:00+08:00',now),true);assert.equal(emergencyDeadline('2026-10-08T10:00:00+08:00',now),false);assert.equal(emergencyDeadline('2026-10-08',now),false);
 assert.equal(emergencyDeadline('2026-10-09T08:00:00+08:00',day),true);assert.equal(emergencyDeadline('2026-10-09T10:00:00+08:00',day),false);
});

test('pending events cannot dispatch after source or confirmed rule loses exact validity',async()=>{
 for(const change of ['source','memory','claim']){
  const id='stale-event-'+change,proof=await eventProof(runtime,'test-a','demo',id);
  await runtime.DB.prepare("INSERT INTO neo_knowledge_events VALUES(?,'test-a','demo',?,'affects_assessment','pending',?,NULL,?)").bind(id,id,JSON.stringify(proof),day.toISOString()).run();
  if(change==='source')await runtime.DB.prepare('UPDATE neo_knowledge_sources SET version=2 WHERE id=?').bind(proof.sourceId).run();
  if(change==='memory')await runtime.DB.prepare('UPDATE neo_enterprise_memories SET version=2 WHERE id=?').bind(proof.relations[0]).run();
  if(change==='claim')await runtime.DB.prepare("UPDATE neo_knowledge_claims SET state='expired' WHERE id=?").bind(proof.claimId).run();
 }
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('no expired event dispatch allowed');};try{await reviewImportantChanges(ctx(),'demo',new Date('2026-10-09T01:05:00Z'));}finally{globalThis.fetch=original;}
 for(const change of ['source','memory','claim'])assert.equal((await runtime.DB.prepare('SELECT state FROM neo_knowledge_events WHERE id=?').bind('stale-event-'+change).first()).state,'stale');
});

test('same-business different-nature concurrent admissions share one full and two emergency slots',async()=>{
 const bid='cross-nature';
 const reserve=(n,kind,slot)=>runtime.DB.prepare('INSERT OR IGNORE INTO neo_monitor_admissions VALUES(?,?,?,?,?,?,?)').bind(bid,'2026-10-08',kind,slot,kind+'-'+slot+'-'+n,n,day.toISOString()).run();
 await Promise.all(['demo','business'].flatMap(n=>[reserve(n,'full',0),reserve(n,'emergency',0),reserve(n,'emergency',1)]));
 const rows=await runtime.DB.prepare('SELECT * FROM neo_monitor_admissions WHERE business_id=?').bind(bid).all();assert.equal(rows.results.length,3);assert.equal(rows.results.filter(r=>r.kind==='full').length,1);assert.equal(rows.results.filter(r=>r.kind==='emergency').length,2);
});


test('authorized older active policy remains frozen and API query/page can locate it',async()=>{
 const source=await request('knowledge-sources',{requestId:'older-source',url:'https://www.samr.gov.cn/older.html',title:'旧有效政策',kind:'policy'}),sid=source.source.id,did='older-document';
 await runtime.DB.prepare('INSERT INTO neo_knowledge_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(did,'test-a','demo',sid,1,'old-doc-v','old-original','特殊器材原文','[]',null,'2020-01-01T00:00:00Z','{}','active').run();
 for(let i=0;i<45;i++)await runtime.DB.prepare('INSERT INTO neo_knowledge_claims VALUES(?,?,?,?,?,?,?,?,?)').bind('old-policy-'+i,'test-a','demo',did,'v'+i,'active',JSON.stringify({statement:i===0?'特殊器材旧有效规则':'一般已读主张'+i,paragraphIndices:[],supportStatus:'supported'}),'2020-01-01T00:00:00Z',new Date(Date.UTC(2020,0,i+1)).toISOString()).run();
 const frozen=await knowledgeContext(ctx(),'demo',day);assert.ok(frozen.items.some(i=>i.id==='old-policy-0'));assert.ok(frozen.coverage.complete);
 const response=await handleApi(new Request('http://localhost/api/v1/knowledge-items?businessId=test-a&dataNature=demo&query='+encodeURIComponent('特殊器材旧有效规则')+'&cursor=0&limit=1'),runtime);const page=await response.json();assert.equal(page.items[0].id,'old-policy-0');assert.equal(page.page.hasMore,false);
});

import {knowledgeReferenceValidity} from '../server/knowledge.ts';
async function isolatedMonitorFixture(businessId){
 const c={...ctx(),businessId},s={...JSON.parse(await readFile(new URL('./fixtures/knowledge-legacy-snapshot.json',import.meta.url),'utf8')),id:businessId+'-snapshot',businessId};
 await runtime.DB.batch([
  runtime.DB.prepare('INSERT INTO businesses VALUES(?,?)').bind(businessId,businessId),
  runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(s.id,businessId,'demo',day.toISOString(),JSON.stringify(s)),
  runtime.DB.prepare('INSERT INTO neo_monitor_subscriptions VALUES(?,?,?,?,?,?,?,?,?)').bind(businessId+'-subscription',businessId,'demo',1,1,JSON.stringify({industry:'ecommerce',region:'浙江',emergencyMaxPerDay:2}),null,null,day.toISOString()),
 ]);return c;
}
test('recover persisted full/emergency admission before run binding and reuse already-created run',async()=>{
 const c=await isolatedMonitorFixture('recover-admission'),original=globalThis.fetch,jobs=new Map(),submitted=[];
 globalThis.fetch=async(url,opts)=>{if(String(url).endsWith('/runs')){const p=JSON.parse(opts.body);submitted.push(p.id);jobs.set(p.id,{id:p.id,status:'queued',result:null,steps:[],observability:{}});return Response.json(jobs.get(p.id));}return Response.json(jobs.get(String(url).split('/').at(-1)));};
 try{for(const kind of ['full','emergency']){
  const id='recover-'+kind,event=id+'-event',proof={...await eventProof(runtime,c.businessId,'demo',event,kind==='emergency'),configurationVersion:1};
  await runtime.DB.batch([
   runtime.DB.prepare('INSERT INTO neo_knowledge_events VALUES(?,?,?,?,?,?,?,?,?)').bind(event,c.businessId,'demo',event,'affects_assessment','pending',JSON.stringify(proof),null,day.toISOString()),
   runtime.DB.prepare('INSERT INTO neo_monitor_admissions VALUES(?,?,?,?,?,?,?)').bind(c.businessId,'2026-10-08',kind,0,id,'demo',day.toISOString()),
   runtime.DB.prepare('INSERT INTO neo_monitor_reviews VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,c.businessId,'demo','2026-10-08',kind,0,'pending',null,JSON.stringify([event]),day.toISOString()),
  ]);
  runtime.knowledgeMonitorEnabled=false;await reviewImportantChanges(c,'demo',day);assert.equal(submitted.length,kind==='full'?0:1);runtime.knowledgeMonitorEnabled=true;
  await reviewImportantChanges(c,'demo',day);
  const bound=await runtime.DB.prepare('SELECT * FROM neo_monitor_reviews WHERE id=?').bind(id).first();assert.ok(bound.run_id,'existing '+kind+' slot must recover');
  const calls=submitted.length;
  await runtime.DB.prepare("UPDATE neo_monitor_reviews SET run_id=NULL,status='pending' WHERE id=?").bind(id).run();
  await reviewImportantChanges(c,'demo',day);
  assert.equal((await runtime.DB.prepare('SELECT run_id FROM neo_monitor_reviews WHERE id=?').bind(id).first()).run_id,bound.run_id);assert.equal(submitted.length,calls,'already-created run must not resubmit');
  jobs.get(bound.run_id).status='cancelled';await runtime.DB.prepare("UPDATE neo_monitor_reviews SET run_id=NULL,status='pending' WHERE id=?").bind(id).run();await reviewImportantChanges(c,'demo',day);assert.equal((await runtime.DB.prepare('SELECT status FROM neo_monitor_reviews WHERE id=?').bind(id).first()).status,'cancelled');assert.equal(submitted.length,calls,'cancelled existing run must not be recreated');
 }
 assert.equal(submitted.length,2);assert.equal((await runtime.DB.prepare('SELECT count(*) count FROM neo_monitor_admissions WHERE business_id=?').bind(c.businessId).first()).count,2);
 }finally{globalThis.fetch=original;}
});

test('configuration update invalidates pending events before dispatch and old profiles remain history only',async()=>{
 const c=await isolatedMonitorFixture('changed-config'),proof={...await eventProof(runtime,c.businessId,'demo','changed-region-event'),configurationVersion:1};
 await runtime.DB.prepare('INSERT INTO neo_knowledge_events VALUES(?,?,?,?,?,?,?,?,?)').bind('changed-region-event',c.businessId,'demo','changed-region-event','affects_assessment','pending',JSON.stringify(proof),null,day.toISOString()).run();
 await runtime.DB.prepare("UPDATE neo_monitor_subscriptions SET configuration_version=2,payload=json_set(payload,'$.region','上海','$.constraints',json('[]')) WHERE business_id=?").bind(c.businessId).run();
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('stale configuration cannot dispatch');};try{await reviewImportantChanges(c,'demo',day);}finally{globalThis.fetch=original;}
 assert.equal(calls,0);assert.equal((await runtime.DB.prepare('SELECT count(*) count FROM neo_monitor_admissions WHERE business_id=?').bind(c.businessId).first()).count,0);assert.equal((await runtime.DB.prepare('SELECT state FROM neo_knowledge_events WHERE id=?').bind('changed-region-event').first()).state,'stale');
 for(const version of [1,2])await runtime.DB.prepare('INSERT INTO neo_business_profiles VALUES(?,?,?,?,?,?)').bind('current-profile-'+version,c.businessId,'demo',version,'{}',day.toISOString()).run();
 assert.equal((await knowledgeReferenceValidity(c,'demo','profile:current-profile-1','current-profile-1',day)).status,'stale');assert.equal((await knowledgeReferenceValidity(c,'demo','current-profile-2','current-profile-2',day)).status,'current');
 assert.equal((await runtime.DB.prepare('SELECT count(*) count FROM neo_business_profiles WHERE business_id=?').bind(c.businessId).first()).count,2);
 for(const id of ['platform-old','platform-current'])await runtime.DB.prepare("INSERT INTO neo_platform_configs(id,business_id,data_nature,base_id,status,payload,actor_id,created_at,published_at) VALUES(?,?,?,NULL,'published','{}','local-owner',?,?)").bind(id,c.businessId,'demo',day.toISOString(),day.toISOString()).run();
 await runtime.DB.prepare('INSERT INTO neo_platform_config_heads VALUES(?,?,?)').bind(c.businessId,'demo','platform-current').run();
 assert.equal((await knowledgeReferenceValidity(c,'demo','configuration:platform-old','platform-old',day)).status,'stale');assert.equal((await knowledgeReferenceValidity(c,'demo','configuration:platform-current','platform-current',day)).status,'current');

});

test('knowledge-monitor canonical alias shares readonly GET writer scopes and stable IDs with monitor',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('monitor API must not call provider');};try{
 const input={requestId:'alias-config',industry:'hotel',enabled:false,region:'上海'};
 const saved=await request('knowledge-monitor/configure',input,runtime,'test-b');assert.equal(saved.status,201,JSON.stringify(saved));assert.equal((await request('monitor/configure',input,runtime,'test-b')).status,200);
 assert.deepEqual((await request('knowledge-monitor',undefined,runtime,'test-b')).subscription,(await request('monitor',undefined,runtime,'test-b')).subscription);
 assert.equal((await request('knowledge-monitor/configure',{...input,requestId:'alias-reader'}, {...runtime,local:{...runtime.local,userId:'local-reader'}},'test-b')).status,403);
 const source=await request('knowledge-sources',{requestId:'alias-source',url:'https://www.samr.gov.cn/alias.html',title:'alias',kind:'policy'},runtime,'test-b');
 const path=`knowledge-monitor/${source.source.id}/refresh`,refresh={requestId:'alias-refresh'};const queued=await request(path,refresh,runtime,'test-b');assert.equal(queued.status,201);assert.equal((await request(path.replace('knowledge-monitor','monitor'),refresh,runtime,'test-b')).task.id,queued.task.id);
 assert.equal((await request(path,{requestId:'alias-foreign'},runtime,'test-a')).status,404);
 assert.equal((await request(`knowledge-monitor/${queued.task.id}/cancel`,{requestId:'alias-cancel'},runtime,'test-b')).status,'cancelled');
 assert.equal((await request(`knowledge-monitor/${queued.task.id}/resume`,{requestId:'alias-resume'},runtime,'test-b')).status,'pending');
 assert.equal((await request(`knowledge-monitor/${queued.task.id}/recheck`,{requestId:'alias-recheck',documentId:'missing'},runtime,'test-b')).status,409);
 }finally{globalThis.fetch=original;}
});

import {saveMonitorResult} from '../server/knowledge-monitor.ts';
test('actual saved memory-only event freezes implicit profile and cannot dispatch after profile publication',async()=>{
 runtime.NEO_AGENT_URL='http://127.0.0.1:19999';runtime.NEO_SERVICE_TOKEN='offline-fixture-token';runtime.agentExecutionMode='live';
 const c=await isolatedMonitorFixture('implicit-profile'),profile1={region:'浙江',industry:'ecommerce',competitors:[]};
 const legacy=await monitorBasis(c,'demo',{version:1,region:'浙江'});
 await runtime.DB.prepare('INSERT INTO neo_business_profiles VALUES(?,?,?,?,?,?)').bind('implicit-profile-v1',c.businessId,'demo',1,JSON.stringify(profile1),day.toISOString()).run();
 const proof=await eventProof(runtime,c.businessId,'demo','implicit-profile-proof');
 await runtime.DB.prepare('UPDATE neo_knowledge_documents SET paragraphs=? WHERE id=?').bind(JSON.stringify([{index:0,start:0,end:12,text:'浙江地区明确履约期限要求。'}]),proof.documentId).run();
 const basis=await monitorBasis(c,'demo',{version:1,region:'浙江'}),payload=JSON.stringify({configurationVersion:1}),task={id:'implicit-profile-task',lease_owner:'fixture-owner',payload};
 await runtime.DB.prepare("INSERT INTO neo_monitor_tasks(id,business_id,data_nature,source_id,dedupe_key,status,payload,lease_owner,created_at,updated_at) VALUES(?,?,?,?,?,'running',?,?,?,?)").bind(task.id,c.businessId,'demo',proof.sourceId,task.id,payload,task.lease_owner,day.toISOString(),day.toISOString()).run();
 const doc=await runtime.DB.prepare('SELECT * FROM neo_knowledge_documents WHERE id=?').bind(proof.documentId).first();
 await saveMonitorResult(c,'demo',task,doc,{documentId:doc.id,documentVersion:doc.content_hash,semanticValidation:{status:'verified'},claims:[{statement:'浙江地区要求核对履约期限。',paragraphIndices:[0],region:'浙江',effectiveAt:null,expiresAt:null,limitations:[],entities:[basis.scope.entities[0]],supportStatus:'supported',applicability:'applicable',applicabilityVerified:true,relations:proof.relations,support:[],impact:'核对履约',urgency:'normal',actionability:'review',classification:'affects_assessment',reason:'影响已确认履约约束',emergencyEligible:false,deadline:null}]},basis);
 const event=await runtime.DB.prepare('SELECT * FROM neo_knowledge_events WHERE business_id=?').bind(c.businessId).first(),saved=JSON.parse(event.payload);
 assert.deepEqual(saved.relationVersions,proof.relationVersions);
 // Persisted pre-fix event shape has no implicit profile dependency. It must
 // also require recheck, instead of being silently grandfathered as current.
 await runtime.DB.prepare('INSERT INTO neo_knowledge_events VALUES(?,?,?,?,?,?,?,?,?)').bind('historical-no-profile',c.businessId,'demo','historical-no-profile','affects_assessment','pending',JSON.stringify({...saved,configurationReferences:[]}),null,day.toISOString()).run();
 await runtime.DB.prepare('INSERT INTO neo_business_profiles VALUES(?,?,?,?,?,?)').bind('implicit-profile-v2',c.businessId,'demo',2,JSON.stringify({...profile1,region:'上海',competitors:['new-competitor']}),day.toISOString()).run();
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('old profile must not dispatch');};try{await reviewImportantChanges(c,'demo',day);}finally{globalThis.fetch=original;}
 assert.equal(calls,0);assert.equal((await runtime.DB.prepare('SELECT count(*) count FROM neo_monitor_admissions WHERE business_id=?').bind(c.businessId).first()).count,0);
 const events=await runtime.DB.prepare('SELECT state FROM neo_knowledge_events WHERE business_id=?').bind(c.businessId).all();assert.ok(events.results.every(e=>e.state==='stale'));
 assert.equal((await runtime.DB.prepare('SELECT count(*) count FROM neo_business_profiles WHERE business_id=?').bind(c.businessId).first()).count,2);
 // Canonical generation path must expose the same real current reference,
 // independent of which objective relation the model chooses.
 const g={id:'implicit-generation',sourceKey:'implicit-generation-source',state:{businessId:c.businessId,dataNature:'demo',profile:profile1,profileVersion:'implicit-profile-v1',asOf:'2026-09-24',period:{start:'2026-09-01',end:'2026-09-24'},inputs:[{entityId:'sku'}]}};
 await runtime.DB.prepare('INSERT INTO neo_business_generations VALUES(?,?,?,?,?,?,?,?)').bind(g.id,c.businessId,'demo',g.sourceKey,'complete',JSON.stringify(g),day.toISOString(),day.toISOString()).run();
 assert.equal(legacy.configuration.profileReference,null);assert.ok(legacy.configuration.gaps.includes('enterprise_profile_unavailable'));assert.ok(saved.configurationReferences.some(r=>r.id==='profile:implicit-profile-v1'&&r.version==='implicit-profile-v1'));
 const canonical=await monitorBasis(c,'demo',{version:1});assert.deepEqual(canonical.configuration.profileReference,{id:'profile:implicit-profile-v2',version:'implicit-profile-v2'});assert.equal(canonical.configuration.region,'上海');
});
