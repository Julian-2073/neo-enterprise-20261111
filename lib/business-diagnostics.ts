/** Pure diagnosis over an already authorized immutable input, using shared calculators. */
import {buildBusinessState,type BusinessState} from './business-state.ts';
import {businessJourney} from './business-journey.ts';
import {metric,completeCoverage,plusDays,type Metric} from './business-metrics.ts';
import type {ScenarioResult} from './business-scenarios.ts';
type JourneyRule=Parameters<typeof businessJourney>[1];
export function diagnosticBasis(state:BusinessState,rule:JourneyRule,baseline?:ScenarioResult){
 const window=(start:string,end:string,entityId?:string,channelId?:string|null)=>{
  const rows=state.inputs.filter(r=>(!entityId||r.entityId===entityId)&&(channelId===undefined||(r.channelId??null)===channelId));
  const scoped=buildBusinessState({...state,start,end},rows,state.coverage);
  const kind=state.profile.industry==='hotel'?'hotel_stay':'order';
  const refunds=rows.filter(r=>r.kind===kind&&r.entryType==='refund'&&r.businessDate>=start&&r.businessDate<=end);
  const covered=completeCoverage(state.coverage,kind,start,end,state.profile.expectedSources.filter(s=>s.kinds.includes(kind)).map(s=>s.sourceId));
  scoped.metrics.refundUnits=metric(refunds.map(r=>r.quantity),state.profile.industry==='hotel'?'房晚':'件',covered,refunds.map(r=>r.id));
  scoped.metrics.refundAmountCents=metric(refunds.map(r=>r.amountCents),'人民币分',covered,refunds.map(r=>r.id));
  return {period:{start,end},metrics:scoped.metrics,journey:businessJourney(scoped,rule)};
 };
 const days=Math.floor((Date.parse(state.period.end)-Date.parse(state.period.start))/86400000)+1;
 const half=Math.floor(days/2),currentStart=half?plusDays(state.period.end,1-half):state.period.start;
 const current=window(currentStart,state.period.end),previous=half?window(plusDays(currentStart,-half),plusDays(currentStart,-1)):null;
 const changes:Record<string,Metric>={};
 for(const [key,m] of Object.entries(current.metrics)){
  const prior=previous?.metrics[key],ready=m.value!==null&&prior?.value!=null;
  changes[key]={value:ready?m.value!-prior!.value!:null,knownValue:null,unit:m.unit,status:ready?'complete':'missing',reason:ready?null:'同长度前后期的指标、身份或来源覆盖不足',evidenceIds:[...m.evidenceIds,...(prior?.evidenceIds??[])]};
 }
 const pairs=[...new Map(state.inputs.filter(r=>r.businessDate>=state.period.start&&r.businessDate<=state.period.end&&['order','hotel_stay','expense','event'].includes(r.kind)).map(r=>[JSON.stringify([r.entityId,r.channelId??null]),{entityId:r.entityId,channelId:r.channelId??null}])).values()];
 const contributions=pairs.map(p=>({...p,...window(state.period.start,state.period.end,p.entityId,p.channelId)}));
 const stockDeficit:Metric={value:baseline?.status==='calculated'?baseline.totals.unmet:null,knownValue:null,unit:baseline?.unit??'件',status:baseline?.status==='calculated'?'complete':'missing',reason:baseline?.status==='calculated'?null:'尚无完整约束下的基线，库存数量不能直接当作供给缺口',evidenceIds:baseline?['forecast:'+baseline.inputGeneration]:[]};
 return {version:'business-diagnostics-v1',scope:{period:state.period,entityId:null as string|null,channelId:null as string|null,channelMode:'all' as 'all'|'exact'},recordCount:state.inputs.length,current,previous,changes,contributions,stockDeficit,comparisonBasis:'冻结统计期内最近两个等长窗口；无可比前期不填零',limitations:['商品渠道贡献不是因果归因；共享费用只在已登记实体渠道下核算，禁止猜测分摊。','独立阶段人数不等于有序转化率，订单笔数不等于新客数。']};
}
