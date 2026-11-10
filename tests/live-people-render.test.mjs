import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
let loader,Funnel,Entry,Original,PulseContent;
before(async()=>{loader=await createServer({configFile:false,plugins:[react()],cacheDir:process.cwd()+'/outputs/people-journey-20261006/render-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});({JourneyFunnel:Funnel}=await loader.ssrLoadModule('/components/neo-demo/live-people.tsx'));({Prototype:Entry}=await loader.ssrLoadModule('/components/neo-demo/people-entry.tsx'));({Prototype:Original}=await loader.ssrLoadModule('/components/neo-demo/prototype.tsx'));({CustomerPulseContent:PulseContent}=await loader.ssrLoadModule('/components/neo-demo/customer-pulse-drawer.tsx'));});
after(async()=>await loader?.close());
const p={start:'2026-08-24',end:'2026-09-20',counts:{A1:145,A2:107,A3:68,A4:46},transitions:[.683,.596,.667].map((rate,i)=>({from:'A'+(i+1),to:'A'+(i+2),rate,matureCustomers:100,convertedCustomers:Math.round(rate*100),immatureCustomers:5,reason:null}))};
test('backend journey shows customers, three real transition rates and period comparisons',()=>{
 const html=renderToStaticMarkup(React.createElement(Funnel,{journey:{recent:p,previous:{...p,start:'2026-07-27',end:'2026-08-23',transitions:p.transitions.map(t=>({...t,rate:.5}))},rule:{days:7,channelPolicy:'same_channel'}},onEvidence:()=>{}}));
 assert.match(html,/68.3%/);assert.match(html,/59.6%/);assert.match(html,/66.7%/);assert.match(html,/较前期上升 16.7 个百分点/);assert.match(html,/近四周客户旅程/);assert.match(html,/只比较同一渠道/);assert.doesNotMatch(html,/待接入|已关联客户 · 成交承接|订单笔数.*转化率/);
});
test('missing identity or observation does not create zero percent',()=>{
 const html=renderToStaticMarkup(React.createElement(Funnel,{journey:{recent:{...p,transitions:p.transitions.map(t=>({...t,rate:null,reason:'记录不完整'}))},previous:null,rule:null},onEvidence:()=>{}}));assert.match(html,/资料不足/);assert.doesNotMatch(html,/0.0%|待接入/);
});
test('entry preserves original example and other page markup exactly',()=>{
 for(const page of ['home','people','goods','market','overview'])assert.equal(renderToStaticMarkup(React.createElement(Entry,{page,mode:'example'})),renderToStaticMarkup(React.createElement(Original,{page,mode:'example'})));
});
test('current people enters separate page without removed customer card',()=>{
 const html=renderToStaticMarkup(React.createElement(Entry,{page:'people',mode:'business'}));assert.match(html,/neo-live-people-host/);assert.doesNotMatch(html,/已关联客户 · 成交承接|前期比较待接入|<h1>我的客户/);
});
test('weekly evidence leads with the server analysis and keeps source records and technical IDs folded',()=>{
 const reference={id:'snap-test:view:customer-pulse:2026-09-14',snapshotId:'snap-test',businessId:'business-a',nature:'demo'};
 const value={version:'customer-pulse-v1',stages:[{stage:'A3',name:'意向',customers:20,previousCustomers:15,difference:5,index:140}],judgment:{title:'意向客户增加，购买客户减少',summary:'意向增加 5 人，购买减少 2 人。',nextStep:'先核查意向客户的支付与观察进度。'},previousWeek:{start:'2026-09-07',end:'2026-09-13'},observations:['成熟转化率下降，原因需核查。'],conversion:null,rule:{days:7,channelPolicy:'same_channel'},limitations:['未完成观察的客户不当成流失。']};
 const data={evidence:{title:'09-14 至 09-20 · 4A 客户旅程分析',value,scopeLabel:'全部商品 / 全部渠道 / 2026-09-14 至 2026-09-20',asOf:'2026-09-24'},sources:[{kind:'events',recordCount:40,batch_id:'batch-one',filename:'行为.csv',source_name:'经营系统'},{kind:'orders',recordCount:10,batch_id:'batch-two',filename:'支付.csv',source_name:'经营系统'}],records:[{id:'private-id',kind:'orders',filename:'支付.csv',row_number:2,batch_id:'batch-two',payload:JSON.stringify({order_id:'private-order-id',entry_type:'paid',business_date:'2026-09-15'})}],nextCursor:20};
 const html=renderToStaticMarkup(React.createElement(PulseContent,{data,reference}));
 assert.match(html,/意向客户增加，购买客户减少/);assert.match(html,/先核查意向客户/);assert.match(html,/客户行为 · 40 条记录/);assert.match(html,/支付记录 · 10 条记录/);assert.match(html,/<details class="neo-pulse-trace"><summary>查看来源文件与原始记录/);assert.match(html,/<details class="neo-pulse-trace"><summary>查看统计规则与资料版本/);assert.doesNotMatch(html,/<details[^>]*\bopen\b|private-order-id|\{&quot;|加载更多来源/);
});
