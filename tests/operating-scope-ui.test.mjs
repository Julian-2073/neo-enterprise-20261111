import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';

test('invalid snapshot shows an error instead of an endless investigation and retries the pinned scope',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/demo?page=goods&businessId=b&dataNature=demo&snapshotId=foreign'});
 const globals=new Map(),nativeFetch=globalThis.fetch;let loader,root,reads=0;const scopes=[];
 for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){globals.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
 globalThis.fetch=async raw=>{const url=new URL(raw,'http://localhost');if(url.pathname.endsWith('businesses/current'))return Response.json({current:{id:'b',name:'B',role:'admin'},businesses:[{id:'b',name:'B',role:'admin'}]});if(!url.pathname.endsWith('operating-snapshot'))return Response.json({items:[]});reads++;scopes.push(url.searchParams.get('snapshotId'));return reads===1?Response.json({error:{message:'快照不存在'}},{status:404}):Response.json({snapshot:{id:'foreign',businessId:'b',dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-09-01',periodEnd:'2026-09-24',data:{}}});};
 const {default:React,act}=await import('react'),{createRoot}=await import('react-dom/client');
 try{
  loader=await createServer({configFile:false,plugins:[react()],cacheDir:'outputs/runtime-fixes-20261018/ui-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
  const {OperatingProvider}=await loader.ssrLoadModule('/components/neo-demo/operating-context.tsx');
  const {OperatingScope}=await loader.ssrLoadModule('/components/neo-demo/operating-scope.tsx');
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(OperatingProvider,null,React.createElement(OperatingScope,null,React.createElement('h1',null,'业务页已读取')))));
  assert.match(document.body.textContent,/无法读取经营资料/);
  assert.match(document.querySelector('[role="alert"]').textContent,/快照不存在/);
  assert.doesNotMatch(document.body.textContent,/业务页已读取|正在核查/);
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='重新读取');assert.ok(button);
  await act(async()=>button.click());
  assert.match(document.body.textContent,/业务页已读取/);
  assert.deepEqual(scopes.slice(0,2),['foreign','foreign']);
 }finally{if(root)await act(async()=>root.unmount());await loader?.close();globalThis.fetch=nativeFetch;dom.window.close();for(const [k,v] of globals){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}}
});


test('closed automatic policy prevents page-load reviews while explicit updates remain available',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/demo?businessId=b&dataNature=demo&snapshotId=s'});
 const globals=new Map(),nativeFetch=globalThis.fetch;let loader,root;const posts=[];
 for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){globals.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
 globalThis.fetch=async(raw,options)=>{const url=new URL(raw,'http://localhost');if(options?.method==='POST')posts.push(url.pathname);
  if(url.pathname.endsWith('businesses/current'))return Response.json({current:{id:'b',name:'B',role:'admin'},businesses:[{id:'b',name:'B',role:'admin'}]});
  if(url.pathname.endsWith('operating-snapshot'))return Response.json({snapshot:{id:'s',businessId:'b',dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-09-01',periodEnd:'2026-09-24',data:{}}});
  if(url.pathname.endsWith('agent-policy'))return Response.json({interactiveAllowed:true,automaticPatrolAllowed:false});
  if(url.pathname.endsWith('home-decision'))return Response.json({canGenerate:true,run:null,decision:null,basis:{}});
  if(url.pathname.endsWith('growth-reviews'))return Response.json({canGenerate:true,reviews:{},sourceKey:'s'});
  return Response.json({items:[]});};
 const {default:React,act}=await import('react'),{createRoot}=await import('react-dom/client');
 try{
  loader=await createServer({configFile:false,plugins:[react()],cacheDir:'outputs/runtime-fixes-20261018/ui-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
  const {OperatingProvider}=await loader.ssrLoadModule('/components/neo-demo/operating-context.tsx');
  const {HomeDecisionProvider,useHomeDecision}=await loader.ssrLoadModule('/components/neo-demo/home-decision.tsx');
  const {GrowthReviewProvider,GrowthReviewCards}=await loader.ssrLoadModule('/components/neo-demo/growth-reviews.tsx');
  function Update(){const state=useHomeDecision();return React.createElement('button',{onClick:()=>state.update()},'手动更新首页');}
  root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(OperatingProvider,null,React.createElement(HomeDecisionProvider,{enabled:true},React.createElement(GrowthReviewProvider,{enabled:true},React.createElement(Update),React.createElement(GrowthReviewCards)))));});
  assert.deepEqual(posts,[],'visiting a page must respect closed automatic review policy');
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='手动更新首页').click());
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='更新审查').click());
  assert.deepEqual(posts.sort(),['/api/v1/growth-reviews','/api/v1/home-decision']);
 }finally{if(root)await act(async()=>root.unmount());await loader?.close();globalThis.fetch=nativeFetch;dom.window.close();for(const [k,v] of globals){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}}
});
