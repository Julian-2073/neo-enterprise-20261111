import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
let loader,Content,Charts,Original,Entry,Drawer,Scope;
before(async()=>{loader=await createServer({configFile:false,plugins:[react()],cacheDir:process.cwd()+'/outputs/evidence-unified-20261006/render-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});({OperatingEvidenceContent:Content}=await loader.ssrLoadModule('/components/neo-demo/operating-evidence-drawer.tsx'));Charts=await loader.ssrLoadModule('/components/neo-demo/charts-entry.tsx');Original=await loader.ssrLoadModule('/components/neo-demo/charts.tsx');({EvidenceDrawer:Entry}=await loader.ssrLoadModule('/components/neo-demo/evidence-entry.tsx'));({EvidenceDrawer:Drawer}=await loader.ssrLoadModule('/components/neo-demo/evidence-drawer.tsx'));({OperatingScope:Scope}=await loader.ssrLoadModule('/components/neo-demo/operating-scope.tsx'));});
after(async()=>await loader?.close());
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
test('all new evidence views show server diagnosis, metrics and next check; technical traces remain closed',()=>{
 const reference={id:'snap:metric',businessId:'a',snapshotId:'snap',nature:'demo'};const data={evidence:{title:'渠道经营记录',asOf:'2026-09-24',scopeLabel:'抖音',formula:'原始统计规则'},analysis:{version:'evidence-analysis-v1',judgment:{title:'贡献毛利为负',summary:'本期投入超过贡献。',nextStep:'先核查费用和成本。'},metrics:[{label:'贡献毛利',value:-800,unit:'人民币分',previous:100}],observations:['投放比例不能当作增量收益。'],limitations:['来源覆盖仍待核查。']},sources:[{kind:'orders',batch_id:'batch',filename:'orders.csv',source_name:'source-private',recordCount:50}],records:[{id:'id',kind:'orders',row_number:2,filename:'orders.csv',batch_id:'batch',payload:'{"order_id":"private-id","amount_cents":1000}'}],nextCursor:null};
 const html=render(Content,{data,reference});assert.match(html,/贡献毛利为负|¥-8/);assert.match(html,/先核查费用和成本/);assert.match(html,/订单记录 · 50 条记录/);assert.match(html,/<details class="neo-pulse-trace"><summary>查看来源文件与原始记录/);assert.doesNotMatch(html,/<details[^>]*\bopen\b|private-id|source-private|<pre>/);
});
test('original example charts, money bars and evidence keep exactly the same markup',()=>{
 const chart={title:'4A 经营脉搏',labels:['1周'],series:[{id:'A1',name:'了解',color:'#7196e2',values:[100]}],onPoint:()=>{}};assert.equal(render(Charts.LineChart,chart),render(Original.LineChart,chart));
 const money={title:'近八周成交',total:'¥100',items:[{label:'费用',amount:'¥10',value:.1,color:'#2678e8'}]};assert.equal(render(Charts.MoneyBar,money),render(Original.MoneyBar,money));
 const evidence={id:'demo',title:'原证据',kind:'模拟',value:'100',scope:'R1',source:'模拟',date:'2026-09-24',note:'待核查'};assert.equal(render(Entry,{evidence,onClose:()=>{}}),render(Drawer,{evidence,onClose:()=>{}}));
});
test('operating range component is hidden without removing the pinned scope state',()=>{assert.equal(render(Scope,{}),'');});
