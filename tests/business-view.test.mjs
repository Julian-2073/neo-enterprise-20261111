import assert from 'node:assert/strict';
import test from 'node:test';
import {scopedEvidence} from '../server/scoped-evidence.ts';
import {viewEvidenceId} from '../lib/evidence-refs.ts';
import {channelName,findingPreview,emphasisParts,productName,businessText,inventoryStatus,evidenceLimitations,technicalQuestion} from '../lib/business-presentation.ts';
import {scenarioSummary} from '../lib/scenario-presentation.ts';
import {scenarioBelongsToBaseline} from '../lib/decision-history.ts';
const fact=(id,kind,product,channel,date,extra)=>({id,kind,fact:{product_id:product,channel,business_date:date,...extra}});
const stocks=[fact('s1','inventory','p1',null,'2026-09-24',{sku_id:'a',warehouse_id:'w',sellable_units:2,in_transit_units:3,inventory_cost_cents:1200,safety_units:5}),fact('s2','inventory','p2',null,'2026-09-24',{sku_id:'b',warehouse_id:'w',sellable_units:8,in_transit_units:0,inventory_cost_cents:8000,safety_units:3})];
const env={snapshot:{id:'snap',businessId:'b',dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-09-01',periodEnd:'2026-09-20',limitations:[],data:{inventory:stocks.map(x=>({...x.fact,factId:x.id})),weeks:[{start:'2026-09-01',end:'2026-09-07',events:{A3:9},paidOrders:1,netRevenueCents:1000,spendCents:null}]}},domain:{products:[{id:'p1',name:'家用划船机',roleId:'core'},{id:'p2',name:'配件',roleId:'entry'}],skus:[],roles:[{id:'core',name:'主力品'}],arrivals:[{id:'arrival',skuId:'a',warehouseId:'w',date:'2026-10-06',units:3}]},facts:[...stocks,fact('o1','orders','p1','douyin','2026-09-02',{entry_type:'paid',order_id:'o1',amount_cents:1000}),fact('e1','events','p1','douyin','2026-09-02',{event_type:'inquiry',quantity:9}),fact('o2','orders','p2','douyin','2026-09-02',{entry_type:'paid',amount_cents:500}),fact('o3','orders','p1','tmall','2026-09-10',{entry_type:'paid',amount_cents:2000})]};
test('product evidence reconciles only its stock, plans and cost',()=>{const v=scopedEvidence(env,viewEvidenceId('snap','inventory','p1'));assert.equal(v.evidence.value.inventory_cost_cents,1200);assert.deepEqual(v.factIds,['s1']);assert.equal(v.arrivals.length,1);assert.match(v.evidence.title,/家用划船机/);assert.equal(scopedEvidence(env,viewEvidenceId('snap','inventory','p2')).evidence.value.inventory_cost_cents,8000);assert.throws(()=>scopedEvidence(env,viewEvidenceId('other','inventory','p1')));});
test('channel role evidence excludes another role, another channel and other weeks',()=>{const v=scopedEvidence(env,viewEvidenceId('snap','channel-role','douyin','core'));assert.deepEqual(v.factIds,['e1','o1']);assert.equal(v.evidence.value.events,9);assert.equal(v.evidence.value.netRevenueCents,1000);assert.equal(v.evidence.value.spendCents,null);const week=scopedEvidence(env,viewEvidenceId('snap','week','2026-09-01','A3'));assert.deepEqual(week.factIds,['e1']);assert.equal(week.evidence.value,9);assert.equal(week.evidence.unit,'次');});
test('unknown channel meaning stays unknown; legacy wording is explained without discarding its values',()=>{assert.equal(channelName('content'),'渠道名称待确认');const raw='R1安全线缺口；增长100万元';assert.equal(findingPreview(raw),'R1已设定备货目标缺口；增长100万元');assert.equal(raw,'R1安全线缺口；增长100万元');});
test('business presentation preserves amount, units and uncertainty; emphasis never parses HTML',()=>{
 const raw='**家用划船机（R1）** 预计 430.9 件，净成交额 107.25 万元；价格弹性 -0.5 待验证。';
 assert.match(findingPreview(raw),/预计 430\.9 件，净成交额 107\.25 万元/);assert.match(findingPreview(raw),/尚未验证.*待验证/);assert.equal(emphasisParts(raw).map(x=>x.text).join(''),raw.replaceAll('**',''));
 assert.equal(emphasisParts('**<script>**')[1].text,'<script>');assert.equal(productName('p1',env.domain.products),'家用划船机（p1）');
});
test('stock risk counts warehouse/specification locations, preserves zeros and separates missing targets',()=>{
 const rows=[{sku_id:'same',warehouse_id:'w1',sellable_units:1,safety_units:4},{sku_id:'same',warehouse_id:'w2',sellable_units:2,safety_units:4},{sku_id:'other',warehouse_id:'w2',sellable_units:0,safety_units:null}];
 assert.equal(inventoryStatus(rows),'有1处商品规格无可售库存；有2处商品规格库存偏低，需核对备货目标');
 assert.doesNotMatch(inventoryStatus(rows),/2种|SKU/);assert.match(inventoryStatus([{sellable_units:4}]),/目标待补/);
});
test('typed scenario display explains exact price/budget changes without mutating inputs or confirming effects',()=>{
 const value={adjustments:[{productId:'p1',budgetMultiplier:1,conversionMultiplier:1,priceMultiplier:0.9,priceElasticity:-0.5,assumption:{source:'user_assumption',note:'原条件',confirmed:true}}],extraCostCents:10001};const before=JSON.stringify(value);
 const text=scenarioSummary(value,env.domain.products).join(' ');
 assert.match(text,/家用划船机.*投放不变.*订单需求假设不变.*降价10%/);assert.match(text,/价格提高1%.*需求约减少0.5%.*尚未验证/);assert.match(text,/输入条件已确认，效果仍需验证/);assert.match(text,/100\.01/);assert.doesNotMatch(text,/×|预算响应.*未提供|user_assumption|confirmed/);assert.equal(JSON.stringify(value),before);
 const missing=scenarioSummary({adjustments:[{...value.adjustments[0],budgetMultiplier:1.2,budgetResponse:null,priceMultiplier:1}]});assert.match(missing[0],/投放增加20%.*响应尚未提供/);
});
test('historical model explanation keeps business numbers and uncertainty, raw question remains untouched',()=>{
 const raw='数据性质demo。R1价格倍数0.9与弹性-0.5；净成交额107.25万元，435.7件。来源user_assumption，confirmed=true，不等于已验证。';
 const text=businessText(raw,env.domain.products);assert.match(text,/合成演示数据/);assert.match(text,/降价10%/);assert.match(text,/107\.25万元，435\.7件/);assert.match(text,/不等于已验证/);assert.doesNotMatch(text,/user_assumption|confirmed=true|价格倍数|数据性质demo/);
 assert.equal(businessText('家用划船机（p1）',env.domain.products),'家用划船机（p1）');
 const question='请使用 proposedAssumptions，source=user_assumption，confirmed=true';assert.equal(technicalQuestion(question),true);assert.equal(question,'请使用 proposedAssumptions，source=user_assumption，confirmed=true');assert.equal(technicalQuestion('请核查库存42件'),false);
});
test('agent evidence uses business channel names and readable money labels',()=>{
 const text=businessText('按渠道汇总：sim-douyin spendYuan=13750.0元，sim-tmall spendYuan=10000.0元；同期总投放费用spendYuan=23750.0元',[],[{id:'sim-douyin',name:'抖音模拟店铺'},{id:'sim-tmall',name:'天猫模拟店铺'}]);
 assert.equal(text,'按渠道汇总：抖音模拟店铺投放费用 13750.0 元，天猫模拟店铺投放费用 10000.0 元；同期总投放费用 23750.0 元');
});
test('inventory main notes are local while raw global limitations remain available unchanged',()=>{
 const notes=['库存按仓库和商品/SKU展示。','行为次数、支付订单数与客户人数不同。','退款计入发生日。','覆盖日期未经核实。'];const before=JSON.stringify(notes);
 assert.deepEqual(evidenceLimitations('snap:view:inventory:p1',notes),['库存按仓库和商品规格展示。','覆盖日期未经核实。']);assert.equal(JSON.stringify(notes),before);
 assert.ok(evidenceLimitations('snap:view:channel-role:douyin:core',notes).some(n=>n.includes('退款')));
});
test('product/channel weekly evidence respects refunds, multi-line and source order identity',()=>{
 const copy=structuredClone(env);copy.facts.push(fact('line2','orders','p1','douyin','2026-09-02',{entry_type:'paid',order_id:'o1',amount_cents:200}),fact('refund','orders','p1','douyin','2026-09-02',{entry_type:'refund',order_id:'o1',amount_cents:100}));
 copy.facts.forEach(x=>x.sourceId='source-a');copy.facts.push({...fact('other-source','orders','p1','douyin','2026-09-02',{entry_type:'paid',order_id:'o1',amount_cents:300}),sourceId:'source-b'});
 const id=viewEvidenceId('snap','week','2026-09-01','netRevenueCents','p1','douyin');const v=scopedEvidence(copy,id);
 assert.equal(v.evidence.value,1400);assert.deepEqual(v.factIds,['line2','o1','other-source','refund']);assert.match(v.evidence.scopeLabel,/家用划船机.*抖音/);
 assert.match(v.evidence.scopeLabel,/2026-09-01 至 2026-09-07$/);
 assert.equal(scopedEvidence(copy,viewEvidenceId('snap','week','2026-09-01','paidOrders','p1','douyin')).evidence.value,2);
 assert.equal(scopedEvidence(copy,viewEvidenceId('snap','week','2026-09-01','spendCents','p1','douyin')).evidence.value,null);
 copy.snapshot.productId='p1';assert.throws(()=>scopedEvidence(copy,viewEvidenceId('snap','week','2026-09-01','A3','p2','douyin')));
 assert.throws(()=>scopedEvidence(env,viewEvidenceId('snap','week','2026-09-01','A3','unknown','douyin')));
});
test('historical comparisons require same baseline, enterprise, nature, snapshot and object build',()=>{
 const b={id:'baseline',calculationVersion:'scenario-v1.2',inputHash:'frozen-input',businessId:'a',dataNature:'demo',snapshotId:'old',ontologyRef:{buildId:'v1'}};
 const s={...b,parentId:'baseline'};assert.equal(scenarioBelongsToBaseline(s,b),true);
 for(const change of [{calculationVersion:'old'},{inputHash:'other'},{calculationVersion:null},{inputHash:null},{businessId:'b'},{dataNature:'business'},{snapshotId:'new'},{parentId:'other'},{ontologyRef:{buildId:'v2'}},{ontologyRef:null}])assert.equal(scenarioBelongsToBaseline({...s,...change},b),false);
 assert.equal(scenarioBelongsToBaseline(s,null),false);
});
