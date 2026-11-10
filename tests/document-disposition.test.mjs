import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {enqueueSource,readKnowledgeDocument} from '../server/knowledge.ts';
import {processMonitorTask,requestKnowledgeRecheck} from '../server/knowledge-monitor.ts';
import {aggregateDocumentDisposition} from '../server/document-disposition.ts';
import {dispositionFixture} from './fixtures/document-disposition.mjs';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import reactPlugin from '@vitejs/plugin-react';
let mf,runtime;const day=new Date('2026-10-08T01:05:00Z');
before(async()=>({mf,runtime}=await localRuntime()));after(async()=>mf?.dispose());
const ctx=()=>({db:runtime.DB,runtime,businessId:'test-a',businessName:'隔离测试',userId:'local-owner',role:'admin'});
async function api(path,body,business='test-a',rt=runtime){const response=await handleApi(new Request(`http://localhost/api/v1/${path}${path.includes('?')?'&':'?'}businessId=${business}&dataNature=demo`,{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},...(body?{body:JSON.stringify({dataNature:'demo',...body})}:{})}),rt);return {status:response.status,...await response.json()};}
async function source(id){const r=await api('knowledge-sources',{requestId:id,url:'https://www.samr.gov.cn/'+id,title:id,kind:'policy'});assert.equal(r.status,201);return runtime.DB.prepare('SELECT * FROM neo_knowledge_sources WHERE id=?').bind(r.source.id).first();}
const readBody='<article>'+Array.from({length:3},(_,i)=>'<p>第'+i+'段。'+('本页只有发布消息，具体条款、企业资格与地区效期均需核验。'.repeat(65))+'</p>').join('')+'</article>';
function depsFor(classification='ignore',{legacy=false,pause=false}={}){const jobs=new Map(),posts=[],gets=[];let posted=0;return {posts,gets,jobs,read:readKnowledgeDocument,service:async(c,path,body)=>{
 if(path==='/knowledge-source')return {body:readBody,contentType:'text/html'};
 if(path==='/knowledge-runs'){posts.push(body);posted++;const result={documentId:body.document.id,documentVersion:body.document.version,semanticValidation:{status:'verified'},claims:[],...(!legacy?{documentDisposition:dispositionFixture(body,classification)}:{})};const run={id:body.id,status:pause&&posted===2?'queued':'completed',result:pause&&posted===2?null:result};jobs.set(body.id,{...run,result});return run;}
 if(path.startsWith('/runs/')){gets.push(path);const run=jobs.get(path.split('/')[2]);assert.ok(run);return {...run,status:'completed'};}
 throw Error('unexpected '+path);
 }};}
const rawTask=id=>runtime.DB.prepare('SELECT * FROM neo_monitor_tasks WHERE id=?').bind(id).first();
let partialDoc;
test('multi-section metadata is durable, incomplete is research; saved read-only APIs never dispatch and complete reason does not reserve review',async()=>{
 const s=await source('multi-section'),task=await enqueueSource(ctx(),'demo',s,'first',day,true),deps=depsFor('ignore',{pause:true});
 await processMonitorTask(ctx(),await rawTask(task.id),deps,day);
 let t=await rawTask(task.id);assert.equal(t.status,'waiting',t.error);const entry=JSON.parse(t.payload).documents[0];assert.equal(entry.chunks.length,2);partialDoc=entry.id;
 let doc=await runtime.DB.prepare('SELECT * FROM neo_knowledge_documents WHERE id=?').bind(entry.id).first();let d=JSON.parse(doc.coverage).documentDisposition;
 assert.equal(d.coverage.complete,false);assert.equal(d.coverage.completedSections,1);assert.equal(d.classification,'research');assert.equal(d.sections[0].documentDisposition.classification,'ignore');assert.equal(d.sections[1].documentDisposition,null);
 const before=await rawTask(task.id),docBefore=doc.coverage;
 for(const endpoint of ['knowledge-items','monitor','knowledge-monitor']){const r=await api(endpoint);assert.equal(r.status,200);const projected=r.documents.find(x=>x.id===entry.id);assert.equal(projected.documentDisposition.classification,'research');assert.equal(projected.dispositionFreshness.status,'current');}
 assert.equal(deps.posts.length,2);assert.equal((await rawTask(task.id)).payload,before.payload);assert.equal((await runtime.DB.prepare('SELECT coverage FROM neo_knowledge_documents WHERE id=?').bind(entry.id).first()).coverage,docBefore);
 await processMonitorTask(ctx(),await rawTask(task.id),deps,day);t=await rawTask(task.id);assert.equal(t.status,'completed',t.error);assert.equal(deps.posts.length,2);assert.equal(deps.gets.length,1);
 doc=await runtime.DB.prepare('SELECT * FROM neo_knowledge_documents WHERE id=?').bind(entry.id).first();d=JSON.parse(doc.coverage).documentDisposition;assert.equal(d.coverage.complete,true);assert.equal(d.classification,'ignore');assert.equal(d.supportStatus,'supported');assert.equal(d.coverage.policyCoverage,'not_claimed');assert.deepEqual(d.coverage.processedParagraphIndices,[0,1,2]);assert.equal(d.sections.length,2);assert.equal(d.sections[0].documentDisposition.support[0].exact,JSON.parse(doc.paragraphs)[0].text);
 for(const table of ['neo_knowledge_claims','neo_knowledge_events','neo_monitor_reviews','neo_monitor_admissions'])assert.equal((await runtime.DB.prepare(`SELECT count(*) n FROM ${table}`).first()).n,0,table);
 assert.equal((await api('knowledge-items',undefined,'test-b')).documents.length,0);assert.equal((await api('knowledge-items?dataNature=business')).documents.length,0);
});

