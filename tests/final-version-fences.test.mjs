import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import reactPlugin from '@vitejs/plugin-react';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {context} from '../server/auth.ts';
import {storedObservation} from '../server/agent-state.ts';
import {recordKnowledgeDependencies,knowledgeFreshness} from '../server/knowledge.ts';
import {completeAssessmentRow} from '../server/business-assessment.ts';
import {currentAssessmentRun} from '../lib/assessment-presentation.ts';
import {specialistReview} from '../server/home-sections.ts';
import {savedMarketReview} from '../server/market-review.ts';
import {reviewResult} from '../server/workbench-projection.ts';
import {defaultPlatformSettings} from '../lib/platform-settings.ts';

function requester(runtime){return async(path,body)=>{const response=await handleApi(new Request('http://localhost/api/v1/'+path+(path.includes('?')?'&':'?')+'businessId=test-a&dataNature=demo',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},...(body?{body:JSON.stringify({dataNature:'demo',requestId:crypto.randomUUID(),...body})}:{})}),runtime),data=await response.json();assert.ok(response.ok,path+' '+JSON.stringify(data));return data;};}
async function insertRun(runtime,s,id,assessment){await runtime.DB.prepare('INSERT OR IGNORE INTO neo_sessions(id,business_id,data_nature,snapshot_id,actor_id,created_at) VALUES(?,?,?,?,?,?)').bind('fence-session','test-a','demo',s.id,'local-owner','2026-10-08').run();const result={finding:assessment.projections.finding,specialists:{},businessAssessment:assessment};await runtime.DB.prepare('INSERT INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,'test-a','demo',s.id,'fence-session',id,id,JSON.stringify({question:id,mode:'joint',purpose:'patrol',envelope:{snapshot:s}}),'completed','[]',JSON.stringify(storedObservation(result,{})),new Date().toISOString(),new Date().toISOString()).run();}

test('actual unchanged legacy snapshot API and mounted current UI fence default/V1/V2 and late completion; GET never dispatches',async()=>{
 const {mf,runtime}=await localRuntime();const request=requester(runtime);let dom,loader,root,React,act;const globals=new Map(),nativeFetch=globalThis.fetch;let dispatches=0;
 try{
 const s=(await request('ontology/platform/snapshots',{})).snapshot;const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime);
 const assessment=(id,config)=>({version:'business-assessment-v1',runtimeVersion:'neo-runtime-v1',scope:{businessId:'test-a',dataNature:'demo',inputId:s.id,configurationVersion:'legacy:'+(config??'legacy-unversioned'),asOf:s.asOf,researchAsOf:s.asOf,operatingVersion:'test'},context:{completeReview:true,semanticValidation:{version:'semantic-support-v1',status:'verified'},versions:[{kind:'enterprise_rule',version:'legacy:'+(config??'legacy-unversioned')}]},metrics:{},claims:[],confirmations:[],reviewConditions:[],priorityAction:null,inputHash:id,projections:{professional:Object.fromEntries(['conversion','supply','market'].map(role=>[role,{title:id,summary:id,evidenceIds:[]}])),finding:{conclusion:id,evidenceIds:[],gaps:[],alternatives:[],candidates:[],followups:[]}}});
 const store=async(id,config)=>{const a=assessment(id,config);await insertRun(runtime,s,id,a);await recordKnowledgeDependencies(ctx,'demo',id,a);};
 const publish=async(label)=>{const active=await request('ontology/platform'),settings=defaultPlatformSettings();settings.agents.supply.mission=label;const draft=await request('ontology/platform/drafts',{baseId:active.id,settings});await request('ontology/platform/drafts/'+draft.id+'/publish',{});return draft.id;};
 await store('default-complete',null);let data=await request('agent-runs?snapshotId='+s.id);assert.equal(currentAssessmentRun(data.items,s,data.currentConfigurationId).id,'default-complete');
 const v1=await publish('V1');assert.equal((await request('operating-snapshot?snapshotId='+s.id)).snapshot.id,s.id);data=await request('agent-runs?snapshotId='+s.id);assert.equal(currentAssessmentRun(data.items,s,data.currentConfigurationId),null);
 await store('default-late',null);assert.equal((await knowledgeFreshness(ctx,'demo','default-late')).status,'stale');
 await store('V1',v1);data=await request('agent-runs?snapshotId='+s.id);assert.equal(currentAssessmentRun(data.items,s,data.currentConfigurationId).id,'V1');assert.equal((await specialistReview(ctx,s,'conversion')).runId,'V1');assert.equal((await specialistReview(ctx,s,'supply')).runId,'V1');assert.equal((await savedMarketReview(ctx,s)).row.id,'V1');assert.equal((await request('briefings/today?snapshotId='+s.id)).organization.id,'V1');
 dom=new JSDOM('<div id="test"></div>',{url:'http://localhost/demo?businessId=test-a&dataNature=demo&snapshotId='+s.id});for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){globals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 ({default:React,act}=await import('react'));const {createRoot}=await import('react-dom/client');
 globalThis.fetch=async(url,options)=>{const target=new URL(typeof url==='string'?url:url.url,'http://localhost');if(target.pathname.startsWith('/api/'))return handleApi(new Request(target,options),runtime);if(target.pathname.includes('/runs')){dispatches++;throw Error('GET must not dispatch');}return nativeFetch(url,options);};
 loader=await createServer({configFile:false,plugins:[reactPlugin()],server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});const {OperatingProvider,useAgentInsights}=await loader.ssrLoadModule('/components/neo-demo/operating-context.tsx');const {HistoricalAssessment}=await loader.ssrLoadModule('/components/neo-demo/assessment-details.tsx');
 function Probe(){const {assessmentRun,runs}=useAgentInsights();const old=runs.find(x=>x.id==='V1');return React.createElement('div',null,React.createElement('output',{'data-testid':'current'},assessmentRun?.id??'none'),old&&React.createElement(HistoricalAssessment,{run:old}));}
 root=createRoot(document.getElementById('test'));await act(async()=>{root.render(React.createElement(OperatingProvider,null,React.createElement(Probe)));await new Promise(r=>setTimeout(r,30));});
 const text=()=>document.querySelector('[data-testid=current]').textContent;const waitCurrent=async(expected)=>{for(let i=0;i<100&&text()!==expected;i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert.equal(text(),expected);};await waitCurrent('V1');
 const v2=await publish('V2');await act(async()=>{window.dispatchEvent(new Event('neo:results'));await new Promise(r=>setTimeout(r,30));});await waitCurrent('none');assert.match(document.body.textContent,/当前发布配置已改变/);assert.match(document.body.textContent,/V1/);assert.equal(await completeAssessmentRow(ctx,s),null);assert.equal(await specialistReview(ctx,s,'conversion'),null);assert.equal(await specialistReview(ctx,s,'supply'),null);assert.equal((await savedMarketReview(ctx,s)).review,null);const staleBrief=await request('briefings/today?snapshotId='+s.id);assert.equal(staleBrief.organization,null);assert.equal(staleBrief.historicalOrganization.id,'V1');
 await store('V1-late',v1);assert.equal((await knowledgeFreshness(ctx,'demo','V1-late')).status,'stale');await act(async()=>{window.dispatchEvent(new Event('neo:results'));await new Promise(r=>setTimeout(r,30));});await waitCurrent('none');
 const historical=await request('agent-runs/V1?snapshotId='+s.id);assert.equal(historical.result.businessAssessment.scope.configurationVersion,'legacy:'+v1);assert.equal(historical.configurationFreshness.status,'stale');assert.equal(reviewResult({...historical,result:{...historical.result,operatingReviews:{joint:{headline:'must remain historical'}}}}),undefined);
 await store('V2',v2);await act(async()=>{window.dispatchEvent(new Event('neo:results'));await new Promise(r=>setTimeout(r,30));});await waitCurrent('V2');assert.equal((await completeAssessmentRow(ctx,s)).id,'V2');assert.equal(dispatches,0);assert.equal((await runtime.DB.prepare('SELECT count(*) n FROM neo_runs').first()).n,5);assert.equal((await runtime.DB.prepare('SELECT count(*) n FROM neo_business_generations').first()).n,0);
 }finally{if(root)await act(async()=>root.unmount());await loader?.close();globalThis.fetch=nativeFetch;dom?.window.close();for(const [key,d] of globals){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}await mf.dispose();}
});

test('decoded conditional counter-only document/claim/source versions register, invalidate and preserve exact historical text including spans',async()=>{
 const {mf,runtime}=await localRuntime();const request=requester(runtime),ctx=await context(new Request('http://localhost?businessId=test-a'),runtime);
 try{
 const at='2026-10-08T00:00:00Z';for(const id of ['source-B','source-A'])await runtime.DB.prepare('INSERT INTO neo_knowledge_sources(id,business_id,data_nature,kind,url,title,version,enabled,payload,actor_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,'test-a','demo','policy','https://www.gov.cn/'+id,'官方资料',1,1,'{}','local-owner',at,at).run();
 const text='该地区暂不适用此规则，条件须另行核验。';await runtime.DB.prepare('INSERT INTO neo_knowledge_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('document-B','test-a','demo','source-B',1,'body-v1','original-B',text,JSON.stringify([{index:0,text,start:0,end:text.length}]),null,at,'{}','active').run();
 await runtime.DB.prepare('INSERT INTO neo_knowledge_claims VALUES(?,?,?,?,?,?,?,?,?)').bind('claim-B','test-a','demo','document-B','claim-v1','active',JSON.stringify({statement:'该地区暂不适用此规则',paragraphIndices:[0],supportStatus:'supported'}),at,at).run();
 await recordKnowledgeDependencies(ctx,'demo','unrelated',{context:{versions:[{kind:'knowledge_source',id:'source-A',version:'1'}]}});
 for(const span of [false,true]){
 const code='from test_final_version_fences import counter_assessment; import json; print(json.dumps(counter_assessment('+ (span?'True':'False') +'),ensure_ascii=False))';const a=JSON.parse(execFileSync('agent-service/.venv/bin/python',['-c',code],{cwd:process.cwd(),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:'agent-service:agent-service/tests'},encoding:'utf8'}));
 const id=span?'counter-span':'counter-whole',s={id:a.scope.inputId,businessId:'test-a',dataNature:'demo',asOf:a.scope.asOf};await runtime.DB.prepare('INSERT OR IGNORE INTO operating_snapshots VALUES(?,?,?,?,?)').bind(s.id,'test-a','demo',at,JSON.stringify(s)).run();await insertRun(runtime,s,id,a);await recordKnowledgeDependencies(ctx,'demo',id,a);
 const deps=(await knowledgeFreshness(ctx,'demo',id)).dependencies;assert.equal((await knowledgeFreshness(ctx,'demo',id)).status,'current');assert.deepEqual(deps.map(x=>x.dependency_id).sort(),['claim-B','configuration:legacy-unversioned','document-B','source-B']);
 for(const [sql,args,status] of [["UPDATE neo_knowledge_claims SET body_hash=? WHERE id=?",['claim-v2','claim-B'],'stale'],["UPDATE neo_knowledge_documents SET content_hash=? WHERE id=?",['body-v2','document-B'],'stale'],["UPDATE neo_knowledge_documents SET coverage=? WHERE id=?",['{"pendingReplacement":true}','document-B'],'conflict']]){
 await runtime.DB.prepare(sql).bind(...args).run();assert.equal((await knowledgeFreshness(ctx,'demo',id)).status,status);assert.equal((await knowledgeFreshness(ctx,'demo','unrelated')).status,'current');await runtime.DB.prepare("UPDATE neo_knowledge_claims SET body_hash='claim-v1' WHERE id='claim-B'").run();await runtime.DB.prepare("UPDATE neo_knowledge_documents SET content_hash='body-v1',coverage='{}' WHERE id='document-B'").run();
 }
 const old=await request('agent-runs/'+id);assert.equal(old.result.businessAssessment.claims[0].counterevidence[0].exact,span?'该地区暂不适用此规则':text);const document=await request('knowledge-items/claim-B');assert.equal(document.document.paragraphs[0].text,text);
 }
 await request('knowledge-sources/source-B',{enabled:false});for(const id of ['counter-whole','counter-span'])assert.equal((await knowledgeFreshness(ctx,'demo',id)).status,'stale');assert.equal((await knowledgeFreshness(ctx,'demo','unrelated')).status,'current');
 }finally{await mf.dispose();}
});

test('legacy specialist and market API copies obey published configuration while raw saved history remains',async()=>{
 const {mf,runtime}=await localRuntime(),request=requester(runtime);
 try{
 const s=(await request('ontology/platform/snapshots',{})).snapshot,ctx=await context(new Request('http://localhost?businessId=test-a'),runtime);
 const dummy={projections:{finding:null}};
 for(const [id,mode] of [['legacy-conversion','conversion'],['legacy-market','market']]){
 await insertRun(runtime,s,id,dummy);const result={finding:{conclusion:id,evidenceIds:[],gaps:[],alternatives:[],candidates:[],followups:[],businessReview:{title:id,summary:id,evidenceIds:[]},marketWorkbench:{judgment:{title:id,summary:id,evidenceIds:[]},signals:[],cells:[],sources:[],nextStep:'核对资料'}}};
 await runtime.DB.prepare('UPDATE neo_runs SET payload=?,result=?,request_id=? WHERE id=?').bind(JSON.stringify({question:id,mode,purpose:'review',envelope:{snapshot:s,platformConfiguration:{version:'legacy-unversioned'}}}),JSON.stringify(storedObservation(result,{})),mode==='market'?'market-workbench-model-v1:fixture':id,id).run();
 }
 assert.equal((await request('customer-journey?snapshotId='+s.id)).review.title,'legacy-conversion');assert.equal((await savedMarketReview(ctx,s)).review.judgment.title,'legacy-market');
 const active=await request('ontology/platform'),draft=await request('ontology/platform/drafts',{baseId:active.id,settings:defaultPlatformSettings()});await request('ontology/platform/drafts/'+draft.id+'/publish',{});
 assert.equal((await request('customer-journey?snapshotId='+s.id)).review,null);assert.equal((await savedMarketReview(ctx,s)).review,null);assert.equal((await request('market-workbench?snapshotId='+s.id)).modelReview,null);
 const history=await request('agent-runs/legacy-market?snapshotId='+s.id);assert.equal(history.configurationFreshness.status,'stale');assert.equal(history.result.finding.marketWorkbench.judgment.title,'legacy-market');assert.equal((await runtime.DB.prepare('SELECT count(*) n FROM neo_runs').first()).n,2);
 }finally{await mf.dispose();}
});
