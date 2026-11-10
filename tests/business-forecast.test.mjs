import {test} from 'node:test';
import assert from 'node:assert/strict';
import {businessDayEnd,forecastSales,evaluateSales,evaluateIssuedForecast,errorScore} from '../lib/business-forecast.ts';
import {buildBusinessState} from '../lib/business-state.ts';
import {calculateScenario} from '../lib/business-scenarios.ts';
import {plusDays} from '../lib/business-metrics.ts';

function fixture(days=224){
 const start='2026-01-01',end=plusDays(start,days-1),knownAt=plusDays(end,1)+'T00:00:00+08:00';
 const records=Array.from({length:days},(_,i)=>({id:'paid-'+i,recordKey:'paid-'+i,sourceId:'erp',revision:1,kind:'order',entryType:'paid',entityId:'sku',channelId:'shop',orderId:'o-'+i,quantity:7+i%7,amountCents:(7+i%7)*1000,variableCostCents:(7+i%7)*200,businessDate:plusDays(start,i),knownAt:plusDays(start,i)+'T20:00:00+08:00'}));
 const coverage=[{kind:'order',sourceId:'erp',start,end,knownAt:'2025-12-31T00:00:00+08:00'}];
 const m={businessId:'own',dataNature:'demo',timezone:'Asia/Shanghai',asOf:end,knownAt,start,end,expectedSources:['erp'],records,coverage};
 const profile={industry:'ecommerce',name:'隔离合成预测',timezone:'Asia/Shanghai',region:'CN',horizonDays:28,objective:'contribution_margin',cashBudgetCents:10000,expectedSources:[{sourceId:'erp',kinds:['order','expense','inventory','fulfillment_rule']}],competitors:[]};
 const extra=[{id:'stock',recordKey:'stock',sourceId:'erp',revision:1,knownAt,kind:'inventory',entityId:'sku',warehouseId:'east',businessDate:end,quantity:10000},{id:'rule',recordKey:'rule',sourceId:'erp',revision:1,knownAt,kind:'fulfillment_rule',entityId:'sku',channelId:'shop',warehouseId:'east',businessDate:end,leadDays:0,costCents:0},{id:'expense',recordKey:'expense',sourceId:'erp',revision:1,knownAt,kind:'expense',entityId:'spend',businessDate:end,amountCents:0}];
 const spans=[...coverage,...['expense','inventory','fulfillment_rule'].map(kind=>({kind,sourceId:'erp',start,end:plusDays(end,28)}))];
 const state=buildBusinessState({businessId:'own',dataNature:'demo',profileVersion:'p',profile,asOf:end,knownAt,start:plusDays(end,-55),end},[...records,...extra],spans);
 return {m,state};
}
test('six non-overlapping as-of folds report leaf errors without promoting the test winner',()=>{
 const {m,state}=fixture(),f=forecastSales(state,m,state.knownAt),e=f.evaluation;
 assert.equal(f.status,'ready');assert.equal(f.target,'paid_units');assert.equal(f.totalUnits,280);assert.equal(e.folds.length,6);assert.equal(e.skipped.length,0);
 assert.equal(e.metrics.weekday_mean_4.wape,0);assert.ok(e.metrics.four_week_mean.wape>0);assert.equal(f.method,'four_week_mean');assert.equal(e.promotion.status,'baseline_only');assert.equal(e.interval.status,'not_calibrated');
 for(let i=1;i<e.folds.length;i++)assert.equal(plusDays(e.folds[i-1].end,1),e.folds[i].start);
});
test('refund changes money but does not cancel the paid demand or fabricate restock',()=>{
 const {m,state}=fixture();const refund={...m.records.at(-1),id:'refund',recordKey:'refund',entryType:'refund',quantity:100,amountCents:100000,variableCostCents:20000};
 const base=forecastSales(state,m,state.knownAt),f=forecastSales({...state,inputs:[...state.inputs,refund]},{...m,records:[...m.records,refund]},state.knownAt);
 assert.equal(f.totalUnits,base.totalUnits);assert.equal(f.audit.refundRecords,1);
 const before=calculateScenario(state,{id:'base',name:'基线',demandBps:10000,actions:[]},'g',base),after=calculateScenario({...state,inputs:[...state.inputs,refund]},{id:'base',name:'基线',demandBps:10000,actions:[]},'g',f);
 assert.equal(before.totals.requested,280);assert.equal(after.totals.requested,280);assert.equal(after.totals.endingSellable,before.totals.endingSellable);assert.ok(after.totals.netRevenueCents<before.totals.netRevenueCents);
});
test('late publication cannot produce historical accuracy; timezone-free clocks are rejected',()=>{
 const {m}=fixture();const late={...m,records:m.records.map(r=>({...r,knownAt:plusDays(m.end,1)+'T12:00:00+08:00'})),coverage:m.coverage.map(c=>({...c,knownAt:plusDays(m.end,1)+'T12:00:00+08:00'}))};
 assert.equal(evaluateSales(late,28).status,'no_paid_series');
 const unknown={...m,records:m.records.map(r=>({...r,knownAt:r.knownAt.replace('+08:00','')}))};assert.equal(evaluateSales(unknown,28).status,'no_paid_series');
 assert.equal(businessDayEnd('2026-01-01','Asia/Shanghai'),'2026-01-01T15:59:59.999Z');assert.equal(businessDayEnd('2026-03-08','America/New_York'),'2026-03-09T03:59:59.999Z');
});
test('revision unavailable at a fold cutoff is not used in the training values',()=>{
 const {m}=fixture(),old=m.records[30],revision={...old,id:'correction',revision:2,quantity:999,knownAt:plusDays(m.end,1)+'T00:00:00+08:00'};
 const original=evaluateSales(m,28),changed=evaluateSales({...m,records:[...m.records,revision]},28);
 assert.deepEqual(original.folds.map(f=>f.metrics),changed.folds.map(f=>f.metrics));
});
test('missing source coverage, new sequences and channel omissions are not silently zeros',()=>{
 const {m,state}=fixture();const hole={...m,coverage:[{...m.coverage[0],end:plusDays(m.end,-1)}]};assert.equal(forecastSales(state,hole,state.knownAt).status,'insufficient');
 const newRow={...m.records.at(-1),id:'new',recordKey:'new',entityId:'new'};const f=forecastSales({...state,inputs:[...state.inputs,newRow]},{...m,records:[...m.records,newRow]},state.knownAt);assert.ok(f.unestimatedEntityIds.includes('new'));assert.equal(f.series.find(s=>s.entityId==='new').status,'short_history');assert.ok(!f.points.some(p=>p.entityId==='new'));
 const omitted={...m,records:[...m.records,{...newRow,channelId:undefined}]};assert.equal(forecastSales(state,omitted,state.knownAt).status,'insufficient');
 assert.equal(errorScore([[0,0]]).wape,null);assert.equal(errorScore([[0,1]]).mae,1);
});
test('issued forecast stays frozen; actual labels wait for a mature complete period',()=>{
 const {m,state}=fixture(),f=forecastSales(state,m,businessDayEnd(m.end,m.timezone)),frozen=JSON.stringify(f);
 assert.equal(evaluateIssuedForecast(f,m).status,'awaiting_labels');
 const more=Array.from({length:28},(_,i)=>({...m.records[0],id:'actual-'+i,recordKey:'actual-'+i,businessDate:plusDays(m.end,i+1),knownAt:plusDays(m.end,i+1)+'T20:00:00+08:00',quantity:10}));
 const actual={...m,end:plusDays(m.end,28),asOf:plusDays(m.end,28),knownAt:plusDays(m.end,29)+'T00:00:00+08:00',records:[...m.records,...more],coverage:[{...m.coverage[0],end:plusDays(m.end,28)}]};
 const e=evaluateIssuedForecast(f,actual);assert.equal(e.status,'evaluated');assert.equal(e.domain,'forward');assert.equal(e.metrics.wape,0);assert.equal(JSON.stringify(f),frozen);
 const retro=evaluateIssuedForecast({...f,issuedAt:actual.knownAt},actual);assert.equal(retro.domain,'retrospective');
});