test('legacy empty completed response remains exact and a new same-document refresh cannot pay to backfill the missing field',async()=>{
 const s=await source('legacy-empty'),task=await enqueueSource(ctx(),'demo',s,'legacy-first',day,true),raw=await rawTask(task.id),p=JSON.parse(raw.payload);delete p.documentDispositionVersion;await runtime.DB.prepare('UPDATE neo_monitor_tasks SET payload=? WHERE id=?').bind(JSON.stringify(p),task.id).run();const deps=depsFor('ignore',{legacy:true});
 await processMonitorTask(ctx(),await rawTask(task.id),deps,day);const done=await rawTask(task.id);assert.equal(done.status,'completed',done.error);const savedPayload=done.payload,did=JSON.parse(done.payload).documents[0].id;
 const observed=(await api('knowledge-items')).documents.find(d=>d.id===did);assert.equal(observed.documentDisposition,null);assert.equal(observed.dispositionNotice,'未记录筛选理由');
 await processMonitorTask(ctx(),done,deps,day);assert.equal((await rawTask(task.id)).payload,savedPayload);
 const next=await enqueueSource(ctx(),'demo',s,'new-refresh',day,true);await processMonitorTask(ctx(),await rawTask(next.id),deps,day);assert.equal(deps.posts.length,2);assert.equal((await api('knowledge-items')).documents.find(d=>d.id===did).documentDisposition,null);
});

test('old unknown run is observed only, not resubmitted, and cannot be rechecked as a new paid revision',async()=>{
 const s=await source('legacy-unknown'),task=await enqueueSource(ctx(),'demo',s,'unknown-first',day,true),deps=depsFor('research',{legacy:true,pause:true});await processMonitorTask(ctx(),await rawTask(task.id),deps,day);
 let t=await rawTask(task.id),p=JSON.parse(t.payload);delete p.documentDispositionVersion;p.documents[0].runs[1].status='unknown';await runtime.DB.prepare('UPDATE neo_monitor_tasks SET payload=? WHERE id=?').bind(JSON.stringify(p),t.id).run();
 const calls=[];await processMonitorTask(ctx(),await rawTask(task.id),{...deps,service:async(c,path)=>{calls.push(path);return {id:p.documents[0].runs[1].id,status:'unknown',observability:{modelInvocations:1},result:null};}},day);
 t=await rawTask(task.id);assert.equal(t.status,'waiting');assert.deepEqual(calls,['/runs/'+p.documents[0].runs[1].id]);assert.equal(JSON.parse(t.payload).documents[0].runs[1].status,'unknown');await assert.rejects(requestKnowledgeRecheck(ctx(),'demo',t,p.documents[0].id,'unknown-recheck',day),/已完成/);
});

test('aggregate enforces exact Unicode spans and config/source versions; unsupported classification is quarantined',()=>{
 const text='甲🙂乙条款',doc={id:'d',source_id:'s',source_version:1,content_hash:'v',paragraphs:JSON.stringify([{index:0,text}])},basis={configuration:{version:3,objectives:[],constraints:[]}},job={document:{id:'d',version:'v',sourceId:'s',sourceVersion:1,paragraphs:[{index:0,text}]},configuration:{version:3},documentDispositionVersion:'document-disposition-v1'},d=dispositionFixture(job,'research','conflict');d.counterevidence=[{id:'d:paragraph:0:chars:1:2',kind:'paragraph',exact:'🙂',documentVersion:'v',locator:{sourceId:'d:paragraph:0',start:1,end:2,unit:'unicode_codepoint'}}];
 const entry={chunks:[[{index:0,text}]],runs:[{id:'run',status:'completed',result:{documentDisposition:d}}]};const r=aggregateDocumentDisposition(doc,entry,basis);assert.equal(r.supportStatus,'conflict');assert.equal(r.classification,'research');assert.equal(r.counterevidence[0].exact,'🙂');
 for(const [key,value] of [['documentVersion','wrong'],['sourceVersion','2'],['configurationVersion',4]]){const old=d[key];d[key]=value;assert.throws(()=>aggregateDocumentDisposition(doc,entry,basis),/错配/);d[key]=old;}
 d.counterevidence[0].exact='甲';assert.throws(()=>aggregateDocumentDisposition(doc,entry,basis),/精确原文/);d.counterevidence[0].exact='🙂';d.classification='ignore';assert.throws(()=>aggregateDocumentDisposition(doc,entry,basis),/待研究/);
});

