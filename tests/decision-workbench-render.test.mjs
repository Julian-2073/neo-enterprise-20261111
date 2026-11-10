import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
let loader,Joint,JointReview,Forecast;
before(async()=>{loader=await createServer({configFile:false,plugins:[react()],cacheDir:process.cwd()+'/outputs/overview-20261007/render-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});({JointEvidence:Joint,JointReviewCard:JointReview,ForecastOverview:Forecast}=await loader.ssrLoadModule('/components/neo-demo/live-overview.tsx'));});
after(async()=>await loader?.close());
test('joint view uses canonical sections and concise dated sources, without manufacturing missing observations',()=>{
 const data={sections:{people:{labels:[],series:[],weeks:[]},goods:{labels:[],series:[],weeks:[],note:'备货规则待确认'},market:{sources:[{id:'source',evidenceId:'exact-source',publishedAt:'2026-09-12',retrievedAt:'2026-10-06',summary:'可追溯的行业原文',publisher:'原文发布方',timing:'historical'}]}},timeline:{weeks:[{start:'2026-09-07',end:'2026-09-13',label:'1周',date:'09.07'}],people:[],supply:[],signals:[],events:[{id:'source',evidenceId:'exact-source',date:'2026-09-12',weekIndex:0,summary:'可追溯的行业原文',publisher:'原文发布方'}],observations:[]},joint:{review:{status:{title:'客户意向增长，库存不足',summary:'成交仍增长，供给承接偏紧'},market:{summary:'缺少可比竞品价格原文',evidenceIds:[]},confirmations:[{question:'到货时间待确认',why:'影响后续保供选择',check:'核对收货日期',evidenceIds:[]}],nextAction:{title:'先核对到货',summary:'核实计划是否实际收货',whyFirst:'供给是当前优先约束',decisionGate:'收货确认后再比較投放',steps:['核对收货'],evidenceIds:[]},alternatives:[{action:'增加投放',whyNotFirst:'暂未确认供给'}]},metrics:[{key:'stock',value:40,unit:'件',label:'当前可售库存',evidenceId:'stock-proof'}],evidenceIds:['stock-proof']}};
 const html=renderToStaticMarkup(React.createElement(Joint,{data,href:p=>p+'&snapshotId=immutable',open:()=>{},next:()=>{}}));for(const text of ['三域经营脉搏','客户意向增长，库存不足','到货时间待确认','先核对到货','09.12','09.07','人货场共同时间轴','snapshotId=immutable'])assert.ok(html.includes(text),text);
 const empty=renderToStaticMarkup(React.createElement(Joint,{data:null,href:p=>p,open:()=>{},next:()=>{}}));assert.match(empty,/正在对齐经营与市场日期/);assert.doesNotMatch(empty,/32\.0%|45\.0%|已有记录/);
});
test('forecast emphasizes real quantities and finances, keeps method limitations accessible, preserves unknown costs',()=>{
 const baseline={...JSON.parse(readFileSync('tests/fixtures/partial-forecast.json')),id:'forecast',title:'维持现状'};
 const html=renderToStaticMarkup(React.createElement(Forecast,{data:{history:[{start:'2026-09-14',units:null}],products:[]},baseline,selected:baseline,open:()=>{}}));for(const text of ['未来 28 天商品销量',' 件','净成交额','贡献毛利','当前条件下预计缺口','期末库存资金','查看预测依据与商品明细','需求未知，不是零','待补数据','历史预测'])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/105–135| 人|已通过回测/);
 const empty=renderToStaticMarkup(React.createElement(Forecast,{data:null,baseline:null,selected:null,open:()=>{}}));assert.match(empty,/尚未计算/);assert.doesNotMatch(empty,/>0<|¥0/);
});

test('joint review keeps decision questions, conditions and alternatives; no legacy or unknown data posed as AI output',()=>{
 const waiting=renderToStaticMarkup(React.createElement(JointReview,{data:{joint:{summary:'旧首页摘要',gaps:['旧缺口'],action:{summary:'旧建议'}}},open:()=>{},next:()=>{}}));
 assert.match(waiting,/联合研判尚未完成/);assert.doesNotMatch(waiting,/旧首页摘要|旧缺口|旧建议|¥0/);
});
