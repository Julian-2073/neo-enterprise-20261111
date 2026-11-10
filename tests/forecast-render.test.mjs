import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFile,writeFile} from 'node:fs/promises';
let loader,Notes,Metrics;const html=[];const out=process.cwd()+'/outputs/forecast-ui-integration-handoff';
before(async()=>{loader=await createServer({configFile:false,plugins:[react()],cacheDir:out+'/render-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});({ForecastScopeNotes:Notes,ResultMetrics:Metrics}=await loader.ssrLoadModule('/components/neo-demo/live-agents.tsx'));});
after(async()=>{await writeFile(out+'/original-forecast-component-render.html',html.join('\n'));await loader?.close();});
for(const [filename,partial,unknown] of [['forecast.json',false,false],['partial-forecast.json',true,false],['unknown-cost-forecast.json',true,true]])test('original result components render frozen real Python '+filename,async()=>{
 const value=JSON.parse(await readFile(new URL('./fixtures/'+filename,import.meta.url)));
 const text=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(Notes,{result:value}),React.createElement(Metrics,{value:value.totals,result:value})));html.push(text);
 assert.match(text,/当前尚不能核验历史预测表现/);assert.match(text,/件/);assert.match(text,/净成交额/);
 if(partial){assert.match(text,/仅估算部分商品/);assert.match(text,/需求未知，不是零/);assert.match(text,/未来 28 天已估算商品销量/);assert.match(text,/贡献毛利<\/small><strong>待补数据/);}
 if(unknown)assert.match(text,/期末库存资金<\/small><strong>待补数据/);
 for(const cents of [value.totals.netRevenueCents,value.totals.contributionMarginCents,value.totals.endingInventoryCostCents])if(cents!=null)assert.ok(text.includes(new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100)));
});
test('zero money remains zero while missing money says pending',()=>{const value={units:0,netRevenueCents:0,contributionMarginCents:null,spendCents:null,extraCostCents:0,endingUnits:0,unmetUnits:0,endingInventoryCostCents:0};const text=renderToStaticMarkup(React.createElement(Metrics,{value}));html.push(text);assert.match(text,/¥0\.00/);assert.match(text,/待补数据/);});

test('canonical hotel result renders its saved horizon and room-night unit with partial scope',()=>{
 const value={units:3,netRevenueCents:1000,contributionMarginCents:500,spendCents:0,extraCostCents:0,endingInventoryCostCents:null,endingUnits:null,unmetUnits:2};
 const result={snapshotId:'generation-hotel',unit:'房晚',operatingModel:{horizonDays:3},forecastCoverage:{status:'partial',unestimatedProductIds:['new-room'],unestimatedSkuIds:['new-room']},totals:value};
 const html=renderToStaticMarkup(React.createElement(Metrics,{value,result}));assert.match(html,/未来 3 天/);assert.match(html,/3 房晚/);assert.doesNotMatch(html,/28 天|3 件/);
 const notes=renderToStaticMarkup(React.createElement(Notes,{result}));assert.match(notes,/需求未知，不是零/);assert.match(notes,/不能推荐全企业最优方案/);
});