test('new protocol cannot accept legacy missing reason as complete; unresolved empty reason keeps bounded idempotent writer-only manual recheck',async()=>{
 const s=await source('new-missing-reason'),task=await enqueueSource(ctx(),'demo',s,'missing',day,true),deps=depsFor('research',{legacy:true});await processMonitorTask(ctx(),await rawTask(task.id),deps,day);
 const failed=await rawTask(task.id);assert.equal(failed.status,'failed');const did=JSON.parse(failed.payload).documents[0].id,doc=(await api('knowledge-items')).documents.find(d=>d.id===did);assert.equal(doc.documentDisposition.coverage.complete,false);assert.equal(doc.documentDisposition.classification,'research');assert.ok(doc.documentDisposition.gaps.includes('section_disposition_not_recorded'));assert.ok(doc.documentDisposition.sections.every(s=>s.documentDisposition===null));assert.equal(deps.posts.length,2);
 const s2=await source('empty-unresolved'),t=await enqueueSource(ctx(),'demo',s2,'unresolved',day,true),d2=depsFor('research'),baseService=d2.service;d2.service=async(c,path,body)=>{const run=await baseService(c,path,body);if(path==='/knowledge-runs'){run.result.documentDisposition.supportStatus='insufficient';run.result.documentDisposition.support=[];}return run;};await processMonitorTask(ctx(),await rawTask(t.id),d2,day);
 const complete=await rawTask(t.id);assert.equal(complete.status,'completed',complete.error);const documentId=JSON.parse(complete.payload).documents[0].id;
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};assert.equal((await api(`monitor/${t.id}/recheck`,{requestId:'reader-recheck',documentId},'test-a',reader)).status,403);
 for(let i=1;i<=2;i++){const r=await api(`monitor/${t.id}/recheck`,{requestId:'empty-recheck-'+i,documentId});assert.equal(r.status,201,JSON.stringify(r));const replay=await api(`monitor/${t.id}/recheck`,{requestId:'empty-recheck-'+i,documentId});assert.equal(replay.task.id,r.task.id);await processMonitorTask(ctx(),await rawTask(r.task.id),d2,day);assert.equal((await rawTask(r.task.id)).status,'completed');}
 assert.equal((await api(`monitor/${t.id}/recheck`,{requestId:'empty-third-recheck',documentId})).status,409);assert.equal(d2.posts.length,6);
});

test('document metadata readback detects exact source and configuration changes without changing original reason',async()=>{
 let projected=(await api('knowledge-items')).documents.find(d=>d.id===partialDoc),reason=projected.documentDisposition.reason;const sid=projected.source_id;
 await runtime.DB.prepare('UPDATE neo_knowledge_sources SET version=version+1 WHERE id=?').bind(sid).run();projected=(await api('knowledge-items')).documents.find(d=>d.id===partialDoc);assert.equal(projected.dispositionFreshness.status,'stale');assert.equal(projected.documentDisposition.reason,reason);
 await runtime.DB.prepare('UPDATE neo_knowledge_sources SET version=version-1 WHERE id=?').bind(sid).run();
 await runtime.DB.prepare("INSERT INTO neo_monitor_subscriptions VALUES('disposition-sub','test-a','demo',0,1,'{}',NULL,NULL,?)").bind(day.toISOString()).run();projected=(await api('monitor')).documents.find(d=>d.id===partialDoc);assert.equal(projected.dispositionFreshness.status,'stale');assert.equal(projected.documentDisposition.reason,reason);
 await runtime.DB.prepare('DELETE FROM neo_monitor_subscriptions WHERE id=?').bind('disposition-sub').run();
});

test('existing KnowledgeSettings actually mounts the saved document classification/coverage and legacy missing-reason notices',async()=>{
 let dom,loader,root,act;const globals=new Map();try{
 dom=new JSDOM('<div id="test"></div>',{url:'http://localhost/data/ontology'});for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){globals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 const {default:React,act:reactAct}=await import('react');act=reactAct;const {createRoot}=await import('react-dom/client');loader=await createServer({configFile:false,plugins:[reactPlugin()],server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});const {KnowledgeSettings}=await loader.ssrLoadModule('/components/ontology/knowledge-settings.tsx');const reads=[];root=createRoot(document.getElementById('test'));
 await act(async()=>{root.render(React.createElement(KnowledgeSettings,{businessId:'test-a',nature:'demo',role:'reader',api:async(path,method,body)=>{reads.push([path,method]);return api(path,body);}}));});for(let i=0;i<100&&!document.querySelector('[aria-label="文档筛选记录"]');i++)await act(async()=>new Promise(r=>setTimeout(r,10)));
 const records=[...document.querySelectorAll('[aria-label="文档筛选记录"]')];assert.ok(records.length>=2);assert.match(document.body.textContent,/本次无需跟踪/);assert.match(document.body.textContent,/仅覆盖本次保存正文/);assert.match(document.body.textContent,/未记录筛选理由/);assert.match(document.body.textContent,/具体条款/);assert.ok(reads.every(([,method])=>method==='GET'));
 }finally{if(root)await act(async()=>root.unmount());await loader?.close();dom?.window.close();for(const [key,d] of globals){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}}
});
