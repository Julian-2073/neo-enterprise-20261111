import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBusinessState} from '../lib/business-state.ts';
import {diagnosticBasis} from '../lib/business-diagnostics.ts';
import {taskBudget} from '../server/neo-task-plan.ts';
const profile={industry:'ecommerce',timezone:'Asia/Shanghai',name:'测试',region:'杭州',horizonDays:7,objective:'contribution_margin',cashBudgetCents:null,expectedSources:[{sourceId:'erp',kinds:['order','expense','event']}],competitors:[]};
const coverage=['order','expense','event'].map(kind=>({kind,sourceId:'erp',start:'2026-09-01',end:'2026-09-30'}));
const inputs=Array.from({length:65},(_,i)=>({id:'r'+i,sourceId:'erp',recordKey:'r'+i,revision:1,knownAt:'2026-09-30',kind:'order',businessDate:i<30?'2026-09-05':'2026-09-20',entityId:i<30?'a':'b',channelId:'online',customerId:'c'+i,orderId:'o'+i,entryType:'paid',quantity:1,amountCents:100,variableCostCents:20}));
const state=buildBusinessState({businessId:'b',dataNature:'demo',profileVersion:'p',profile,asOf:'2026-09-30',knownAt:'2026-09-30',start:'2026-09-01',end:'2026-09-30'},inputs,coverage);
test('canonical diagnostics use full inputs, split comparable windows, preserve identity and cost missing states',()=>{
 const d=diagnosticBasis(state,null);
 assert.equal(d.recordCount,65);
 assert.equal(d.current.metrics.paidOrders.value,35);
 assert.equal(d.previous.metrics.paidOrders.value,30);
 assert.equal(d.changes.paidOrders.value,5);
 assert.equal(d.contributions.find(r=>r.entityId==='b').metrics.netRevenueCents.value,3500);
 assert.equal(d.current.journey.transitions[0].metric.status,'missing');
 assert.equal(d.stockDeficit.status,'missing');
});
test('complex DECIDE cap requires frozen typed comparison; caller can only lower cap',()=>{
 assert.equal(taskBudget('DECIDE',undefined,{scenarioCount:2}).maxModelCalls,null);
 assert.equal(taskBudget('DECIDE',{maxModelCalls:2},{scenarioCount:2}).maxModelCalls,null);
 assert.equal(taskBudget('DECIDE').maxModelCalls,null);
});

test('unassigned channel expenses remain a separate bucket without copying channel orders',()=>{
 const rows=[{...inputs[0],id:'a',channelId:'a'},{...inputs[0],id:'b',channelId:'b'},{...inputs[0],id:'e',kind:'expense',channelId:null,amountCents:55}];
 const d=diagnosticBasis({...state,inputs:rows},null);
 const missing=d.contributions.find(r=>r.channelId===null);
 assert.equal(missing.metrics.netRevenueCents.value,0);
 assert.equal(missing.metrics.spendCents.value,55);
 assert.equal(d.contributions.reduce((n,r)=>n+r.metrics.netRevenueCents.value,0),200);
});

import {dialogueMemory} from '../server/agent-conversation.ts';
test('rolling memory carries unresolved assumptions and rules beyond 16 turns, with bounded traceable categories',()=>{
 let previous={};
 for(let i=0;i<40;i++)previous={memory:dialogueMemory(previous,{id:'r'+i,snapshot_id:'g',payload:JSON.stringify({question:'topic'+i})},i===0?{businessAssessment:{hypotheses:[{statement:'early assumption'}],confirmations:[{question:'early condition'}],reviewConditions:['cash not confirmed'],context:{versions:[{kind:'enterprise_rule',version:'rule-v1'}]},priorityAction:{action:'early action',status:'proposed',conditions:['cash not confirmed']}}}:null)};
 assert.equal(previous.memory.topics.length,12);
 assert.equal(previous.memory.hypotheses[0].value.statement,'early assumption');
 assert.equal(previous.memory.unfinishedInquiry[0].runId,'r0');
 assert.equal(previous.memory.constraints[0].value,'cash not confirmed');
 assert.equal(previous.memory.ruleReferences[0].value.version,'rule-v1');
 assert.equal(previous.memory.actions[0].value.selectedIsExecuted,false);
});

import {scopedOperatingReviewBasis} from '../server/business-review-basis.ts';
test('turn metrics and diagnostics are recomputed by original calculators for exact SKU/channel/period',()=>{
 const rows=[{...inputs[0],id:'a1',entityId:'a',channelId:'online',businessDate:'2026-09-20',orderId:'o1',amountCents:100},{...inputs[0],id:'a2',entityId:'a',channelId:'online',businessDate:'2026-09-21',orderId:'o2',amountCents:300},{...inputs[0],id:'other',entityId:'b',channelId:'offline',businessDate:'2026-09-21',orderId:'o3',amountCents:900}];
 const full=buildBusinessState({...state,start:state.period.start,end:state.period.end},rows,coverage);
 const g={id:'g',version:'v',state:full,configuration:{},baseline:{status:'insufficient',totals:{},feasibility:{status:'unconfirmed'},limitations:[],assumptions:[]}};
 const scoped=scopedOperatingReviewBasis(g,'model',{entityId:'a',channelId:'online',period:{start:'2026-09-20',end:'2026-09-21'}});
 assert.equal(scoped.metrics.netRevenueCents.value,400);assert.equal(scoped.generalContext.metrics.netRevenueCents.value,1300);
 assert.equal(scoped.diagnostics.current.metrics.netRevenueCents.value,300);assert.equal(scoped.diagnostics.previous.metrics.netRevenueCents.value,100);assert.equal(scoped.diagnostics.changes.netRevenueCents.value,200);
 assert.deepEqual(scoped.metricScope.period,{start:'2026-09-20',end:'2026-09-21'});assert.equal(scoped.diagnostics.scope.entityId,'a');
 assert.deepEqual(scoped.diagnostics.current.metrics.netRevenueCents.evidenceIds,['a2']);
});

