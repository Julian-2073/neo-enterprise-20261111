import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import reactPlugin from '@vitejs/plugin-react';

test('generated suggestions survive calculation failure and retry without generating another model task',async()=>{
 await withOptions(async({render,click,requests,setResponse})=>{
  const options='ABC'.split('').map(id=>({id,title:'建议'+id,summary:'核对供给',rationale:'依据已有资料',conditions:['先核实'],evidenceIds:[],externalEvidenceIds:[],assumptions:{}}));
  const value={run:{id:'r',status:'completed'},recommendations:{options},evaluation:null};
  let evaluations=0;
  setResponse((path,init)=>{if(path.includes('/evaluate')){evaluations++;return evaluations===1?Response.json({error:{message:'计算服务暂不可用'}},{status:503}):Response.json({items:options.map(o=>({optionId:o.id,scenario:null,replay:null,error:'供给资料不足'}))});}assert.equal(init.method,undefined);return Response.json(value);});
  await render();
  assert.match(document.body.textContent,/建议A/,'a successful model output must remain visible');
  assert.match(document.body.textContent,/计算服务暂不可用/);
  await click('重新计算与检验');
  assert.equal(evaluations,2);assert.match(document.body.textContent,/条件资料不足/);
  assert.equal(requests.filter(r=>r.init.method==='POST'&&!r.path.includes('/evaluate')).length,0);
 });
});

test('queued recommendations can be cancelled and safely resumed with the original task',async()=>{
 await withOptions(async({render,click,requests,setResponse})=>{
  let run={id:'same-task',status:'queued',observability:{retryable:true}};
  setResponse((path)=>{if(path.includes('/cancel')){run={...run,status:'cancelled',observability:{retryable:true}};return Response.json(run);}if(path.includes('/resume')){run={...run,status:'running'};return Response.json(run);}return Response.json({run,recommendations:null,evaluation:null});});
  await render();await click('取消建议生成');assert.match(document.body.textContent,/继续生成建议/);
  await click('继续生成建议');
  assert.ok(requests.some(r=>r.path.includes('/agent-runs/same-task/cancel')));
  assert.ok(requests.some(r=>r.path.includes('/agent-runs/same-task/resume')));
  assert.equal(requests.filter(r=>r.init.method==='POST'&&r.path.includes('/scenario-recommendations')).length,0);
 });
});

test('readers do not evaluate saved suggestions or receive write controls',async()=>{
 await withOptions(async({render,requests,setResponse})=>{
  setResponse(()=>Response.json({run:{id:'r',status:'failed',observability:{retryable:true}},recommendations:null,evaluation:null}));
  await render({canWrite:false});
  assert.ok([...document.querySelectorAll('button')].every(b=>b.disabled));
  assert.equal(requests.filter(r=>r.init.method==='POST').length,0);
 });
});

test('unknown generation response retries the same request identity instead of creating a second paid task',async()=>{
 await withOptions(async({render,click,requests,setResponse})=>{
  let sends=0;
  setResponse((path,init)=>{if(init.method==='POST'){if(++sends===1)throw Error('连接中断');return Response.json({run:{id:'original',status:'queued'},recommendations:null,evaluation:null});}return Response.json({run:null,recommendations:null,evaluation:null});});
  await render();await click('生成三个 AI 建议并检验');assert.match(document.body.textContent,/连接中断/);
  await click('生成三个 AI 建议并检验');
  const sent=requests.filter(r=>r.init.method==='POST').map(r=>JSON.parse(r.init.body));
  assert.equal(sent.length,2);assert.equal(sent[0].requestId,sent[1].requestId);
 });
});

test('unconfirmed cancellation cannot expose regenerate or resume controls',async()=>{
 await withOptions(async({render,setResponse})=>{
  setResponse(()=>Response.json({run:{id:'stopping',status:'cancelled',observability:{retryable:true,cancellationPending:true}},recommendations:null,evaluation:null}));
  await render();assert.match(document.body.textContent,/正在停止建议生成/);
  assert.equal(document.querySelector('button').disabled,true);
  assert.doesNotMatch(document.body.textContent,/继续生成建议|取消建议生成/);
 });
});

async function withOptions(work){
 const dom=new JSDOM('<div id="options"></div>',{url:'http://localhost/demo'}),original=new Map();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 const {default:React,act}=await import('react'),{createRoot}=await import('react-dom/client');let loader,root,response;
 const nativeFetch=globalThis.fetch,requests=[];
 globalThis.fetch=async(path,init={})=>{requests.push({path,init});return response(path,init);};
 try{
  loader=await createServer({configFile:false,plugins:[reactPlugin()],cacheDir:'outputs/current-feature-completion-20261010/ui-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
  const {AIScenarioOptions}=await loader.ssrLoadModule('/components/neo-demo/ai-scenario-options.tsx');root=createRoot(document.getElementById('options'));
  const props={baseline:{id:'baseline'},businessId:'b',dataNature:'demo',snapshotId:'s',canWrite:true,chosen:'',onSelect(){},onResults(){},onEvidence(){}};
  const render=async(p={})=>{await act(async()=>{root.render(React.createElement(AIScenarioOptions,{...props,...p}));});};
  const click=async(label)=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,'missing control: '+label);assert.equal(button.disabled,false);await act(async()=>button.click());};
  await work({act,render,click,requests,setResponse:fn=>{response=fn;}});
 }finally{
  if(root)await act(async()=>root.unmount());await loader?.close();globalThis.fetch=nativeFetch;dom.window.close();for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
}
