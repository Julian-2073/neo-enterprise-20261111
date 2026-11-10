import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionWorkbench} from '../server/decision-workbench.ts';
import {decisionPlan} from '../server/decision-plan.ts';
const scope={businessId:'tenant-a',dataNature:'demo',snapshotId:'saved'};
const snapshot={...scope,id:'saved',asOf:'2026-09-24',coverage:[{sourceId:'orders',kind:'orders',start:'2026-09-14',end:'2026-09-20'}],data:{inventory:[{sku_id:'SKU-A',warehouse_id:'warehouse-a'}],weeks:[{start:'2026-09-14',end:'2026-09-20'}]}};
const totals={units:35,unmetUnits:20,netRevenueCents:8245337,spendCents:100,variableCostCents:20,contributionMarginCents:-29662,endingInventoryCostCents:10};
const baseline={...scope,id:'f',inputHash:'frozen',calculationVersion:'v1',totals,forecastCoverage:{status:'complete_for_observed_sales'}};
const scenario={...baseline,id:'s',parentId:'f'};
const block={title:'真实保存的判断',summary:'当前资料上的经营分析',evidenceIds:['e']};
const home={basis:{forecast:baseline},run:{status:'completed',result:{finding:{gaps:['缺少到货确认']}}},decision:{judgment:block,action:{...block,steps:['核对到货']}}};
const sections={people:{review:block},goods:{metrics:{sellableUnits:40}},market:{judgment:block,sources:[]}};
const domain={products:[],skus:[],arrivals:[{id:'old',date:'2026-09-23',skuId:'SKU-A',warehouseId:'warehouse-a',units:3},{id:'future',date:'2026-09-26',skuId:'SKU-A',warehouseId:'warehouse-a',units:5},{id:'unrelated',date:'2026-09-26',skuId:'SKU-B',warehouseId:'warehouse-a',units:5}],facts:[{kind:'orders',fact:{business_date:'2026-09-18',entry_type:'paid',quantity:6}},{kind:'orders',fact:{business_date:'2026-09-18',entry_type:'refund',quantity:1}}]};
test('projection shares canonical section results and filters exact input, build and baseline identities',()=>{
 const choices=[scenario,{...scenario,id:'other-tenant',businessId:'tenant-b'},{...scenario,id:'other-build',ontologyRef:{buildId:'different'}},{...scenario,id:'other-input',inputHash:'new'},{...scenario,id:'other-base',parentId:'other'}];
 const r=decisionWorkbench(snapshot,sections,home,[{...baseline,id:'foreign',businessId:'b'},baseline],choices,[{id:'decision',selectedScenario:scenario}],domain);
 assert.equal(r.sections,sections);assert.equal(r.joint.summary,block.summary);assert.equal(r.baseline.id,'f');assert.deepEqual(r.scenarios.map(x=>x.id),['s']);assert.equal(r.history[0].units,6);assert.deepEqual(r.arrivals.map(x=>x.id),['future']);assert.equal(r.draft.stage,'recorded');assert.equal(r.draft.steps[0],'核对到货');
 const missing=decisionWorkbench(snapshot,sections,home,[baseline],choices,[],domain,'foreign');assert.equal(missing.baseline,null);assert.equal(missing.scenarios.length,0);assert.ok(missing.notice);assert.equal(missing.recommendation,null);
});
test('missing coverage and unknown quantities stay unknown; observed zero is preserved',()=>{
 assert.equal(decisionWorkbench({...snapshot,coverage:[]},sections,home,[baseline],[],[],domain).history[0].units,null);
 assert.equal(decisionWorkbench(snapshot,sections,home,[baseline],[],[],{...domain,facts:[]}).history[0].units,0);
 assert.equal(decisionWorkbench(snapshot,sections,home,[baseline],[],[],{...domain,facts:[{kind:'orders',fact:{business_date:'2026-09-18',entry_type:'paid'}}]}).history[0].units,null);
});
test('decision plan validation stores optional observation metadata, rejects impossible dates and oversized content',()=>{
 const plan={owner:'采购核查',dueDate:'2026-10-08',observationMetrics:['销量'],steps:['核实到货']};assert.deepEqual(decisionPlan(plan),plan);assert.equal(decisionPlan(null),null);
 for(const dueDate of ['2026-02-30','2026-99-01','yesterday'])assert.throws(()=>decisionPlan({...plan,dueDate}),e=>e.status===422);
 assert.throws(()=>decisionPlan({...plan,steps:Array(21).fill('step')}));assert.throws(()=>decisionPlan({...plan,owner:' '.repeat(2)}));
});

test('joint metrics come from canonical calculations; partial runs and unknown costs cannot supply a ready judgment',()=>{
 const review={status:block,metricKeys:['stock','margin','conversion'],market:{summary:'原文线索待确认',evidenceIds:['market-original']},confirmations:[{question:'核对收货',why:'改变选择',check:'收货记录',evidenceIds:['arrival-proof']}],nextAction:{...block,whyFirst:'减少决策不确定性',decisionGate:'收货后再比方案',steps:['核对']},alternatives:[{action:'投放',whyNotFirst:'供给待确认'}]};
 const input={...home,decision:{...home.decision,jointReview:review}};
 const section={...sections,people:{...sections.people,metrics:{conversionRate:.667},evidenceId:'customer-proof'},goods:{...sections.goods,evidenceId:'stock-proof'}};
 const r=decisionWorkbench(snapshot,section,input,[],[],[],domain);
 assert.equal(r.joint.review,review);assert.deepEqual(r.joint.metrics.map(m=>[m.key,m.value]),[['stock',40],['conversion',.667]]);assert.ok(r.joint.evidenceIds.includes('arrival-proof'));assert.ok(r.joint.evidenceIds.includes('market-original'));
 const pending=decisionWorkbench(snapshot,section,{...input,run:{status:'running'}},[],[],[],domain);assert.equal(pending.joint.review,null);assert.deepEqual(pending.joint.metrics,[]);
});