import {calculateScenario} from '../lib/business-scenarios.ts';
function supplyGeneration(industry='ecommerce', extra=[],stock=100){
 const kinds=industry==='manufacturing'?['order','expense','inventory','material_inventory','bom','production_capacity']:['order','expense','inventory','fulfillment_rule'];
 const p={...profile,industry,horizonDays:10,cashBudgetCents:0,expectedSources:[{sourceId:'erp',kinds}]};
 const c=kinds.map(kind=>({kind,sourceId:'erp',start:'2026-09-01',end:'2026-10-10'}));
 const base={sourceId:'erp',recordKey:'x',revision:1,knownAt:'2026-09-30',businessDate:'2026-09-30',entityId:'sku-a'};
 const rows=[{...base,id:'sale',kind:'order',channelId:'online',orderId:'o',entryType:'paid',quantity:10,amountCents:1000,variableCostCents:200},{...base,id:'stock',kind:'inventory',warehouseId:'w',quantity:stock},{...base,id:'rule',kind:'fulfillment_rule',channelId:'online',warehouseId:'w',leadDays:0,costCents:0},...extra.map(r=>({...base,...r}))];
 const s=buildBusinessState({businessId:'b',dataNature:'demo',profileVersion:'p',profile:p,asOf:'2026-09-30',knownAt:'2026-09-30',start:'2026-09-21',end:'2026-09-30'},rows,c);
 return {id:'g',version:'v',state:s,configuration:{},baseline:calculateScenario(s,{id:'baseline',name:'base',demandBps:10000,actions:[]},'g')};
}
test('channel scope retains shared SKU warehouse stock and original fulfillment calculation',()=>{
 const g=supplyGeneration();assert.equal(g.baseline.totals.fulfilled,10);
 const scoped=scopedOperatingReviewBasis(g,'model',{entityId:'sku-a',channelId:'online'});
 assert.equal(scoped.constraints.inventory.records[0].quantity,100);
 assert.equal(scoped.baseline.status,'calculated');assert.equal(scoped.baseline.totals.fulfilled,10);assert.equal(scoped.baseline.totals.unmet,0);assert.equal(scoped.diagnostics.stockDeficit.value,0);
});
test('channel forecast cannot claim exclusive shared stock when another channel competes',()=>{
 const g=supplyGeneration('ecommerce',[{id:'other',kind:'order',channelId:'offline',orderId:'other',entryType:'paid',quantity:150,amountCents:15000,variableCostCents:3000}]);
 const scoped=scopedOperatingReviewBasis(g,'model',{entityId:'sku-a',channelId:'online'});
 assert.equal(scoped.metrics.netRevenueCents.value,1000);assert.equal(scoped.constraints.inventory.records[0].quantity,100);
 assert.equal(scoped.baseline.status,'insufficient');assert.equal(scoped.baseline.feasibility.status,'unconfirmed');assert.equal(scoped.baseline.totals.fulfilled,null);assert.equal(scoped.diagnostics.stockDeficit.status,'missing');assert.match(scoped.baseline.limitations.join(' '),/共享/);
});
test('manufacturing scope retains material and work-center dependencies of the selected product',()=>{
 const extra=[{id:'bom',kind:'bom',materialId:'raw',workCenterId:'center',unitsPerProduct:2},{id:'material',kind:'material_inventory',entityId:'raw',warehouseId:'w',quantity:20},{id:'cap',kind:'production_capacity',entityId:'plant',workCenterId:'center',businessDate:'2026-10-01',quantity:10},{id:'production',kind:'production',status:'planned',businessDate:'2026-10-01',quantity:10,warehouseId:'w',workCenterId:'center',leadDays:0,costCents:0}];
 const g=supplyGeneration('manufacturing',extra,0);const scoped=scopedOperatingReviewBasis(g,'model',{entityId:'sku-a',channelId:'online'});
 assert.equal(scoped.constraints.material_inventory.records[0].entityId,'raw');assert.equal(scoped.constraints.production_capacity.records[0].workCenterId,'center');assert.equal(scoped.baseline.status,'calculated');assert.equal(scoped.baseline.totals.fulfilled,10);
 const competing=supplyGeneration('manufacturing',[...extra,{id:'other-production',kind:'production',entityId:'sku-b',status:'planned',businessDate:'2026-10-01',quantity:10,warehouseId:'w',workCenterId:'center',leadDays:0,costCents:0}]);
 assert.equal(scopedOperatingReviewBasis(competing,'model',{entityId:'sku-a'}).baseline.status,'insufficient');
});
