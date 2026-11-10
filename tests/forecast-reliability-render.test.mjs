import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
let loader,Panel,Table,Enterprise;
before(async()=>{loader=await createServer({configFile:false,plugins:[react()],cacheDir:'outputs/forecast-enterprise/render-cache',server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});({ForecastReliability:Panel,ForecastSkuTable:Table}=await loader.ssrLoadModule('/components/neo-demo/forecast-reliability.tsx'));({ForecastEnterprisePanel:Enterprise}=await loader.ssrLoadModule('/components/neo-demo/forecast-enterprise-panel.tsx'));});
after(async()=>{await loader?.close();});
const score={actual:0,predicted:0,mae:null,wape:null,bias:null,cells:0};
const forecast={target:'paid_units',method:'four_week_mean',status:'ready',forecastOrigin:'2026-09-01',issuedAt:'2026-10-08T00:00:00Z',trainingStart:'2026-08-05',trainingEnd:'2026-09-01',dataCutoff:'2026-10-08T00:00:00Z',horizonDays:28,unestimatedEntityIds:['new'],series:[{entityId:'sku',channelId:'shop',units:10,status:'estimated'},{entityId:'new',channelId:'shop',units:0,status:'short_history'}],audit:{series:2,gaps:[]},limitations:['历史缺货未识别'],evaluation:{status:'no_paid_series',folds:[],skipped:[],metrics:{four_week_mean:score,last_week:score,weekday_mean_4:score},promotion:{reason:'尚未晋级'},interval:{reason:'尚未校准'},labelKnownAt:'2026-10-08T00:00:00Z'}};
test('visible reliability explains late history and does not present missing errors as zero',()=>{const html=renderToStaticMarkup(React.createElement(Panel,{forecast,value:{dataNature:'demo'}}));assert.match(html,/历史时点不可验证/);assert.match(html,/预测起点之后录入/);assert.match(html,/不可计算/);assert.match(html,/尚未校准/);assert.doesNotMatch(html,/准确率.*100%|WAPE.*0\.0%/);});
test('new SKU remains unknown and saved historical version is clearly marked',()=>{const html=renderToStaticMarkup(React.createElement(Table,{forecast}));assert.match(html,/未知/);assert.match(html,/历史不足/);assert.match(html,/筛选不改变预测总量/);const old=renderToStaticMarkup(React.createElement(Panel,{forecast,value:null,historical:true}));assert.match(old,/旧资料版本/);});

test('enterprise panel exposes model jobs and versioned assumptions without inventing enterprise precision',()=>{const html=renderToStaticMarkup(React.createElement(Enterprise,{businessId:'fixture',nature:'demo',generationId:'g',origin:'2026-10-07',horizonDays:28,timezone:'Asia/Shanghai',canWrite:false,isAdmin:false}));assert.match(html,/只用当时可获得资料/);assert.match(html,/历史做重建研究/);assert.match(html,/假设台账与条件修订/);assert.match(html,/disabled=""[^>]*>运行模型对照/);assert.doesNotMatch(html,/通过真实企业验收|准确率.*100%/);});
