import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildBusinessState} from '../lib/business-state.ts';
import {calculateScenario,recommendScenario,validateScenario} from '../lib/business-scenarios.ts';
let sequence=0;
const r=(kind,entityId,extra={})=>({kind,entityId,recordKey:String(++sequence),id:String(sequence),sourceId:'erp',revision:1,knownAt:'2026-10-01T00:00:00Z',businessDate:'2026-09-30',...extra});
const baseline={id:'base',name:'维持现状',demandBps:10000,actions:[]};
function state(industry,extras){const revenue=industry==='hotel'?'hotel_stay':'order';const kinds=[revenue,'expense','inventory','event','fulfillment_rule','arrival','hotel_capacity','hotel_reservation','material_inventory','bom','production_capacity','production'];const profile={industry,name:'隔离企业',timezone:'Asia/Shanghai',region:'CN',objective:'contribution_margin',cashBudgetCents:50000,horizonDays:3,expectedSources:[{sourceId:'erp',kinds}],competitors:[]};return buildBusinessState({businessId:industry,dataNature:'demo',profileVersion:'p',profile,asOf:'2026-09-30',knownAt:'2026-10-01T00:00:00Z',start:'2026-09-24',end:'2026-09-30'},[r(revenue,'sku',{quantity:21,amountCents:210000,variableCostCents:42000,entryType:'paid',orderId:'paid',channelId:'shop'}),r('expense','spend',{amountCents:7000}),...extras],kinds.map(kind=>({kind,sourceId:'erp',start:'2026-09-01',end:'2026-10-03'})));}
test('warehouse authorization and transfer lead/cost affect ecommerce fulfillment; no global stock pooling',()=>{
 const s=state('ecommerce',[r('inventory','sku',{warehouseId:'east',quantity:2}),r('inventory','sku',{warehouseId:'west',quantity:10}),r('fulfillment_rule','sku',{warehouseId:'east',channelId:'shop',leadDays:0,costCents:0})]);
 const base=calculateScenario(s,baseline,'g');assert.equal(base.status,'calculated');assert.equal(base.totals.fulfilled,2);assert.equal(base.totals.unmet,7);
 const spec=validateScenario({id:'transfer',name:'调拨',demandBps:10000,actions:[{kind:'transfer',entityId:'sku',fromWarehouseId:'west',warehouseId:'east',date:'2026-10-01',leadDays:1,quantity:6,costCents:1000,confirmed:true}]});
 const transferred=calculateScenario(s,spec,'g');assert.equal(transferred.totals.fulfilled,8);assert.equal(transferred.totals.actionCostCents,1000);assert.equal(transferred.points[0].fulfilled,2);assert.equal(transferred.points[1].fulfilled,3);
 assert.equal(recommendScenario([base,transferred]).scenarioId,'transfer');
 const late=calculateScenario(s,{...spec,actions:[{...spec.actions[0],leadDays:3}]},'g');assert.equal(late.totals.fulfilled,2);assert.equal(recommendScenario([base,late]).scenarioId,'base');
 const impossible=calculateScenario(s,{...spec,actions:[{...spec.actions[0],quantity:11}]},'g');assert.equal(impossible.feasibility.status,'infeasible');assert.equal(recommendScenario([impossible]).scenarioId,null);
});
test('hotel rooms remain per-night capacity; booking cancellation and outages are respected',()=>{
 const s=state('hotel',[...['01','02','03'].map(day=>r('hotel_capacity','sku',{businessDate:'2026-10-'+day,quantity:4,inspectionUnits:1})),r('hotel_reservation','sku',{businessDate:'2026-10-01',quantity:5,status:'planned'}),r('hotel_reservation','sku',{businessDate:'2026-10-02',quantity:10,status:'cancelled'})]);
 const base=calculateScenario(s,baseline,'g');assert.equal(base.totals.requested,11);assert.equal(base.totals.fulfilled,9);assert.equal(base.totals.unmet,2);assert.equal(base.unit,'房晚');assert.equal(base.totals.endingSellable,null);
 const add=calculateScenario(s,{...baseline,id:'extra',actions:[{kind:'hotel_capacity',entityId:'sku',date:'2026-10-01',quantity:2,leadDays:0,costCents:1000,confirmed:true}]},'g');assert.equal(add.totals.fulfilled,11);
 const missing=calculateScenario({...s,inputs:s.inputs.filter(r=>r.businessDate!=='2026-10-02')},baseline,'g');assert.equal(missing.status,'insufficient');assert.equal(missing.totals.fulfilled,null);
});
test('manufacturing single-level BOM, shared capacity and lead constrain production',()=>{
 const extras=[r('inventory','sku',{warehouseId:'w',quantity:0}),r('material_inventory','steel',{warehouseId:'w',quantity:8}),r('bom','sku',{materialId:'steel',unitsPerProduct:2,workCenterId:'c'}),...['01','02','03'].map(day=>r('production_capacity','c',{businessDate:'2026-10-'+day,quantity:3,workCenterId:'c'}))];
 const s=state('manufacturing',extras);
 const spec={...baseline,id:'make',actions:[{kind:'production',entityId:'sku',warehouseId:'w',workCenterId:'c',date:'2026-10-01',quantity:6,leadDays:1,costCents:1000,confirmed:true},{kind:'production',entityId:'sku',warehouseId:'w',workCenterId:'c',date:'2026-10-02',quantity:6,leadDays:1,costCents:1000,confirmed:true}]};
 const result=calculateScenario(s,spec,'g');assert.equal(result.totals.fulfilled,4);assert.equal(result.points[0].fulfilled,0);assert.ok(result.assumptions.some(x=>x.includes('仅支持3件')));assert.ok(result.assumptions.some(x=>x.includes('仅支持1件')));
 const noBom=calculateScenario({...s,inputs:s.inputs.filter(r=>r.kind!=='bom')},spec,'g');assert.equal(noBom.status,'insufficient');assert.equal(recommendScenario([noBom]).scenarioId,null);
});
test('missing financial coverage or cash budget cannot produce a recommended scenario; revisions are generation-bound',()=>{
 const s=state('hotel',['01','02','03'].map(day=>r('hotel_capacity','sku',{businessDate:'2026-10-'+day,quantity:3})));
 const partial=calculateScenario({...s,coverage:s.coverage.filter(c=>c.kind!=='hotel_reservation')},baseline,'g');assert.equal(partial.totals.contributionMarginCents,null);
 const noBudget=calculateScenario({...s,profile:{...s.profile,cashBudgetCents:null}},baseline,'g');assert.equal(recommendScenario([noBudget]).scenarioId,null);
 const good=calculateScenario(s,baseline,'g');assert.equal(recommendScenario([good,{...good,inputGeneration:'other'}]).scenarioId,null);
});

