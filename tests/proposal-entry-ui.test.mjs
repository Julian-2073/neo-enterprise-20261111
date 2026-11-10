import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import reactPlugin from '@vitejs/plugin-react';

const assumptions={adjustments:[],arrivals:[],transfers:[],extraCostCents:12300};
const fixture=()=>({id:'proposal-run',snapshotId:'s',sessionId:'session',mode:'joint',status:'completed',steps:[],result:{finding:{conclusion:'条件待核对',evidenceIds:[],basis:[],gaps:[],alternatives:[],candidates:[],followups:[],proposedAssumptions:assumptions},specialists:{},marketEvidence:[],businessAssessment:{scope:{businessId:'b',dataNature:'demo',inputId:'s'},context:{semanticValidation:{status:'verified'}},claims:[]}}});

for(const entry of ['legacy','current']){
test(entry+': proposal links reject unverified saved findings',async()=>{
 const run=fixture();run.result.businessAssessment.context.semanticValidation.status='unverified';
 await withWorkspace(run,true,async()=>{
  assert.doesNotMatch(document.body.textContent,/本次改变了什么/);
  assert.match(document.body.textContent,/尚未取得完整支持核验/);
 },entry);
});
test(entry+': proposal events read saved quality before accepting conditions',async()=>{
 await withWorkspace(fixture(),false,async({act,dom,setRun})=>{
  const stale={...fixture(),configurationFreshness:{status:'stale'}};setRun(stale);
  await act(async()=>window.dispatchEvent(new dom.window.CustomEvent('neo:proposal',{detail:{snapshotId:'s',runId:'proposal-run',assumptions}})));
  assert.doesNotMatch(document.body.textContent,/本次改变了什么/);
  assert.match(document.body.textContent,/原判断的依赖已改变/);
  setRun(fixture());
  await act(async()=>window.dispatchEvent(new dom.window.CustomEvent('neo:proposal',{detail:{snapshotId:'s',runId:'proposal-run'}})));
  assert.match(document.body.textContent,/本次改变了什么/);
 },entry);
});
test(entry+': verified proposal links retain their preview behavior',async()=>{
 await withWorkspace(fixture(),true,async()=>assert.match(document.body.textContent,/本次改变了什么/),entry);
});

}

async function withWorkspace(initial,linked,work,entry){
 const dom=new JSDOM('<div id="desk"></div>',{url:'http://localhost/demo?businessId=b&dataNature=demo&snapshotId=s'+(linked?'&proposalRunId=proposal-run':'')});
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const globals=new Map();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){
  globals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 const {default:React,act}=await import('react'),{createRoot}=await import('react-dom/client');
 let loader,root,run=initial;const nativeFetch=globalThis.fetch;
 const snapshot={id:'s',businessId:'b',dataNature:'demo',asOf:'2026-09-30',periodStart:'2026-09-01',periodEnd:'2026-09-30',data:{inventory:[],financial:{},weeks:[],events:{},channels:[]},evidenceIds:{}};
 globalThis.fetch=async url=>{
  const path=new URL(url,'http://localhost').pathname;
  if(path.endsWith('home-decision'))return Response.json({canGenerate:false,run:null,basis:{forecast:null},decision:null});
  if(path.endsWith('growth-reviews'))return Response.json({canGenerate:false,reviews:{}});
  if(path.endsWith('decision-workbench'))return Response.json({error:{message:'测试未提供联合研判'}},{status:503});
  return Response.json(path.endsWith('businesses/current')?{businesses:[{id:'b',name:'企业',role:'admin'}],current:{id:'b',name:'企业',role:'admin'}}:path.endsWith('operating-snapshot')?{snapshot}:path.endsWith('/agent-runs/proposal-run')?run:path.endsWith('agent-policy')?{automaticPatrolAllowed:false,interactiveAllowed:false}:path.endsWith('agent-domain')?{products:[],skus:[],channels:[],roles:[],arrivals:[],facts:[]}:{items:[]});
 };
 try{
  loader=await createServer({configFile:false,plugins:[reactPlugin()],cacheDir:'outputs/audit-fixes-20261018/ui-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
  const {OperatingProvider}=await loader.ssrLoadModule('/components/neo-demo/operating-context.tsx');
  const {LiveDecisionWorkspace}=await loader.ssrLoadModule('/components/neo-demo/live-agents.tsx');
  const {LiveOverviewPage}=await loader.ssrLoadModule('/components/neo-demo/live-overview.tsx');
  function Desk(){const [view,setView]=React.useState('forecast');return React.createElement(LiveDecisionWorkspace,{view,setView,onEvidence(){}});}
  root=createRoot(document.getElementById('desk'));await act(async()=>root.render(React.createElement(OperatingProvider,null,React.createElement(entry==='current'?LiveOverviewPage:Desk))));
  await work({act,dom,setRun:value=>{run=value;}});
 }finally{
  if(root)await act(async()=>root.unmount());await loader?.close();globalThis.fetch=nativeFetch;dom.window.close();
  for(const [key,descriptor] of globals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
}
