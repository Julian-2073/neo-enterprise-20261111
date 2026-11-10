import type {ScenarioInput,ScenarioAssumption} from '../server/agent-contracts';
import {businessText,productName,channelName,multiplierText,responseText} from './business-presentation.ts';
const sourceName={user_assumption:'老板提供的假设',historical_estimate:'历史估计',external_reference:'外部参考',model_hypothesis:'AI 条件假设',synthetic:'合成测试参数'};
const amount=(n:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
const assumptionText=(a:ScenarioAssumption)=>`${sourceName[a.source]||'来源待核对'}；${a.confirmed?'输入条件已确认，效果仍需验证':'输入条件尚未确认'}${a.note?`；${businessText(a.note)}`:''}`;
export function scenarioSummary(v:ScenarioInput,products:Array<{id:string;name:string}>=[]){
 if(v.operating){const s=v.operating;return [`整体需求改变 ${(s.demandBps-10000)/100}%，属于待验证假设`,...s.actions.map(a=>`${a.entityId}：${a.date}，${({arrival:'到货',transfer:'调拨',production:'生产',hotel_capacity:'当日房晚能力'})[a.kind]} ${a.quantity}；交期 ${a.leadDays} 天，投入 ${amount(a.costCents)}；${a.confirmed?'推演条件已核对':'推演条件待确认'}`)];}
 return [
 ...(v.adjustments??[]).map(x=>{
  const conditions=[multiplierText('budget',x.budgetMultiplier??1),multiplierText('demand',x.conversionMultiplier??1),multiplierText('price',x.priceMultiplier??1)];
  if((x.budgetMultiplier??1)!==1)conditions.push(responseText('budget',x.budgetResponse));
  if((x.priceMultiplier??1)!==1)conditions.push(responseText('price',x.priceElasticity));
  if(x.mixWeight!=null)conditions.push(`商品资源分配权重为${x.mixWeight}；权重需结合其他商品一起计算，不等于销量份额`);
  const period=x.start||x.end?`${x.start||'预测首日'} 至 ${x.end||'预测期末'}`:'整个28天预测期';
  return `${productName(x.productId,products)}${x.channel?` / ${channelName(x.channel)}`:''}：${conditions.join('；')}；生效时间：${period}。${assumptionText(x.assumption)}`;
 }),
 ...(v.arrivals??[]).map(x=>`商品规格${x.skuId}，仓库${x.warehouseId}：${x.date}到货${x.units}件；到货前不计为可售。${assumptionText(x.assumption)}`),
 ...(v.transfers??[]).map(x=>`商品规格${x.skuId}：${x.date}从仓库${x.fromWarehouse}调往${x.toWarehouse}，${x.units}件；同时扣减来源仓，企业总库存不增加。${assumptionText(x.assumption)}`),
 `额外成本${amount(v.extraCostCents??0)}${v.extraCostAssumption?`；${assumptionText(v.extraCostAssumption)}`:''}`,
 ];
}
