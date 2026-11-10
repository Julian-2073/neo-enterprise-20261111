import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildBusinessState} from '../lib/business-state.ts';
import {calculateScenario} from '../lib/business-scenarios.ts';
import {operatingReviewBasis} from '../server/business-review-basis.ts';
export const businesses=JSON.parse(await readFile(new URL('../tests/fixtures/frozen-businesses.json',import.meta.url)));
export async function frozenCases(){const bytes=await readFile(new URL('../tests/fixtures/frozen-cases.json',import.meta.url));const receipt=JSON.parse(await readFile(new URL('../tests/fixtures/frozen-cases.sha256.json',import.meta.url)));const digest=createHash('sha256').update(bytes).digest('hex');if(digest!==receipt.sha256)throw Error('Frozen expectation digest changed');const data=JSON.parse(bytes);if(data.cases.length!==60)throw Error('Expected exactly 60 frozen cases');return {data,digest};}
/** Independent structured inputs. No expected answer text enters the fixture or model. */
export function caseFixture(c,index){
 const config=businesses.find((b,i)=>b.industry===(c.industry??'ecommerce')&&i%2===index%2)??businesses[0],day=c.id==='manufacturing-late_arrival'?'2026-10-01':'2026-09-30',next=c.id==='manufacturing-late_arrival'?'2026-10-02':'2026-10-01',revenue=config.industry==='hotel'?'hotel_stay':'order';
 let start=c.category==='conversation'?'2026-08-01':day;const records=[];let serial=0;
 const row=(kind,fields={},date=day)=>records.push({id:`${c.id}-record-${serial}`,recordKey:`row-${serial++}`,sourceId:'fixture-erp',revision:1,knownAt:'2026-10-08T00:00:00Z',businessDate:date,entityId:config.entityId,channelId:config.channelId,kind,...fields});
 const paid=(quantity=20,amountCents=200000,variableCostCents=100000)=>row(revenue,{quantity,amountCents,variableCostCents,entryType:'paid',orderId:'paid-1'});
 const expense=(amountCents=10000)=>row('expense',{amountCents});
 const stock=(quantity=100,warehouseId='east',extra={})=>row('inventory',{quantity,warehouseId,inventoryCostCents:quantity*1000,...extra});
 const material=(quantity=12,extra={})=>row('material_inventory',{entityId:'M',quantity,warehouseId:'east',...extra});
 const bom=(unitsPerProduct=2)=>row('bom',{materialId:'M',unitsPerProduct,workCenterId:'line'});
 const capacity=(quantity=30)=>row('production_capacity',{quantity,workCenterId:'line'},next);
 const id=c.id.split('-').slice(1).join('-');
 // Specific fixture facts are independent of expected/critical text and anchor values.
 switch(id){
 case 'refund_margin':paid(100,10000000,7000000);row('order',{quantity:20,amountCents:2000000,variableCostCents:0,entryType:'refund',orderId:'refund-1'});expense(600000);stock(10);break;
 case 'journey_identity':paid(100,1000000,400000);expense();for(const [stage,quantity] of [['A1',1000],['A2',600],['A3',200]])row('event',{stage,quantity});stock();break;
 case 'journey_conversion':start='2026-09-01';for(let i=0;i<100;i++){row('event',{stage:'A3',quantity:1,customerId:'current-'+i},'2026-09-16');row('event',{stage:'A3',quantity:1,customerId:'prior-'+i},'2026-09-01');if(i<40)row('order',{quantity:1,amountCents:10000,variableCostCents:5000,entryType:'paid',orderId:'current-'+i,customerId:'current-'+i},'2026-09-17');if(i<50)row('order',{quantity:1,amountCents:10000,variableCostCents:5000,entryType:'paid',orderId:'prior-'+i,customerId:'prior-'+i},'2026-09-02');}expense();stock();break;
 case 'warehouse_zero':paid();expense();stock(0);stock(100,'west');break;
 case 'arrival_plan':paid();expense();stock(10);row('arrival',{quantity:80,warehouseId:'east',status:'planned'},'2026-10-07');break;
 case 'spend_growth':start='2026-08-06';for(let i=0;i<100;i++){row('order',{quantity:1,amountCents:10000,variableCostCents:4000,entryType:'paid',orderId:'old-'+i},'2026-08-07');row('order',{quantity:1,amountCents:10000,variableCostCents:4000,entryType:'paid',orderId:'new-'+i},'2026-09-20');}expense(1000000);records.at(-1).businessDate='2026-08-07';expense(1200000);stock();break;
 case 'objective_unconfirmed':paid(10,1000000,500000);expense(0);stock(100);row('fulfillment_rule',{warehouseId:'east',leadDays:0,costCents:0});break;
 case 'stock_forecast':paid(50,500000,250000);expense(0);stock(30);row('fulfillment_rule',{warehouseId:'east',leadDays:0,costCents:0});break;
 case 'roomnight_capacity':paid(10);expense();row('hotel_capacity',{quantity:20},next);row('hotel_reservation',{quantity:18,status:'planned'},next);break;
 case 'date_nonfungible':paid();expense();row('hotel_capacity',{quantity:0},next);row('hotel_capacity',{quantity:20},'2026-10-05');row('hotel_reservation',{quantity:0,status:'planned'},next);break;
 case 'cancel_not_stay':paid(12);expense();row('hotel_reservation',{quantity:20,status:'planned'},next);row('hotel_reservation',{quantity:5,status:'cancelled'},next);row('hotel_capacity',{quantity:20},next);break;
 case 'hotel_margin':paid(12,1000000,400000);expense(100000);expense(50000);row('hotel_capacity',{quantity:20},next);row('hotel_reservation',{quantity:0,status:'planned'},next);break;
 case 'channel_hotel':paid(1,50000,0);records.at(-1).channelId='ota';expense(8000);records.at(-1).channelId='ota';paid(1,55000,0);records.at(-1).channelId='direct';records.at(-1).orderId='direct';expense(15000);records.at(-1).channelId='direct';break;
 case 'refund_hotel':paid();row('hotel_stay',{quantity:0,amountCents:100000,variableCostCents:0,entryType:'refund',orderId:'refund'});expense();break;
 case 'checkin_limit':paid(10);expense();row('hotel_capacity',{quantity:20},next);row('hotel_reservation',{quantity:18,status:'planned'},next);row('hotel_service_capacity',{quantity:8,workCenterId:'cleaning'},next);row('hotel_service_capacity',{quantity:12,workCenterId:'front_desk'},next);break;
 case 'late_arrival':paid(10);expense(0);stock(0);material(0);bom();capacity();row('production',{quantity:10,status:'planned',warehouseId:'east',workCenterId:'line',leadDays:0,costCents:0},next);row('arrival',{entityId:'M',quantity:20,warehouseId:'east',status:'planned'},'2026-10-03');break;
 case 'multi_warehouse_material':paid(10);expense(0);stock(0,'west');material(20);bom();capacity();row('production',{quantity:10,status:'planned',warehouseId:'west',workCenterId:'line',leadDays:0,costCents:0},next);row('arrival',{entityId:'M',quantity:20,warehouseId:'west',fromWarehouseId:'east',status:'planned',leadDays:2},'2026-10-02');break;
 case 'bom_shortage':paid(10);expense(0);stock(0);material(12);bom();capacity(30);row('production',{quantity:10,status:'planned',warehouseId:'east',workCenterId:'line',leadDays:0,costCents:0},next);break;
 case 'capacity_constraint':paid(100);expense(0);stock(0);material(200);bom();capacity(30);row('production',{quantity:100,status:'planned',warehouseId:'east',workCenterId:'line',leadDays:0,costCents:0},next);break;
 case 'wip_not_finished':paid();expense();stock(5);row('production',{quantity:50,status:'planned',warehouseId:'east',workCenterId:'line',leadDays:3,costCents:0},next);break;
 case 'manufacturing_margin':paid(10,2000000,1400000);expense(100000);stock();break;
 case 'quality_hold':paid();expense();stock(0);material(100,{inspectionUnits:60,reservedUnits:20});bom();capacity();break;
 case 'batch_loss':paid(10);expense(0);stock(0);material(20);bom();capacity();break;
 case 'production_cancel':paid();expense();stock(10);row('production',{quantity:50,status:'cancelled',warehouseId:'east',workCenterId:'line',leadDays:0,costCents:0},next);break;
 default:paid();expense();if(config.industry==='hotel'){if(id!=='capacity_missing')row('hotel_capacity',{quantity:20},next);row('hotel_reservation',{quantity:0,status:'planned'},next);}else {stock();if(config.industry==='manufacturing'){material();if(id!=='bom_missing')bom();capacity();}}
 }
 if(c.category==='conversation'){paid(3,30000,18000);records.at(-1).entityId='SKU-S2';records.at(-1).orderId='paid-S2';stock(9);records.at(-1).entityId='SKU-S2';}
 if(config.industry==='ecommerce'&&!['warehouse_zero','stock_forecast'].includes(id))row('fulfillment_rule',{warehouseId:'east',leadDays:0,costCents:0});
 const kinds=[...new Set(records.map(r=>r.kind))],expectedKinds=[...kinds];if(id==='capacity_missing')expectedKinds.push('hotel_capacity');if(id==='bom_missing')expectedKinds.push('bom');
 if(id==='missing_feed')expectedKinds.push('expense');
 const profile={industry:config.industry,name:config.businessId,region:'杭州',timezone:'Asia/Shanghai',horizonDays:['late_arrival','multi_warehouse_material','checkin_limit'].includes(id)?1:config.horizonDays,objective:'contribution_margin',cashBudgetCents:id==='objective_unconfirmed'?null:config.cashBudgetCents,competitors:[],expectedSources:[{sourceId:'fixture-erp',kinds:expectedKinds},...(id==='missing_feed'?[{sourceId:'refund-feed',kinds:['order']}]:[])]};
 const coverage=kinds.filter(k=>id!=='missing_feed'||k!=='expense').map(kind=>({kind,sourceId:'fixture-erp',start,end:['hotel_capacity','hotel_reservation','hotel_service_capacity','production_capacity'].includes(kind)?'2026-10-07':day}));
 const state=buildBusinessState({businessId:config.businessId,dataNature:'demo',profileVersion:'frozen-fixture-v1',profile,asOf:day,knownAt:'2026-10-08T00:00:00Z',start,end:day},records,coverage),generation={id:'fixture-'+c.id,version:'frozen-fixture-v1',state,baseline:calculateScenario(state,{id:'baseline',name:'维持当前已登记条件',demandBps:10000,actions:[]}),configuration:{id:'fixture-config',...(id==='journey_conversion'?{settings:{customerFunnel:{cohortStage:'A3',conversionWindowDays:2,channelPolicy:'same_channel'}}}:{})}};
 const basis=operatingReviewBasis(generation,'offline-calculation-transport-only');basis.interaction={question:c.context,role:'joint'};
 const observed={};const m=state.metrics;const byKind=k=>records.filter(r=>r.kind===k);const sum=(rs,f)=>rs.reduce((a,r)=>a+(r[f]??0),0);
 if(['refund_margin','hotel_margin','manufacturing_margin'].includes(id)){observed.marginYuan=m.contributionMarginCents.value/100;if(id==='refund_margin')observed.netRevenueYuan=m.netRevenueCents.value/100;}
 if(id==='journey_conversion'){observed.currentRate=basis.diagnostics.current.journey.transitions[2].metric.value;observed.previousRate=basis.diagnostics.previous.journey.transitions[2].metric.value;}
 if(id==='objective_unconfirmed'){observed.marginA=generation.baseline.totals.contributionMarginCents/100;observed.marginB=calculateScenario(state,{id:'B',name:'需求条件B',demandBps:12000,actions:[]}).totals.contributionMarginCents/100;}
 if(id==='warehouse_zero'){observed.eastSellable=sum(byKind('inventory').filter(r=>r.warehouseId==='east'),'quantity');observed.westSellable=sum(byKind('inventory').filter(r=>r.warehouseId==='west'),'quantity');}
 if(id==='arrival_plan')observed.sellable=m.sellableUnits.value;
 if(id==='stock_forecast')Object.assign(observed,{demand:generation.baseline.totals.requested,fulfilled:generation.baseline.totals.fulfilled,unmet:generation.baseline.totals.unmet});
 if(id==='roomnight_capacity'){observed.capacity=sum(byKind('hotel_capacity'),'quantity');observed.reserved=sum(byKind('hotel_reservation'),'quantity');observed.remaining=observed.capacity-observed.reserved;}
 if(id==='date_nonfungible')Object.assign(observed,{fridayAvailable:byKind('hotel_capacity')[0].quantity,mondayAvailable:byKind('hotel_capacity')[1].quantity});
 if(id==='cancel_not_stay')Object.assign(observed,{reservations:sum(byKind('hotel_reservation').filter(r=>r.status==='planned'),'quantity'),cancellations:sum(byKind('hotel_reservation').filter(r=>r.status==='cancelled'),'quantity'),stays:m.fulfilledUnits.value});
 if(id==='channel_hotel'){const value=channel=>sum(records.filter(r=>r.kind==='hotel_stay'&&r.channelId===channel),'amountCents')-sum(records.filter(r=>r.kind==='expense'&&r.channelId===channel),'amountCents');Object.assign(observed,{otaAfterAcquisition:value('ota')/100,directAfterAcquisition:value('direct')/100});}
 if(id==='refund_hotel')observed.refundYuan=sum(byKind('hotel_stay').filter(r=>r.entryType==='refund'),'amountCents')/100;
 if(id==='bom_shortage')Object.assign(observed,{materialUnits:byKind('material_inventory')[0].quantity,unitsPerProduct:byKind('bom')[0].unitsPerProduct,materialFeasible:Math.floor(byKind('material_inventory')[0].quantity/byKind('bom')[0].unitsPerProduct)});
 if(id==='capacity_constraint')Object.assign(observed,{materialFeasible:Math.floor(byKind('material_inventory')[0].quantity/byKind('bom')[0].unitsPerProduct),capacityFeasible:byKind('production_capacity')[0].quantity});
 if(id==='wip_not_finished')Object.assign(observed,{finishedSellable:m.sellableUnits.value,wip:byKind('production')[0].quantity});
 if(id==='quality_hold'){const r=byKind('material_inventory')[0];observed.usableMaterial=r.quantity-r.reservedUnits-r.inspectionUnits;}
 if(id==='batch_loss')observed.nominalUpperBound=Math.floor(byKind('material_inventory')[0].quantity/byKind('bom')[0].unitsPerProduct);
 if(id==='production_cancel')observed.completed=m.sellableUnits.value;
 if(id==='spend_growth'){const d=basis.diagnostics;observed.previousCostPerOrder=d.previous.metrics.spendCents.value/d.previous.metrics.paidOrders.value/100;observed.currentCostPerOrder=d.current.metrics.spendCents.value/d.current.metrics.paidOrders.value/100;}
 // Structured deterministic scenario oracles. Response/causal/policy quality still requires independent review.
 const oracles={};
 if(id==='journey_identity')oracles.unlinked_counts_not_customers=state.metrics.A1Customers.value===null&&records.filter(r=>r.stage==='A1').reduce((s,r)=>s+r.quantity,0)===1000;
 if(id==='missing_feed')oracles.incomplete_financials_not_zero=state.metrics.netRevenueCents.value===null&&state.metrics.contributionMarginCents.value===null;
 if(id==='capacity_missing')oracles.absent_capacity_blocks_forecast=generation.baseline.status==='insufficient';
 if(id==='bom_missing')oracles.bom_absent_is_unresolved=!records.some(r=>r.kind==='bom')&&basis.constraints.bom.recordCount===0;
 if(id==='checkin_limit')oracles.service_limit_not_room_limit=generation.baseline.totals.fulfilled===8&&records.find(r=>r.kind==='hotel_capacity').quantity===20;
 if(id==='late_arrival')oracles.material_after_delivery_unusable=generation.baseline.totals.fulfilled===0&&records.find(r=>r.kind==='arrival').businessDate>next;
 if(id==='multi_warehouse_material')oracles.transfer_not_arrived_at_workcenter=generation.baseline.totals.fulfilled===0&&records.find(r=>r.kind==='arrival').leadDays===2;
 const scenarios=['scenario_hold','hotel_scenario','objective_unconfirmed'].includes(id)?['A','B'].map((label,i)=>{const parameters={id:c.id+'-scenario-'+label,name:'方案'+label,demandBps:id==='hotel_scenario'?10000:i?12000:10000,actions:[],...(id==='hotel_scenario'&&i?{priceBps:12000}:{}),...(id==='objective_unconfirmed'&&i?{capitalRequirementCents:5000000}:{})};return {id:parameters.id,title:parameters.name,name:parameters.name,baselineId:generation.id,parameters,result:calculateScenario(state,parameters,generation.id),executionStatus:'not_executed'};}):[];
 if(id==='objective_unconfirmed'){scenarios[1].capitalRequirementCents=5000000;oracles.cash_constraint_unconfirmed=profile.cashBudgetCents===null&&scenarios[1].capitalRequirementCents===5000000;}
 if(id==='competitor_uncomparable'){basis.researchContext={kind:'synthetic_fixture_observation',model:'X',advertisedRanking:'第一',comparableSpecification:null,netPriceCents:null,discountConditions:null,sourceReadability:'not_external_verified'};oracles.comparable_price_unavailable=basis.researchContext.netPriceCents===null&&basis.researchContext.comparableSpecification===null;}
 if(id==='policy_region'){basis.researchContext={kind:'synthetic_policy_metadata',region:'上海',subject:'小微酒店补贴',enterpriseRegion:profile.region,enterpriseApplicability:'not_applicable_region',benefitCents:null,externalVerification:'pending'};oracles.region_mismatch_not_guaranteed_benefit=basis.researchContext.region!==profile.region&&basis.researchContext.benefitCents===null;}
 if(id==='hotel_scenario'){scenarios[1].priceAssumption={priceBps:12000,confirmed:false,elasticity:null,executionStatus:'not_executed'};oracles.unvalidated_price_is_assumption=scenarios[1].priceAssumption.elasticity===null&&!scenarios[1].priceAssumption.confirmed&&scenarios[1].result.totals.netRevenueCents>scenarios[0].result.totals.netRevenueCents&&scenarios[1].result.feasibility.status==='unconfirmed';}
 if(scenarios.length){basis.scenarioContext={generationId:generation.id,scenarios,results:scenarios.map(s=>s.result)};const fullRecords=scenarios.map(s=>({id:s.id,kind:'scenario',businessId:config.businessId,dataNature:'demo',generationId:generation.id,parameters:s.parameters,results:[s.result],executionStatus:'not_executed',createdAt:'2026-10-08T00:00:00Z'}));basis.savedRecords={businessId:config.businessId,dataNature:'demo',generationId:generation.id,records:fullRecords,fullRecords,truncated:false,registryHash:createHash('sha256').update(JSON.stringify(fullRecords)).digest('hex')};}
 return {config,generation,basis,observed,oracles,scenarios,fixtureComplete:(Object.keys(c.numericAnchors??{}).length>0&&Object.keys(c.numericAnchors??{}).every(k=>Object.hasOwn(observed,k)))||Object.keys(oracles).length>0,job:{id:'frozen-'+c.id,businessId:config.businessId,dataNature:'demo',snapshotId:generation.id,sessionId:'session-'+c.id,mode:'joint',purpose:'operating',question:c.context,envelope:{snapshot:{id:generation.id,businessId:config.businessId,dataNature:'demo',asOf:day},operatingBasis:basis,runtimeScope:{businessId:config.businessId,dataNature:'demo',inputId:generation.id,asOf:day,researchAsOf:'2026-10-08'}},budget:{maxMarketSearches:0}}};
}

/** New source observation creates a distinct immutable generation and recomputes all metrics. */
export function conversationGenerationV2(f){
 const g=structuredClone(f.generation),record=structuredClone(g.state.inputs.find(r=>r.kind==='order'));
 record.id+='-new-observation';record.recordKey+='-new-observation';record.orderId+='-new-observation';record.amountCents=70000;record.quantity=7;record.variableCostCents=35000;record.knownAt='2026-10-08T01:00:00Z';g.id+='-v2';g.version='frozen-fixture-v2';
 g.state=buildBusinessState({...g.state,profileVersion:'frozen-fixture-v2',knownAt:record.knownAt,start:g.state.period.start,end:g.state.period.end},[...g.state.inputs,record],g.state.coverage);
 g.baseline=calculateScenario(g.state,{id:'baseline',name:'新增观测后的基线',demandBps:10000,actions:[]},g.id);return g;
}
