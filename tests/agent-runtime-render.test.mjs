import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {writeFile} from 'node:fs/promises';
let loader,Details;const htmls=[];
before(async()=>{loader=await createServer({configFile:false,plugins:[react()],cacheDir:process.cwd()+'/outputs/ts-cancel-dispatch-handoff/render-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});({RunObservationDetails:Details}=await loader.ssrLoadModule('/components/neo-demo/live-agents.tsx'));});
after(async()=>{await writeFile('outputs/ts-cancel-dispatch-handoff/component-render.html',htmls.join('\n'));await loader?.close();});
for(const [name,status,pending,text] of [['queue','queued',false,'等待分析'],['stopping','cancelled',true,'正在停止分析'],['partial','failed',false,'保留已有结论'],['unknown','failed',false,'需要核查后再继续']]){
 test('original demo observation component renders '+name+' with reported/estimated tokens separated',()=>{
  const partial=name==='partial'?{finding:null,specialists:{conversion:{conclusion:'已取得的经营判断'}},marketEvidence:[],partial:true}:null;
  const run={id:'offline-render',status,result:partial,observability:{cancellationPending:pending,waitSeconds:1.25,runSeconds:4.25,reportedTokens:12,estimatedOrReservedTokens:100,queuePosition:status==='queued'?2:null,retryable:false,errorCode:name==='unknown'?'MODEL_CALL_UNCERTAIN':null}};
  const html=renderToStaticMarkup(React.createElement(Details,{run}));htmls.push(html);assert.match(html,new RegExp(text));assert.match(html,/已报告用量/);assert.match(html,/估算或预留用量/);assert.match(html,/12 tokens/);assert.match(html,/100 tokens/);assert.match(html,/没有价格表/);assert.doesNotMatch(html,/￥|¥|人民币成本[：:]\s*\d/);
 });
}
for(const pending of [false,true])test('uncertain resume observation remains explicit, with cancellation taking priority '+pending,()=>{
 const run={id:'resume-unknown',status:'failed',result:null,observability:{resumePending:true,cancellationPending:pending,retryable:false,gatewayControl:'resume_unknown'}};
 const html=renderToStaticMarkup(React.createElement(Details,{run}));htmls.push(html);assert.match(html,new RegExp(pending?'正在停止分析，保存已有结论':'正在核对继续分析的状态'));assert.doesNotMatch(html,/分析已完成/);
});
