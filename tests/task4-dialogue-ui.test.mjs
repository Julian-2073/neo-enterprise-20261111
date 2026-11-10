import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import reactPlugin from '@vitejs/plugin-react';

test('existing mounted chat handles greeting, natural first scope, followup and specialist switch without injected hidden scope',async()=>{
 const dom=new JSDOM('<div id="chat"></div>',{url:'http://localhost/demo?businessId=b&dataNature=demo&snapshotId=s'});
 const original=new Map();for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,IS_REACT_ACT_ENVIRONMENT:true})){original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 const {default:React,act}=await import('react');const {createRoot}=await import('react-dom/client');let root,loader;const sent=[];const nativeFetch=globalThis.fetch;
 const snapshot={id:'s',businessId:'b',dataNature:'demo',asOf:'2026-09-30',periodStart:'2026-08-01',periodEnd:'2026-09-30',data:{inventory:[],financial:{},weeks:[],channels:[]},evidenceIds:{}};
 const domain={products:[{id:'P1',name:'跑步机'}],skus:[{id:'SKU-R1',product_id:'P1'},{id:'SKU-S2',product_id:'P1'}],channels:[{id:'douyin',name:'抖音'}],roles:[],arrivals:[],facts:[]};
 globalThis.fetch=async(url,options={})=>{const path=new URL(url,'http://localhost').pathname;let value;if(path.endsWith('businesses/current'))value={businesses:[{id:'b',name:'测试企业',role:'admin'}],current:{id:'b',name:'测试企业',role:'admin'}};else if(path.endsWith('operating-snapshot'))value={snapshot};else if(path.endsWith('agent-domain'))value=domain;else if(path.endsWith('agent-policy'))value={interactiveAllowed:true,automaticPatrolAllowed:false};else if(path.endsWith('agent-runs')&&options.method==='POST'){const body=JSON.parse(options.body);sent.push(body);value={id:'run-'+sent.length,sessionId:'session-DOM',snapshotId:'s',mode:body.mode,question:body.question,status:'completed',steps:[],error:null,result:null};}else value={items:[]};return Response.json(value);};
 try{loader=await createServer({configFile:false,plugins:[reactPlugin()],cacheDir:'outputs/agent-optimization/task4-ui-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});const {OperatingProvider}=await loader.ssrLoadModule('/components/neo-demo/operating-context.tsx');const {LiveAgentPanel}=await loader.ssrLoadModule('/components/neo-demo/live-agents.tsx');root=createRoot(document.getElementById('chat'));
 await act(async()=>{root.render(React.createElement(OperatingProvider,null,React.createElement(LiveAgentPanel,{mode:'joint',onEvidence(){}})));});
 for(let i=0;i<15&&document.querySelector('textarea')?.disabled;i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});assert.equal(document.querySelector('textarea').disabled,false);
 async function send(text){await act(async()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(el,text);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});await act(async()=>{document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});}
 await send('你好');assert.equal(sent.length,0);assert.match(document.body.textContent,/请告诉我想先看什么/);
 await send('SKU-R1抖音最近四周成交多少');assert.equal(sent.length,1);assert.deepEqual(sent[0].dialogueScope,{entityId:'P1',skuId:'SKU-R1',channelId:'douyin',period:{start:'2026-09-03',end:'2026-09-30'}});
 await send('那库存呢');assert.equal(sent.length,2);assert.equal(sent[1].sessionId,'session-DOM');assert.equal(sent[1].dialogueScope,undefined);
 await act(async()=>{[...document.querySelectorAll('.neo-agent-tabs button')].find(b=>b.textContent==='人').click();});await send('当前统计期支付订单和退款分别有多少笔？');assert.equal(sent.at(-1).sessionId,'session-DOM');assert.equal(sent.at(-1).mode,'conversion');assert.equal(sent.at(-1).question,'当前统计期支付订单和退款分别有多少笔？');
 await send('SKU-R1和SKU-S2');assert.equal(sent.length,3);assert.match(document.body.textContent,/请先指定一个对象/);
 }finally{if(root)await act(async()=>root.unmount());await loader?.close();globalThis.fetch=nativeFetch;dom.window.close();for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
