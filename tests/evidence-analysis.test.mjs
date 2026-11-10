import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeEvidence,analyzeForecast,financialWindow} from '../server/evidence-analysis.ts';
import {scopedEvidence} from '../server/scoped-evidence.ts';
import {chartEvidenceId} from '../lib/chart-evidence.ts';
const s={id:'snap',businessId:'a',dataNature:'demo',periodStart:'2026-09-07',periodEnd:'2026-09-20',asOf:'2026-09-24',productId:null,channel:null,coverage:['events','orders','expenses'].map(kind=>({kind,sourceId:kind,start:'2026-09-07',end:'2026-09-24'})),limitations:[],domain:{roles:[{id:'core',name:'主力品'}]},data:{inventory:[],weeks:[{start:'2026-09-07',end:'2026-09-13'},{start:'2026-09-14',end:'2026-09-20'}],materials:{supply:{roles:[{roleId:'core',weekly:[{start:'2026-09-07',qualifiedRatio:1,qualifiedSkuCount:2,observedSkuCount:2},{start:'2026-09-14',qualifiedRatio:.5,qualifiedSkuCount:1,observedSkuCount:2}]}],limitations:['规则必须确认。']}}}};
const row=(id,date,extra={})=>({id,sourceId:'orders',kind:'orders',fact:{business_date:date,occurred_at:date+'T00:00:00Z',product_id:'p',channel:'dy',order_id:id,entry_type:'paid',amount_cents:10000,variable_cost_cents:5000,quantity:2,...extra}});
const env=(snapshot,facts)=>({snapshot,facts,domain:{products:[],roles:[],skus:[],arrivals:[]}});
test('weekly order units and value are computed for the clicked scope, refund and adjacent comparison',()=>{
 const facts=[row('old','2026-09-08'),row('new','2026-09-15'),row('refund','2026-09-16',{entry_type:'refund',quantity:1,amount_cents:3000}),row('foreign','2026-09-15',{product_id:'q'})];
 const e=scopedEvidence(env(s,facts),'snap:view:week:2026-09-14:netRevenueCents:p:dy');assert.equal(e.evidence.value,7000);assert.deepEqual(e.factIds,['new','old','refund']);
 const a=analyzeEvidence(s,e.evidence,facts);assert.equal(a.metrics[0].previous,10000);assert.match(a.judgment.title,/减少/);assert.match(a.comparisonPeriod,/09-07/);
 assert.equal(scopedEvidence(env(s,facts),'snap:view:week:2026-09-14:paidUnits:p:dy').evidence.value,2);
 const next=financialWindow(s,[...facts,row('later','2026-09-17')],'2026-09-14','2026-09-20','p','dy');assert.equal(next.paidUnits,4);assert.equal(next.netRevenueCents,17000);assert.equal(e.evidence.value,7000);
});
test('inventory analyzes only the selected product/warehouse; arrivals never become available stock',()=>{
 const snap=structuredClone(s);snap.data.inventory=[{evidenceId:'snap:stock-a',product_id:'p',sellable_units:0,in_transit_units:50,safety_units:10,inventory_cost_cents:0},{evidenceId:'snap:stock-b',product_id:'q',sellable_units:100,in_transit_units:0,safety_units:5,inventory_cost_cents:900000}];
 const a=analyzeEvidence(snap,{id:'snap:stock-a',value:{},limitations:[]},[]);assert.match(a.judgment.title,/没有可售/);assert.equal(a.metrics[0].value,0);assert.equal(a.metrics[1].value,50);assert.equal(a.metrics[3].value,0);
});
test('saved supply graph diagnoses the selected week and does not use newer inventories',()=>{
 const facts=[{id:'old',kind:'inventory',fact:{occurred_at:'2026-09-13',business_date:'2026-09-13',sku_id:'sku',warehouse_id:'wh',sellable_units:10}},{id:'future',kind:'inventory',fact:{occurred_at:'2026-09-24',business_date:'2026-09-24',sku_id:'sku',warehouse_id:'wh',sellable_units:0}}];
 const e=scopedEvidence(env(s,facts),'snap:view:supply-pulse:2026-09-14');assert.deepEqual(e.factIds,['old']);const a=analyzeEvidence(s,e.evidence,facts);assert.equal(a.metrics[0].value,.5);assert.equal(a.metrics[0].previous,1);assert.match(a.judgment.title,/下降/);
 const missing=structuredClone(s);missing.data.materials.supply.roles[0].weekly[1].qualifiedRatio=null;assert.match(analyzeEvidence(missing,e.evidence,[]).judgment.title,/不足/);
});
test('forecast diagnostics use the saved selected result and preserve null margin',()=>{
 const f={weeks:[{start:'2026-09-25',end:'2026-10-01',units:5,unmetUnits:0,netRevenueCents:10000,contributionMarginCents:500,endingUnits:10},{start:'2026-10-02',end:'2026-10-08',units:2,unmetUnits:4,netRevenueCents:5000,contributionMarginCents:null,endingUnits:0}],limitations:['条件推演。']};
 const a=analyzeForecast(f,'2026-10-02');assert.match(a.judgment.title,/限制/);assert.equal(a.metrics[0].previous,5);assert.equal(a.metrics[3].value,null);assert.match(a.observations.join(' '),/不是实际/);
 const forecasts={baseline:{id:'base',weeks:f.weeks},scenario:{id:'scenario',weeks:f.weeks}};
 assert.equal(chartEvidenceId(s,'历史支付出库与未来四周 · 件','scenario',3,2,forecasts),'snap:view:forecast-week:scenario:2026-10-02');assert.equal(chartEvidenceId(s,'历史支付出库与未来四周 · 件','baseline',1,2,forecasts),'snap:view:week:2026-09-14:paidUnits');assert.equal(chartEvidenceId(s,'三类供给达标率','core',1),'snap:view:supply-pulse:2026-09-14');assert.equal(chartEvidenceId(s,'历史支付出库与未来四周 · 件','baseline',8,2,forecasts),null);
});