test('registered transfer uses the same movement, cost and lead as a scenario; shortage and cancellation conserve stock',()=>{
 const s=state('ecommerce',[r('inventory','sku',{warehouseId:'east',quantity:0}),r('inventory','sku',{warehouseId:'west',quantity:10}),r('fulfillment_rule','sku',{warehouseId:'east',channelId:'shop',leadDays:0,costCents:0})]);
 const action={kind:'transfer',entityId:'sku',fromWarehouseId:'west',warehouseId:'east',date:'2026-10-01',leadDays:1,quantity:6,costCents:1000,confirmed:false};
 const plan=r('arrival','sku',{fromWarehouseId:'west',warehouseId:'east',businessDate:'2026-10-02',leadDays:1,quantity:6,costCents:1000,status:'planned'});
 const registered=calculateScenario({...s,inputs:[...s.inputs,plan]},baseline,'g'),manual=calculateScenario(s,{...baseline,actions:[action]},'g');
 assert.deepEqual(registered.totals,manual.totals);assert.equal(registered.points[0].fulfilled,0);assert.equal(registered.totals.fulfilled,6);assert.equal(registered.totals.endingSellable,4);
 const insufficient=calculateScenario({...s,inputs:[...s.inputs.map(r=>r.kind==='inventory'&&r.warehouseId==='west'?{...r,quantity:5}:r),plan]},baseline,'g');assert.equal(insufficient.feasibility.status,'infeasible');assert.equal(insufficient.totals.fulfilled,0);assert.equal(insufficient.totals.endingSellable,5);
 const cancelled=calculateScenario({...s,inputs:[...s.inputs,{...plan,status:'cancelled'}]},baseline,'g');assert.equal(cancelled.totals.fulfilled,0);assert.equal(cancelled.totals.endingSellable,10);assert.equal(cancelled.totals.actionCostCents,0);
 const unknownCost=calculateScenario({...s,inputs:[...s.inputs,{...plan,costCents:undefined}]},baseline,'g');assert.equal(unknownCost.status,'insufficient');
});

test('unknown entities stay visible, partial coverage blocks enterprise recommendation and point budget is explicit',()=>{
 const s=state('ecommerce',[r('inventory','sku',{warehouseId:'east',quantity:100}),r('inventory','new',{warehouseId:'east',quantity:10}),r('fulfillment_rule','sku',{warehouseId:'east',channelId:'shop',leadDays:0,costCents:0})]);
 const result=calculateScenario(s,baseline,'g');assert.equal(result.status,'calculated');assert.equal(result.coverage.status,'partial');assert.deepEqual(result.coverage.unestimatedEntityIds,['new']);assert.equal(result.coverage.unestimatedEndingSellable,10);assert.equal(recommendScenario([result]).scenarioId,null);
 const many=Array.from({length:1200},(_,i)=>r('order','entity-'+i,{quantity:1,amountCents:100,variableCostCents:20,entryType:'paid',orderId:String(i),channelId:'shop'}));
 const limited=calculateScenario({...s,profile:{...s.profile,horizonDays:90},inputs:[...s.inputs,...many]},baseline,'g');assert.equal(limited.status,'insufficient');assert.equal(limited.points.length,0);assert.ok(limited.feasibility.reasons.some(r=>r.includes('十万个')));
});
test('forecast training uses net payment quantity and money; negative refund-only windows are unestimated',()=>{
 const s=state('ecommerce',[r('inventory','sku',{warehouseId:'east',quantity:100}),r('fulfillment_rule','sku',{warehouseId:'east',channelId:'shop',leadDays:0,costCents:0}),r('order','sku',{entryType:'refund',orderId:'paid',channelId:'shop',quantity:7,amountCents:70000,variableCostCents:14000})]);
 const result=calculateScenario(s,baseline,'g');assert.equal(result.totals.fulfilled,6);assert.equal(result.totals.netRevenueCents,60000);
 const refundOnly=calculateScenario({...s,inputs:s.inputs.filter(r=>r.kind!=='order'||r.entryType==='refund')},baseline,'g');assert.equal(refundOnly.status,'insufficient');assert.equal(refundOnly.totals.fulfilled,null);
});
