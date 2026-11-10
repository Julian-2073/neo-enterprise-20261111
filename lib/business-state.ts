import {businessCustomerKey,unresolvedCrossSourceIdentity} from './business-identity.ts';
import {completeCoverage,financialMetrics,metric,METRIC_VERSION,type Coverage,type Metric} from './business-metrics.ts';

export type Industry='ecommerce'|'hotel'|'manufacturing';
export type BusinessProfile={industry:Industry;timezone:string;name:string;region:string;horizonDays:number;objective:'contribution_margin';cashBudgetCents:number|null;expectedSources:Array<{sourceId:string;kinds:string[];customerIdentity?:{scope:'source'|'enterprise';ruleVersion:string}}>;competitors:string[]};
export type InputKind='order'|'expense'|'event'|'inventory'|'arrival'|'fulfillment_rule'|'hotel_reservation'|'hotel_capacity'|'hotel_stay'|'hotel_service_capacity'|'material_inventory'|'bom'|'production_capacity'|'production';
export type BusinessInput={recordKey:string;kind:InputKind;businessDate:string;entityId:string;channelId?:string;warehouseId?:string;fromWarehouseId?:string;customerId?:string;orderId?:string;orderLineId?:string;entryType?:'paid'|'refund';stage?:'A1'|'A2'|'A3'|'A4';quantity?:number;amountCents?:number;variableCostCents?:number|null;inventoryCostCents?:number|null;reservedUnits?:number;inspectionUnits?:number;materialId?:string;unitsPerProduct?:number;workCenterId?:string;status?:'planned'|'completed'|'cancelled';leadDays?:number;costCents?:number;supersedesId?:string};
export type FrozenInput=BusinessInput&{id:string;sourceId:string;revision:number;knownAt:string;identityEvidenceIds?:string[]};
export type BusinessState={version:string;businessId:string;dataNature:string;profileVersion:string;profile:BusinessProfile;asOf:string;knownAt:string;period:{start:string;end:string};measurement?:{fulfilledUnits:string;actualShipmentAvailable:boolean;refundRestockVerified:boolean};identity?:Record<string,unknown>;metrics:Record<string,Metric>;inputs:FrozenInput[];coverage:Coverage[];quality:{status:'ready'|'partial';gaps:string[]};};
export const INPUT_KINDS:InputKind[]=['order','expense','event','inventory','arrival','fulfillment_rule','hotel_reservation','hotel_capacity','hotel_stay','hotel_service_capacity','material_inventory','bom','production_capacity','production'];
const numericFields=['quantity','amountCents','variableCostCents','inventoryCostCents','reservedUnits','inspectionUnits','unitsPerProduct','leadDays','costCents'] as const;
const required:Record<InputKind,string[]>={order:['quantity','amountCents','entryType','orderId'],expense:['amountCents'],event:['stage','quantity'],inventory:['warehouseId','quantity'],arrival:['warehouseId','quantity','status'],fulfillment_rule:['warehouseId','channelId','leadDays','costCents'],hotel_reservation:['quantity','status'],hotel_capacity:['quantity'],hotel_service_capacity:['workCenterId','quantity'],hotel_stay:['quantity','amountCents'],material_inventory:['warehouseId','quantity'],bom:['materialId','unitsPerProduct','workCenterId'],production_capacity:['workCenterId','quantity'],production:['workCenterId','warehouseId','quantity','status','leadDays']};
export function validateProfile(input:unknown):BusinessProfile{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('需要企业经营档案');const p=input as BusinessProfile;
 if(!['ecommerce','hotel','manufacturing'].includes(p.industry)||typeof p.name!=='string'||!p.name.trim()||p.name.length>200)throw Error('企业名称或行业无效');
 try{new Intl.DateTimeFormat('en',{timeZone:p.timezone});}catch{throw Error('企业时区无效');}
 if(p.objective!=='contribution_margin'||!Number.isInteger(p.horizonDays)||p.horizonDays<1||p.horizonDays>90)throw Error('目标须为贡献毛利，预测窗口须为1至90天');
 if(p.cashBudgetCents!==null&&(!Number.isSafeInteger(p.cashBudgetCents)||p.cashBudgetCents<0))throw Error('现金预算须为非负整数分或null');
 if(typeof p.region!=='string'||!Array.isArray(p.competitors)||p.competitors.length>20||p.competitors.some(x=>typeof x!=='string'||x.length>300)||!Array.isArray(p.expectedSources)||!p.expectedSources.length||p.expectedSources.length>30)throw Error('地区、竞品或预期来源无效');
 if(p.expectedSources.some(s=>!s||typeof s.sourceId!=='string'||!s.sourceId||!Array.isArray(s.kinds)||!s.kinds.length||s.kinds.some(k=>!INPUT_KINDS.includes(k as InputKind))))throw Error('预期来源须声明注册的数据类型');
 if(p.expectedSources.some(s=>s.customerIdentity&&(!['source','enterprise'].includes(s.customerIdentity.scope)||typeof s.customerIdentity.ruleVersion!=='string'||!s.customerIdentity.ruleVersion.trim()||s.customerIdentity.ruleVersion.length>100)))throw Error('客户身份须声明来源内或企业统一范围及规则版本');
 if(new Set(p.expectedSources.map(s=>s.sourceId)).size!==p.expectedSources.length)throw Error('预期来源标识重复');
 return {industry:p.industry,timezone:p.timezone,name:p.name.trim(),region:p.region,horizonDays:p.horizonDays,objective:p.objective,cashBudgetCents:p.cashBudgetCents,expectedSources:p.expectedSources.map(x=>({sourceId:x.sourceId,kinds:[...new Set(x.kinds)],...(x.customerIdentity?{customerIdentity:{...x.customerIdentity}}:{})})),competitors:[...p.competitors]};
}
export function validateBusinessInput(input:unknown,industry:Industry):BusinessInput{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('经营记录须为对象');const r=input as BusinessInput;
 const allowed=['recordKey','kind','businessDate','entityId','channelId','warehouseId','fromWarehouseId','customerId','orderId','orderLineId','entryType','stage','materialId','workCenterId','status','supersedesId',...numericFields];
 if(Object.keys(r).some(k=>!allowed.includes(k))||!INPUT_KINDS.includes(r.kind)||typeof r.recordKey!=='string'||!r.recordKey||r.recordKey.length>200||typeof r.entityId!=='string'||!r.entityId)throw Error('记录字段、标识或数据类型无效');
 if(typeof r.businessDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.businessDate)||!Number.isFinite(Date.parse(r.businessDate+'T00:00:00Z'))||new Date(r.businessDate+'T00:00:00Z').toISOString().slice(0,10)!==r.businessDate)throw Error('经营日期无效');
 if(required[r.kind].some(k=>(r as unknown as Record<string,unknown>)[k]==null||(r as unknown as Record<string,unknown>)[k]===''))throw Error(`${r.kind} 缺少必需字段`);
 for(const k of ['entityId','channelId','warehouseId','fromWarehouseId','customerId','orderId','orderLineId','materialId','workCenterId','supersedesId'] as const){const v=r[k];if(v!=null&&(typeof v!=='string'||!v.trim()||v.length>200))throw Error(`${k} 标识无效`);}
 for(const k of numericFields){const v=r[k];if(v!=null&&(!Number.isSafeInteger(v)||v<0||(k==='unitsPerProduct'&&v===0)))throw Error(`${k} 须为非负安全整数`);}
 if(r.entryType&&!['paid','refund'].includes(r.entryType)||r.stage&&!['A1','A2','A3','A4'].includes(r.stage)||r.status&&!['planned','completed','cancelled'].includes(r.status))throw Error('经营状态无效');
 if(r.kind.startsWith('hotel_')&&industry!=='hotel'||['bom','material_inventory','production_capacity','production'].includes(r.kind)&&industry!=='manufacturing')throw Error('数据类型不适用于当前行业');
 if(r.fromWarehouseId&&(r.kind!=='arrival'||r.fromWarehouseId===r.warehouseId))throw Error('调拨收货须登记不同的来源与目的仓库');
 return {...r};
}
export function buildBusinessState(scope:{businessId:string;dataNature:string;profileVersion:string;profile:BusinessProfile;asOf:string;knownAt:string;start:string;end:string},inputs:FrozenInput[],coverage:Coverage[]):BusinessState{
 const current=inputs.filter(r=>r.businessDate>=scope.start&&r.businessDate<=scope.end),p=scope.profile;
 const revenueKind=p.industry==='hotel'?'hotel_stay':'order';
 const financialRows=current.filter(r=>[revenueKind,'expense'].includes(r.kind)).map(r=>({kind:r.kind==='expense'?'expenses':'orders',id:r.id,sourceId:r.sourceId,fact:{entry_type:r.entryType??'paid',order_id:r.orderId??r.recordKey,amount_cents:r.amountCents,variable_cost_cents:r.variableCostCents}}));
 // Include declared but absent sources in coverage, so a missing feed cannot
 // silently disappear from the completeness denominator.
 const mappedCoverage=coverage.map(c=>({...c,kind:c.kind===revenueKind?'orders':c.kind==='expense'?'expenses':c.kind}));
 for(const s of p.expectedSources)for(const k of s.kinds)if([revenueKind,'expense'].includes(k)&&!coverage.some(c=>c.kind===k&&c.sourceId===s.sourceId))mappedCoverage.push({sourceId:s.sourceId,kind:k===revenueKind?'orders':'expenses',start:'9999-12-31',end:'9999-12-31'});
 const metrics:Record<string,Metric>=financialMetrics(financialRows,mappedCoverage,scope.start,scope.end);
 const expected=(kind:string)=>p.expectedSources.filter(s=>s.kinds.includes(kind)).map(s=>s.sourceId);
 const covered=(kind:string)=>completeCoverage(coverage,kind,scope.start,scope.end,expected(kind));
 const actual=current.filter(r=>r.kind===revenueKind);
 const refunds=actual.filter(r=>r.entryType==='refund');
 metrics.refundUnits=metric(refunds.map(r=>r.quantity??0),p.industry==='hotel'?'房晚':'件',covered(revenueKind),refunds.map(r=>r.id));
 metrics.fulfilledUnits=metric(actual.map(r=>(r.quantity??0)*(r.entryType==='refund'?-1:1)),p.industry==='hotel'?'房晚':'件',covered(revenueKind),actual.map(r=>r.id));
 for(const stage of ['A1','A2','A3','A4']){
  const rs=current.filter(r=>stage==='A4'?r.kind===revenueKind&&r.entryType!=='refund':r.kind==='event'&&r.stage===stage);
  const crossSource=unresolvedCrossSourceIdentity(p,rs),identified=rs.every(r=>!!r.customerId),full=covered(stage==='A4'?revenueKind:'event');
  metrics[stage+'Customers']=metric([identified?new Set(rs.map(r=>businessCustomerKey(p,r))).size:null],'人',full&&!crossSource,rs.flatMap(r=>[r.id,...(r.identityEvidenceIds??[])]));
  if(crossSource)metrics[stage+'Customers'].reason='跨来源客户尚未声明统一身份规则，不能给出企业去重人数';
 }
 const positions=new Map<string,FrozenInput>();
 for(const r of inputs.filter(r=>['inventory','material_inventory','hotel_capacity'].includes(r.kind)&&r.businessDate<=scope.asOf).sort((a,b)=>a.businessDate.localeCompare(b.businessDate)||a.knownAt.localeCompare(b.knownAt)))positions.set(JSON.stringify([r.kind,r.entityId,r.warehouseId??null,r.kind==='hotel_capacity'?r.businessDate:null]),r);
 const stock=[...positions.values()].filter(r=>r.kind==='inventory');
 metrics.sellableUnits=metric(stock.map(r=>Math.max(0,r.quantity!-(r.reservedUnits??0)-(r.inspectionUnits??0))),'件',stock.length>0&&completeCoverage(coverage,'inventory',scope.asOf,scope.asOf,expected('inventory')),stock.map(r=>r.id),false);
 metrics.inventoryCostCents=metric(stock.map(r=>r.inventoryCostCents),'人民币分',stock.length>0&&completeCoverage(coverage,'inventory',scope.asOf,scope.asOf,expected('inventory')),stock.map(r=>r.id),false);
 if(p.industry==='hotel'){delete metrics.sellableUnits;delete metrics.inventoryCostCents;}
 const gaps=Object.entries(metrics).filter(([,m])=>m.value==null).map(([key,m])=>`${key}: ${m.reason}`);
 return {version:METRIC_VERSION,...scope,measurement:{fulfilledUnits:p.industry==='hotel'?'completed_stay_nights':'net_paid_quantity',actualShipmentAvailable:false,refundRestockVerified:false},identity:{basis:'registered_master_or_versioned_provider_rule',sourceDefault:'source_scoped',rules:p.expectedSources.map(s=>({sourceId:s.sourceId,...(s.customerIdentity??{scope:'source',ruleVersion:scope.profileVersion})}))},period:{start:scope.start,end:scope.end},inputs,coverage,metrics,quality:{status:gaps.length?'partial':'ready',gaps}};
}
