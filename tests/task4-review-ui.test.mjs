import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import reactPlugin from '@vitejs/plugin-react';

test('mounted current panels share one assessment version; stale/failed retained patrol stays historical; saved settings candidates can be confirmed or rejected after reload',async()=>{
 const dom=new JSDOM('<div id="test"></div>',{url:'http://localhost/demo?businessId=b&dataNature=demo&snapshotId=s'}),original=new Map();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 const {default:React,act}=await import('react');const {createRoot}=await import('react-dom/client');let root,loader;const nativeFetch=globalThis.fetch;
 const snapshot={id:'s',businessId:'b',dataNature:'demo',asOf:'2026-09-30',periodStart:'2026-09-01',periodEnd:'2026-09-30',data:{inventory:[],financial:{},weeks:[],events:{},channels:[]},evidenceIds:{}};
 function run(id,status='completed',freshness='current',createdAt='2026-10-08'){return {id,snapshotId:'s',purpose:'patrol',status,createdAt,steps:[],knowledgeFreshness:{status:freshness},result:{finding:{conclusion:id,organization:{headline:id,summary:id+'影响',priorities:[{title:id+'行动',reason:id+'原因'}]}},businessAssessment:{scope:{businessId:'b',dataNature:'demo',inputId:'s',configurationVersion:'legacy:legacy-unversioned',asOf:snapshot.asOf,researchAsOf:'2026-10-08',operatingVersion:'v1'},context:{completeReview:true,semanticValidation:{status:'verified'}},projections:{finding:{conclusion:id,organization:{headline:id,summary:id+'影响',priorities:[{title:id+'行动',reason:id+'原因'}]}}},priorityAction:{title:id+'行动'},metrics:{},claims:[],confirmations:[],reviewConditions:[]}}};}
 let items=[run('旧巡检','completed','stale','2020-01-02')],briefing=run('旧简报','completed','current','2020-01-01');
 globalThis.fetch=async(url)=>{const p=new URL(url,'http://localhost').pathname;return Response.json(p.endsWith('businesses/current')?{businesses:[{id:'b',name:'企业',role:'admin'}],current:{id:'b',name:'企业',role:'admin'}}:p.endsWith('operating-snapshot')?{snapshot}:p.endsWith('agent-policy')?{automaticPatrolAllowed:false}:p.endsWith('agent-domain')?{products:[],skus:[],channels:[],roles:[],arrivals:[],facts:[]}:p.endsWith('agent-runs')?{items}:p.endsWith('decision-workbench')?{briefing,organizationRuns:{briefing},findings:[],scenarios:[],decisions:[]}:{items:[]});};
 try{
 loader=await createServer({configFile:false,plugins:[reactPlugin()],server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
 const {OperatingProvider,useNeoData}=await loader.ssrLoadModule('/components/neo-demo/operating-context.tsx');const {DecisionSummary}=await loader.ssrLoadModule('/components/neo-demo/live-agents.tsx');const {KnowledgeSettings}=await loader.ssrLoadModule('/components/ontology/knowledge-settings.tsx');
 function Home(){const {demo}=useNeoData();return React.createElement('div',{'data-testid':'home'},demo.issue.title+' '+demo.opportunities.map(x=>x.title+' '+x.date).join(' '));}
 root=createRoot(document.getElementById('test'));await act(async()=>root.render(React.createElement(OperatingProvider,null,React.createElement(Home),React.createElement(DecisionSummary))));
 const currentText=()=>document.querySelector('[data-testid=home]').textContent;
 assert.doesNotMatch(currentText(),/旧巡检/);assert.match(document.body.textContent,/历史保存判断 · 2020-01-02/);
 items=[run('新完整研判','completed','current','2026-10-08'),run('失败巡检','failed','current','2026-10-09')];await act(async()=>window.dispatchEvent(new Event('neo:results')));assert.match(currentText(),/新完整研判/);assert.match(currentText(),/2026-10-08/);assert.doesNotMatch(currentText(),/失败巡检|旧简报/);assert.match(document.querySelector('[aria-label=统一经营判断]').textContent,/新完整研判/);
 items=[run('失败巡检','failed','current')];await act(async()=>window.dispatchEvent(new Event('neo:results')));assert.doesNotMatch(currentText(),/失败巡检/);assert.match(document.body.textContent,/当前资料尚未形成完整、有效/);
 await act(async()=>root.unmount());root=createRoot(document.getElementById('test'));const saved=[{id:'candidate-1',state:'candidate',version:1,payload:{statement:'范围内陈述',scope:{entities:['SKU-R1']},references:[{id:'source',version:'1'}],provenance:{kind:'model_result'}}},{id:'candidate-2',state:'candidate',version:1,payload:{statement:'人工候选',scope:{entities:['SKU-S2']},references:[]}}],calls=[];
 const api=async(path,method,body)=>{if(method==='POST'){calls.push({path,body});const item=saved.find(x=>path.includes(x.id));item.state=path.endsWith('confirm')?'active':'rejected';return {item};}assert.ok(['knowledge-sources','monitor','agent-memory','knowledge-items'].includes(path),'unknown settings route '+path);return path==='agent-memory'?{items:saved}:path==='monitor'?{}:{items:[]};};
 await act(async()=>root.render(React.createElement(KnowledgeSettings,{businessId:'b',nature:'demo',role:'admin',api})));
 await act(async()=>{const el=[...document.querySelectorAll('textarea')][0];Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(el,'核验原资料范围');el.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='确认候选').click());assert.equal(calls[0].path,'agent-memory/candidate-1/confirm');assert.equal(calls[0].body.confirmationMode,undefined);
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='拒绝候选').click());assert.equal(calls[1].path,'agent-memory/candidate-2/reject');assert.match(document.body.textContent,/active/);assert.match(document.body.textContent,/rejected/);
 }finally{if(root)await act(async()=>root.unmount());await loader?.close();globalThis.fetch=nativeFetch;dom.window.close();for(const [key,d] of original){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}}
});
