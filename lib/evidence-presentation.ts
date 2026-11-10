import {displayNumber,displayPercent,displayMoney} from './operating-demo-data.ts';
// Display saved results only. This does not reconstruct a customer funnel or supply calculation.
export function savedEvidenceSummary(id:string,value:unknown):string|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>;
 if(id.endsWith(':customerJourney')||id.endsWith(':view:customer-journey')){const journey=value as import('../server/customer-journey.ts').CustomerJourney,period=journey.recent??journey.period;return `${journey.recent?'近四周':'统计期'}客户：了解 ${displayNumber(period.counts.A1)} 人、互动 ${displayNumber(period.counts.A2)} 人、意向 ${displayNumber(period.counts.A3)} 人、购买 ${displayNumber(period.counts.A4)} 人。三个环节的转化率依次为 ${period.transitions.map(t=>displayPercent(t.rate)).join('、')}。`;}
 if(id.endsWith(':customerAnalysis'))return `已完成观察 ${displayNumber(v.matureCustomers as number|null)} 人，窗口内支付 ${displayNumber(v.convertedCustomers as number|null)} 人，比例 ${displayPercent(v.conversionRate as number|null)}；队列 ${displayNumber(v.cohortCustomers as number|null)} 人，未完成观察 ${displayNumber(v.immatureCustomers as number|null)} 人。支付不等于退款后保留成交。`;
 if(id.endsWith(':supply')){const roles=v.roles as Array<{skuCount:number;observedSkuCount:number;qualifiedRatio:number|null}>|undefined;return roles?`已保存 ${roles.length} 类货盘的库存、备货规则与到货依据。每类货盘按实际已观测商品规格计算，缺少库存或目标时比例保持未知；原始规则与逐周数值见计算详情。`:null;}
 return null;
}

import {channelName,productName} from './business-presentation.ts';
const sourceLabels:Record<string,string>={paidOrders:'支付订单（笔）',events:'行为（次）',netRevenueCents:'净成交额',spendCents:'投放费用',variableCostCents:'变动成本',contributionMarginCents:'贡献毛利',sellable_units:'可售（件）',in_transit_units:'在途（件）',inventory_cost_cents:'库存成本',safety_units:'已设定备货目标（件）',product_id:'商品',sku_id:'商品规格',warehouse_id:'仓库',business_date:'业务日期',occurred_at:'记录时间',channel:'渠道',quantity:'数量',entry_type:'支付或退款',amount_cents:'金额',variable_cost_cents:'变动成本',event_type:'行为类型',stage:'经营阶段'};
const eventLabels:Record<string,string>={engaged:'互动',inquiry:'咨询',content_view:'内容浏览',impression:'曝光',click:'点击',visit:'访问',lead:'留资',purchase:'购买',paid:'支付',refund:'退款',A1:'认知',A2:'吸引',A3:'询问',A4:'成交',A5:'拥护'};
// A readable view of known fields; exact original fields and codes remain in the drawer details.
export function evidenceSourceText(value:unknown,products:Array<{id:string;name:string}>=[],channels:Array<{id:string;name:string}>=[]):string{
 if(!value||typeof value!=='object'||Array.isArray(value))return '来源记录已保存，完整内容见追溯详情。';
 return Object.entries(value).filter(([key])=>Object.hasOwn(sourceLabels,key)).map(([key,v])=>{
  let shown:string;
  if(v==null)shown=key==='channel'?'各渠道共享 / 不适用':'待补数据';
  else if(key==='channel')shown=channelName(String(v),channels);
  else if(key==='product_id')shown=productName(String(v),products);
  else if(key==='event_type'||key==='entry_type'||key==='stage')shown=eventLabels[String(v)]||'类型待确认（见原始记录）';
  else if(key.endsWith('Cents')||key.endsWith('_cents'))shown=typeof v==='number'?displayMoney(v/100):'金额待确认';
  else shown=typeof v==='number'?displayNumber(v):String(v);
  return sourceLabels[key]+'：'+shown;
 }).join('；')||'来源记录已保存，完整内容见追溯详情。';
}
export function savedEvidenceNote(id:string,value:unknown):string|null{
 if((id.endsWith(':customerJourney')||id.endsWith(':view:customer-journey'))&&value&&typeof value==='object')return '客户人数按身份去重；转化率使用完成观察的客户，不能直接用四段总人数相除。前后两个四周各自留足同等观察时间。规则、分母、逐周结果与来源均可在计算详情中核对。';
 if(!id.endsWith(':customerAnalysis')||!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>;
 if(v.conversionRate==null)return '客户身份关联或观察窗口资料不足，暂不能给出客户成交比例。行为次数和订单笔数分别统计，不能直接作为客户转化率。';
 return '此处按已关联客户身份统计成熟观察窗口内的支付比例：窗口内支付客户数除以已完成观察客户数，未完成观察者不计入分母。行为次数和订单笔数不能直接作为客户转化率；支付也不等于退款后保留成交。全部原始规则和范围限制见下方详情。';
}
