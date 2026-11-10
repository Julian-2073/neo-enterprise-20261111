import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
let loader,Card,Prototype,ReviewLinks,PolicyView,Briefing,BriefingEntry;
before(async()=>{loader=await createServer({configFile:false,plugins:[react()],cacheDir:process.cwd()+'/outputs/home-decision-2026-10-06/render-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});({HomeForecastCard:Card}=await loader.ssrLoadModule('/components/neo-demo/home-decision.tsx'));({TodayBriefing:BriefingEntry}=await loader.ssrLoadModule('/components/neo-demo/briefing-entry.tsx'));({TodayBriefing:Briefing}=await loader.ssrLoadModule('/components/neo-demo/today-briefing.tsx'));({PolicyBriefingView:PolicyView}=await loader.ssrLoadModule('/components/neo-demo/policy-briefing.tsx'));({Prototype}=await loader.ssrLoadModule('/components/neo-demo/prototype.tsx'));({GrowthReviewLinks:ReviewLinks}=await loader.ssrLoadModule('/components/neo-demo/growth-reviews.tsx'));});
after(async()=>await loader?.close());
const forecast={id:'saved-f',asOf:'2026-09-24',dataNature:'demo',calculationVersion:'scenario-v1.3',inputHash:'fixed',totals:{units:35,unmetUnits:20,endingUnits:7,netRevenueCents:8245337,contributionMarginCents:-29662},weeks:[{start:'2026-09-25',end:'2026-10-01'},{start:'2026-10-02',end:'2026-10-08'},{start:'2026-10-09',end:'2026-10-15'},{start:'2026-10-16',end:'2026-10-22'}],limitations:[],backtest:{status:'historical_availability_unverified'},forecastCoverage:{status:'complete_for_observed_sales'}};
test('home renders saved quantities and AI implication, with lengthy verification inside disclosure',()=>{
 const html=renderToStaticMarkup(React.createElement(Card,{forecast,outlook:{title:'维持现状毛利承压',summary:'先核查费用与货盘收益。'},href:'/demo?page=overview&baselineId=saved-f'}));
 assert.match(html,/未来 28 天商品销量/);assert.match(html,/>35<small>件/);assert.match(html,/维持现状毛利承压/);assert.match(html,/82,453.37/);assert.match(html,/受供给条件约束 20 件 · 期末可售 7 件/);assert.match(html,/(?:-¥|¥-)296\.62/);
 assert.match(html,/<details[^>]*><summary>查看预测依据<\/summary>/);assert.ok(html.indexOf('预测是否可靠，还没有完成历史检验')>html.indexOf('<details'));assert.doesNotMatch(html,/35.*人|105–135|已读取保存|WAPE|SYNTHETIC_DEMO|计算版本/);
});
test('zero quantity is a saved forecast; absent forecast and unknown margin are explicit',()=>{
 const zero=renderToStaticMarkup(React.createElement(Card,{forecast:{...forecast,forecastCoverage:{status:'partial'},backtest:{status:'partially_evaluated'},totals:{...forecast.totals,units:0,contributionMarginCents:null}},href:'/demo'}));assert.match(zero,/>0<small>件/);assert.match(zero,/贡献毛利 待补数据/);assert.match(zero,/部分商品资料不足，暂未计入销量/);assert.match(zero,/成本资料不全，暂不能判断毛利/);assert.match(zero,/只检验了部分历史/);assert.doesNotMatch(zero,/贡献毛利 ¥0|已做历史对照/);
 const none=renderToStaticMarkup(React.createElement(Card,{forecast:null,notice:'没有可用销量历史',href:'/demo'}));assert.match(none,/预测资料待补齐|没有可用销量历史/);assert.doesNotMatch(none,/0<small>件/);
});
test('original example keeps original diagnosis, range, action and static interactions',()=>{
 const html=renderToStaticMarkup(React.createElement(Prototype,{page:'home',mode:'example'}));assert.match(html,/意向增长，成交承接走弱/);assert.match(html,/105–135/);assert.match(html,/48 小时供给核查/);assert.match(html,/mode=example/);assert.doesNotMatch(html,/更新经营判断|已读取保存的经营数据/);
});

test('growth links carry separate professional reviews into the correct page',()=>{
 const reviews=Object.fromEntries(['conversion','supply','market'].map(mode=>[mode,{id:'run-'+mode,status:'completed',result:{finding:{businessReview:{title:mode+'独立判断',summary:'本专业结果',evidenceIds:['ev']}}}}]));
 const html=renderToStaticMarkup(React.createElement(ReviewLinks,{reviews,href:path=>path+'&businessId=tenant-a&snapshotId=saved'}));
 for(const [mode,page] of [['conversion','people'],['supply','goods'],['market','market']]){assert.match(html,new RegExp('page='+page+'&amp;reviewRunId=run-'+mode));assert.match(html,new RegExp(mode+'独立判断'));}
 assert.doesNotMatch(html,/三种口径不能混算|已有记录/);
});


test('daily policy cards keep business reminders concise and provenance in disclosures',()=>{
 const briefing={checkedAt:'2026-10-06',stale:false,coverage:'已核验的全国政策',gaps:[],items:[{id:'p',label:'健身器材补贴需核对',summary:'未列健身器材',relevance:'先核对地方资格',applicability:'地方细则待核',source:{issuer:'国家发展改革委',publishedAt:'2025-12-30',retrievedAt:'2026-10-06',documentNumber:'发改环资〔2025〕1745号',title:'真实政策文件',url:'https://www.ndrc.gov.cn/xxgk/zcfb/tz/202512/t20251230_1402851.html'}}]};
 const html=renderToStaticMarkup(React.createElement(PolicyView,{briefing,busy:false,error:'',canRefresh:true,onRefresh:()=>{}}));
 assert.match(html,/对你的生意/);assert.match(html,/先核对地方资格/);assert.match(html,/<details><summary>适用范围与来源/);assert.ok(html.indexOf('地方细则待核')>html.indexOf('<details>'));assert.match(html,/2025-12-30/);assert.match(html,/ndrc.gov.cn/);assert.doesNotMatch(html,/政策与市场原文|模拟补贴/);
 const empty=renderToStaticMarkup(React.createElement(PolicyView,{briefing:null,busy:false,error:'',canRefresh:false,onRefresh:()=>{},example:true}));assert.match(empty,/原型演示未接入实时政策/);assert.doesNotMatch(empty,/政府原文已核验|更新政策/);
});


test('original example briefing preserves its lead, left policy/enterprise column and right market layout',()=>{
 const html=renderToStaticMarkup(React.createElement(Briefing,{onClose:()=>{}}));
 assert.match(html,/neo-briefing-lead/);assert.match(html,/neo-daily-grid/);assert.match(html,/neo-daily-side/);assert.match(html,/neo-daily-market/);assert.match(html,/我的企业/);assert.match(html,/等待可信政策来源/);assert.doesNotMatch(html,/is-live|neo-brief-priorities|neo-brief-metrics|更新政策/);
});


test('example integration returns the frozen original component without changing its markup',()=>{
 const original=renderToStaticMarkup(React.createElement(Briefing,{onClose:()=>{}}));
 const integrated=renderToStaticMarkup(React.createElement(BriefingEntry,{onClose:()=>{}}));
 assert.equal(integrated,original);
});
