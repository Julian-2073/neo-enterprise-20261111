import type {BusinessState,FrozenInput} from './business-state.ts';
import type {SalesForecast} from './business-forecast.ts';
import {completeCoverage,integerSum,plusDays} from './business-metrics.ts';
export const SCENARIO_VERSION='constrained-operating-v1.6';
export type ScenarioAction={kind:'arrival'|'transfer'|'production'|'hotel_capacity';entityId:string;date:string;quantity:number;warehouseId?:string;fromWarehouseId?:string;workCenterId?:string;leadDays:number;costCents:number;confirmed:boolean};
export type ScenarioSpec={id:string;name:string;demandBps:number;priceBps?:number;capitalRequirementCents?:number;actions:ScenarioAction[]};
export type ForecastPoint={date:string;entityId:string;channelId:string|null;requested:number;fulfilled:number;unmet:number;revenueCents:number;variableCostCents:number;evidenceIds:string[]};
export type ScenarioResult={version:string;id:string;name:string;inputGeneration:string|null;status:'calculated'|'insufficient';coverage?:{status:'partial'|'complete_for_observed_sales';forecastedEntityIds:string[];unestimatedEntityIds:string[];unestimatedEndingSellable:number;salesTotalsScope:string};unit:string;points:ForecastPoint[];totals:{requested:number|null;fulfilled:number|null;unmet:number|null;netRevenueCents:number|null;variableCostCents:number|null;spendCents:number|null;actionCostCents:number;contributionMarginCents:number|null;endingSellable:number|null};feasibility:{status:'feasible'|'infeasible'|'unconfirmed';reasons:string[]};limitations:string[];assumptions:string[];};
export function validateScenario(value:unknown):ScenarioSpec{
 if(!value||typeof value!=='object')throw Error('需要方案');const s=value as ScenarioSpec;
 if(typeof s.id!=='string'||!s.id||s.id.length>100||typeof s.name!=='string'||!s.name||s.name.length>100||!Number.isSafeInteger(s.demandBps)||s.demandBps<0||s.demandBps>20000||!Array.isArray(s.actions)||s.actions.length>100)throw Error('方案标识、需求条件或动作无效');
 if(s.priceBps!==undefined&&(!Number.isSafeInteger(s.priceBps)||s.priceBps<5000||s.priceBps>20000)||s.capitalRequirementCents!==undefined&&(!Number.isSafeInteger(s.capitalRequirementCents)||s.capitalRequirementCents<0))throw Error('价格条件或现金需求无效');
 for(const a of s.actions){if(!a||!['arrival','transfer','production','hotel_capacity'].includes(a.kind)||typeof a.entityId!=='string'||!a.entityId||typeof a.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!Number.isFinite(Date.parse(a.date+'T00:00:00Z'))||plusDays(a.date,0)!==a.date||!Number.isSafeInteger(a.quantity)||a.quantity<0||!Number.isSafeInteger(a.leadDays)||a.leadDays<0||a.leadDays>90||!Number.isSafeInteger(a.costCents)||a.costCents<0||typeof a.confirmed!=='boolean')throw Error('方案动作无效');
  if(a.kind!=='hotel_capacity'&&(!a.warehouseId||typeof a.warehouseId!=='string'))throw Error('动作需要仓库');if(a.kind==='transfer'&&(!a.fromWarehouseId||a.fromWarehouseId===a.warehouseId))throw Error('调拨需要不同的来源仓库');if(a.kind==='production'&&!a.workCenterId)throw Error('生产需要工作中心');}
 return {id:s.id,name:s.name,demandBps:s.demandBps,...(s.priceBps!==undefined?{priceBps:s.priceBps}:{}),...(s.capitalRequirementCents!==undefined?{capitalRequirementCents:s.capitalRequirementCents}:{}),actions:s.actions.map(a=>({...a}))};
}
const key=(...parts:unknown[])=>JSON.stringify(parts);
function latest(rows:FrozenInput[],kind:string,asOf:string){const m=new Map<string,FrozenInput>();for(const r of rows.filter(r=>r.kind===kind&&r.businessDate<=asOf).sort((a,b)=>a.businessDate.localeCompare(b.businessDate)||a.knownAt.localeCompare(b.knownAt)||a.id.localeCompare(b.id)))m.set(key(r.entityId,r.warehouseId,r.materialId,r.workCenterId,r.channelId),r);return [...m.values()];}
export function calculateScenario(state:BusinessState,spec:ScenarioSpec,inputGeneration:string|null=null,salesForecast?:SalesForecast):ScenarioResult{
 const paidBasis=state.profile.industry==='ecommerce'&&salesForecast?.status==='ready'?salesForecast:null;
 if(paidBasis&&(paidBasis.forecastOrigin!==state.asOf||paidBasis.horizonDays!==state.profile.horizonDays))throw Error('销量基线与约束窗口不一致');
 const paidKeys=new Set(paidBasis?.points.map(p=>key(p.entityId,p.channelId))??[]),demand=new Map(paidBasis?.points.map(p=>[key(p.entityId,p.channelId,p.date),p.value])??[]),accumulated=new Map<string,number>();
 const p=state.profile,rows=state.inputs,horizon=p.horizonDays,first=plusDays(state.asOf,1),last=plusDays(state.asOf,horizon),revenueKind=p.industry==='hotel'?'hotel_stay':'order';
 const days=Math.round((Date.parse(state.period.end)-Date.parse(state.period.start))/86400000)+1;
 const problems:string[]=[],limits=['按已录净支付或已入住节奏推演，不代表全部潜在需求；不证明行动收益或因果。'],assumptions:string[]=[];
 if(['netRevenueCents','variableCostCents','spendCents'].some(k=>state.metrics[k]?.value==null))problems.push('收入、成本或经营投入未完整覆盖统计期');
 const required=p.industry==='hotel'?['hotel_capacity','hotel_reservation',...(p.expectedSources.some(s=>s.kinds.includes('hotel_service_capacity'))||rows.some(r=>r.kind==='hotel_service_capacity')?['hotel_service_capacity']:[])]:p.industry==='manufacturing'?['inventory','material_inventory','bom','production_capacity']:['inventory','fulfillment_rule'];
 for(const kind of required){const sources=p.expectedSources.filter(s=>s.kinds.includes(kind)).map(s=>s.sourceId);const start=['hotel_capacity','hotel_reservation','hotel_service_capacity','production_capacity'].includes(kind)?first:state.asOf,end=['hotel_capacity','hotel_reservation','hotel_service_capacity','production_capacity'].includes(kind)?last:state.asOf;if(!completeCoverage(state.coverage,kind,start,end,sources))problems.push(`${kind} 未完整覆盖约束窗口`);}
 const actionCost=integerSum([...spec.actions.map(a=>a.costCents),...rows.filter(r=>['production','arrival'].includes(r.kind)&&r.status==='planned'&&r.businessDate>=first&&r.businessDate<=last).map(r=>r.costCents??0)]);const feasibilityReasons:string[]=[];
 if(p.cashBudgetCents==null)feasibilityReasons.push('现金预算尚未确认');else if(actionCost+(spec.capitalRequirementCents??0)>p.cashBudgetCents)feasibilityReasons.push('动作投入超出现金预算');
 if(spec.priceBps!==undefined&&spec.priceBps!==10000){feasibilityReasons.push('价格调整的需求响应尚未确认');assumptions.push('价格条件仅用于推演，需求弹性及实际执行须另行核验');}
 if(spec.actions.some(a=>!a.confirmed))feasibilityReasons.push('动作条件尚未确认');
 if(rows.some(r=>['arrival','production'].includes(r.kind)&&r.status==='planned'&&r.businessDate>=first&&r.businessDate<=last))feasibilityReasons.push('预测依赖尚未实际收货或完成的供给计划');
 if(rows.some(r=>['production','arrival'].includes(r.kind)&&r.status==='planned'&&r.businessDate>=first&&r.businessDate<=last&&r.costCents==null))problems.push('供给计划的额外投入尚未确认');

 for(const a of spec.actions){if(a.date<first||a.date>last)problems.push('方案动作超出预测窗口');if(p.industry==='hotel'&&a.kind!=='hotel_capacity'||p.industry==='ecommerce'&&['production','hotel_capacity'].includes(a.kind)||p.industry==='manufacturing'&&a.kind==='hotel_capacity')problems.push('动作不适用于当前行业');}
 const historical=rows.filter(r=>r.kind===revenueKind&&r.businessDate>=state.period.start&&r.businessDate<=state.period.end);
 const groups=new Map<string,{entityId:string;channelId:string|null;quantity:number;revenue:number;cost:number;ids:string[]}>();
 for(const r of historical){const k=key(r.entityId,p.industry==='hotel'?null:r.channelId??null),g=groups.get(k)??{entityId:r.entityId,channelId:p.industry==='hotel'?null:r.channelId??null,quantity:0,revenue:0,cost:0,ids:[]};const sign=r.entryType==='refund'?-1:1;g.quantity+=(paidBasis?(r.entryType==='refund'?0:1):sign)*(r.quantity??0);g.revenue+=sign*(r.amountCents??0);g.cost+=sign*(r.variableCostCents??0);g.ids.push(r.id);groups.set(k,g);}
 if(!groups.size)problems.push('没有可估算的历史履约商品或房型');
 if(paidBasis){for(const k of groups.keys())if(!paidKeys.has(k))groups.delete(k);limits.splice(0,1,...paidBasis.limitations);}
 const invalidNet=[...groups.values()].some(g=>g.quantity<0||g.revenue<0||g.cost<0);if(invalidNet)problems.push('统计期净支付量或金额为负，不能形成非负需求基线；请扩大窗口核对退款');
 const overBudget=horizon*groups.size>100000;if(overBudget)problems.push('推演超过十万个实体渠道日组合，请缩小经营窗口或实体范围');
 const stock=new Map<string,number>(),materials=new Map<string,number>();
 for(const r of latest(rows,'inventory',state.asOf))stock.set(key(r.entityId,r.warehouseId),Math.max(0,r.quantity!-(r.reservedUnits??0)-(r.inspectionUnits??0)));
 for(const r of latest(rows,'material_inventory',state.asOf))materials.set(key(r.entityId,r.warehouseId),Math.max(0,r.quantity!-(r.reservedUnits??0)-(r.inspectionUnits??0)));
 const boms=latest(rows,'bom',state.asOf),rules=latest(rows,'fulfillment_rule',state.asOf);
 const pending:Array<{date:string;entityId:string;warehouseId:string;quantity:number}>=[];
 const points:ForecastPoint[]=[];
 for(let d=1;d<=horizon&&!overBudget&&!invalidNet;d++){
  const date=plusDays(state.asOf,d);
  for(const move of pending.filter(x=>x.date===date)){const resource=boms.some(b=>b.materialId===move.entityId)?materials:stock,k=key(move.entityId,move.warehouseId);resource.set(k,(resource.get(k)??0)+move.quantity);}
  // A recorded arrival is a plan assumption, not proof of receipt.
  const capacities=new Map<string,number>();
  for(const r of rows.filter(r=>r.kind==='production_capacity'&&r.businessDate===date)){const k=key(r.workCenterId);if(capacities.has(k))problems.push('同工作中心同日存在重复产能记录');else capacities.set(k,r.quantity!);}
  const planned=rows.filter(r=>r.kind==='production'&&r.status==='planned'&&r.businessDate===date).map(r=>({kind:'production' as const,entityId:r.entityId,date,quantity:r.quantity!,warehouseId:r.warehouseId!,workCenterId:r.workCenterId!,leadDays:r.leadDays!,costCents:r.costCents??0,confirmed:false}));
  if(planned.length)assumptions.push('已保存生产计划按所录物料、工序与交期执行');
  const arrivals=rows.filter(r=>r.kind==='arrival'&&r.status==='planned'&&r.businessDate>=first&&r.businessDate<=last&&plusDays(r.businessDate,-(r.leadDays??0))===date).map(r=>({kind:r.fromWarehouseId?'transfer' as const:'arrival' as const,entityId:r.entityId,date,quantity:r.quantity!,warehouseId:r.warehouseId!,fromWarehouseId:r.fromWarehouseId,leadDays:r.leadDays??0,costCents:r.costCents??0,confirmed:false}));
  if(d===1&&rows.some(r=>r.kind==='arrival'&&r.status==='planned'&&r.businessDate>=first&&r.businessDate<=last&&plusDays(r.businessDate,-(r.leadDays??0))<first))problems.push('在途到货缺少预测窗口内的出库依据；请用已扣减的库存和外部在途记录确认');
  if(arrivals.length)assumptions.push('已保存到货与调拨计划按所录交期执行并通过质检');
  for(const a of [...spec.actions.filter(a=>a.date===date),...arrivals,...planned]){
   const destination=key(a.entityId,a.warehouseId);
   if(a.kind==='arrival')pending.push({date:plusDays(date,a.leadDays),entityId:a.entityId,warehouseId:a.warehouseId!,quantity:a.quantity});
   if(a.kind==='transfer'){const resource=boms.some(b=>b.materialId===a.entityId)?materials:stock,source=key(a.entityId,a.fromWarehouseId),available=resource.get(source)??0;if(available<a.quantity){feasibilityReasons.push('调拨来源仓可售不足');continue;}resource.set(source,available-a.quantity);pending.push({date:plusDays(date,a.leadDays),entityId:a.entityId,warehouseId:a.warehouseId!,quantity:a.quantity});}
   if(a.kind==='production'){
    const bom=boms.filter(r=>r.entityId===a.entityId&&r.workCenterId===a.workCenterId);const capKey=key(a.workCenterId);
    if(!bom.length||!capacities.has(capKey)){problems.push('生产计划缺少 BOM 或当日产能');continue;}
    const materialLimit=Math.min(...bom.map(b=>Math.floor((materials.get(key(b.materialId,a.warehouseId))??0)/b.unitsPerProduct!)));
    const quantity=Math.min(a.quantity,capacities.get(capKey)!,materialLimit);capacities.set(capKey,capacities.get(capKey)!-quantity);
    for(const b of bom){const k=key(b.materialId,a.warehouseId);materials.set(k,(materials.get(k)??0)-quantity*b.unitsPerProduct!);}
    if(quantity<a.quantity)assumptions.push(`${a.entityId} 计划${a.quantity}件，物料与产能仅支持${quantity}件`);
    pending.push({date:plusDays(date,a.leadDays),entityId:a.entityId,warehouseId:a.warehouseId!,quantity});
   }
   // Zero-lead actions become usable today, never yesterday.
   if(a.leadDays===0&&a.kind!=='hotel_capacity'){const own=pending.filter(x=>x.date===date&&x.entityId===a.entityId&&x.warehouseId===a.warehouseId);for(const x of own){const resource=boms.some(b=>b.materialId===x.entityId)?materials:stock;resource.set(destination,(resource.get(destination)??0)+x.quantity);pending.splice(pending.indexOf(x),1);}}
  }
  for(const g of groups.values()){
   const target=(n:number)=>Math.round(g.quantity*n*spec.demandBps/(days*10000));const k=key(g.entityId,g.channelId),previous=accumulated.get(k)??0,next=previous+(demand.get(key(g.entityId,g.channelId,date))??0)*spec.demandBps/10000;accumulated.set(k,next);let requested=paidBasis?Math.round(next)-Math.round(previous):target(d)-target(d-1),fulfilled=0,fulfillmentCost=0;
   const evidence=[...g.ids.slice(0,8)];
   if(p.industry==='hotel'){
    const capacity=rows.filter(r=>r.kind==='hotel_capacity'&&r.entityId===g.entityId&&r.businessDate===date);if(capacity.length!==1){problems.push('房型当日可售房晚缺失或重复');}
    const reservations=rows.filter(r=>r.kind==='hotel_reservation'&&r.entityId===g.entityId&&r.businessDate===date&&r.status!=='cancelled');
    const booked=integerSum(reservations.map(r=>r.quantity!));requested=Math.max(requested,booked);
    const base=capacity[0]?Math.max(0,capacity[0].quantity!-(capacity[0].reservedUnits??0)-(capacity[0].inspectionUnits??0)):0;
    const extra=spec.actions.filter(a=>a.kind==='hotel_capacity'&&a.entityId===g.entityId&&plusDays(a.date,a.leadDays)===date).reduce((n,a)=>n+a.quantity,0);
    const service=rows.filter(r=>r.kind==='hotel_service_capacity'&&r.entityId===g.entityId&&r.businessDate===date);
    const serviceRequired=p.expectedSources.some(s=>s.kinds.includes('hotel_service_capacity'));
    if(serviceRequired&&!service.length)problems.push('当日保洁或接待服务能力尚未登记');
    const serviceLimit=service.length?Math.min(...service.map(r=>r.quantity!)):serviceRequired?0:base+extra;
    fulfilled=Math.min(requested,base+extra,serviceLimit);evidence.push(...service.map(r=>r.id));if(service.length&&serviceLimit<base+extra)assumptions.push('房晚承接受已登记保洁或接待排班能力限制，新增排班未确认');
    evidence.push(...capacity.map(r=>r.id),...reservations.map(r=>r.id));
   }else{
    const authorized=p.industry==='ecommerce'?rules.filter(r=>r.entityId===g.entityId&&r.channelId===g.channelId).sort((a,b)=>(a.costCents??0)-(b.costCents??0)||a.id.localeCompare(b.id)):latest(rows,'inventory',state.asOf).filter(r=>r.entityId===g.entityId);
    if(!authorized.length)problems.push(`${g.entityId} 缺少可履约仓库规则`);
    for(const r of authorized){if(p.industry==='ecommerce'&&(r.leadDays==null||r.costCents==null)){problems.push('履约规则缺少交期或额外履约费用');continue;}if(plusDays(date,r.leadDays??0)>last)continue;const k=key(g.entityId,r.warehouseId),quantity=Math.min(requested-fulfilled,stock.get(k)??0);if(quantity<=0)continue;stock.set(k,(stock.get(k)??0)-quantity);fulfilled+=quantity;fulfillmentCost+=quantity*(r.kind==='fulfillment_rule'?r.costCents??0:0);evidence.push(r.id);}
   }
   const point:ForecastPoint={date,entityId:g.entityId,channelId:g.channelId,requested,fulfilled,unmet:requested-fulfilled,revenueCents:Math.round(fulfilled*g.revenue*(spec.priceBps??10000)/(Math.max(1,g.quantity)*10000)),variableCostCents:Math.round(fulfilled*g.cost/Math.max(1,g.quantity))+fulfillmentCost,evidenceIds:[...new Set(evidence)]};
   points.push(point);
  }
 }
 const forecastedEntityIds=[...new Set([...groups.values()].map(g=>g.entityId))].sort(),knownEntities=[...new Set(rows.filter(r=>['order','hotel_stay','inventory','bom','arrival','production','hotel_capacity','hotel_reservation'].includes(r.kind)).map(r=>r.entityId))];
 const unestimatedEntityIds=[...new Set([...knownEntities.filter(id=>!forecastedEntityIds.includes(id)),...paidBasis?.unestimatedEntityIds??[]])].sort(),coverage={status:unestimatedEntityIds.length?'partial' as const:'complete_for_observed_sales' as const,forecastedEntityIds,unestimatedEntityIds,unestimatedEndingSellable:integerSum([...stock].filter(([key])=>unestimatedEntityIds.includes(JSON.parse(key)[0])).map(([,quantity])=>quantity)),salesTotalsScope:'已录历史销售实体的约束推演；未估计实体和未观察需求不计入销量与贡献毛利'};
 if(unestimatedEntityIds.length)limits.push('存在未估计商品或房型，汇总仅覆盖有历史的实体，不能作为全企业最优方案');
 const valid=!problems.length,spend=Math.round((state.metrics.spendCents.value??0)*horizon/days),revenue=integerSum(points.map(r=>r.revenueCents)),cost=integerSum(points.map(r=>r.variableCostCents));
 const infeasible=feasibilityReasons.some(x=>x.includes('不足')||x.includes('超出'));
 return {version:paidBasis?'constrained-paid-v1.5':SCENARIO_VERSION,id:spec.id,name:spec.name,inputGeneration,status:valid?'calculated':'insufficient',coverage,unit:p.industry==='hotel'?'房晚':'件',points:valid?points:[],totals:{requested:valid?integerSum(points.map(r=>r.requested)):null,fulfilled:valid?integerSum(points.map(r=>r.fulfilled)):null,unmet:valid?integerSum(points.map(r=>r.unmet)):null,netRevenueCents:valid?revenue:null,variableCostCents:valid?cost:null,spendCents:valid?spend:null,actionCostCents:actionCost,contributionMarginCents:valid?revenue-cost-spend-actionCost:null,endingSellable:valid&&p.industry!=='hotel'?integerSum([...stock.values()]):null},feasibility:{status:infeasible?'infeasible':feasibilityReasons.length||!valid?'unconfirmed':'feasible',reasons:[...new Set([...feasibilityReasons,...problems])]},limitations:limits,assumptions:[...new Set(assumptions)]};
}
export function recommendScenario(results:ScenarioResult[]){
 const comparable=results.filter(r=>r.status==='calculated'&&r.coverage?.status!=='partial'&&r.feasibility.status==='feasible'&&r.totals.contributionMarginCents!=null);
 const generations=new Set(results.map(r=>r.inputGeneration));
 if(generations.size>1)return {scenarioId:null,reason:'资料代次不同，不能比较'};
 const ordered=comparable.sort((a,b)=>b.totals.contributionMarginCents!-a.totals.contributionMarginCents!||a.totals.actionCostCents-b.totals.actionCostCents||a.id.localeCompare(b.id));
 return {scenarioId:ordered[0]?.id??null,reason:ordered.length?'已计算且约束确认的候选中贡献毛利最高；不保证全局最优':results.some(r=>r.coverage?.status==='partial')?'存在未估计实体，不能推荐全企业最优方案':'缺少约束已确认、资料完整的可比较方案'};
}
