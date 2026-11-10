import {businessCustomerKey,unresolvedCrossSourceIdentity} from './business-identity.ts';
import type {BusinessState,FrozenInput} from './business-state.ts';
import {completeCoverage,type Metric} from './business-metrics.ts';
type Rule={conversionWindowDays:number;channelPolicy:'same_channel'|'any';cohortStage:string};
const day=86400000;
export function businessJourney(state:BusinessState,rule:Rule|null){
 const {profile,period,asOf,inputs,coverage}=state,revenueKind=profile.industry==='hotel'?'hotel_stay':'order';
 const expected=(kind:string)=>profile.expectedSources.filter(s=>s.kinds.includes(kind)).map(s=>s.sourceId);
 const stage=(r:FrozenInput)=>r.kind===revenueKind&&r.entryType!=='refund'?'A4':r.kind==='event'?r.stage:null;
 const measure=(from:string,to:string)=>{
  const empty:Metric={value:null,knownValue:null,unit:'%',status:'missing',reason:'需发布客户身份与观察窗口规则',evidenceIds:[]};
  if(!rule)return {from,to,metric:empty,matureCustomers:null,convertedCustomers:null,immatureCustomers:null};
  const lastObservation=new Date(Date.parse(period.end)+rule.conversionWindowDays*day).toISOString().slice(0,10),requiredEnd=lastObservation<asOf?lastObservation:asOf;
  const full=completeCoverage(coverage,'event',period.start,requiredEnd,expected('event'))&&(to!=='A4'||completeCoverage(coverage,revenueKind,period.start,requiredEnd,expected(revenueKind)));
  const rows=inputs.filter(r=>stage(r)===from&&r.businessDate>=period.start&&r.businessDate<=period.end);
  if(!full||unresolvedCrossSourceIdentity(profile,[...rows,...inputs.filter(r=>stage(r)===to&&r.businessDate>=period.start&&r.businessDate<=requiredEnd)])||rows.some(r=>!r.customerId||(rule.channelPolicy==='same_channel'&&!r.channelId))||inputs.some(r=>stage(r)===to&&r.businessDate>=period.start&&r.businessDate<=requiredEnd&&(!r.customerId||(rule.channelPolicy==='same_channel'&&!r.channelId))))return {from,to,metric:{...empty,status:'partial' as const,reason:'客户身份、渠道或完整观察资料不足'},matureCustomers:null,convertedCustomers:null,immatureCustomers:null};
  const starts=new Map<string,FrozenInput>();
  for(const r of rows.sort((a,b)=>a.businessDate.localeCompare(b.businessDate))){const key=JSON.stringify([businessCustomerKey(profile,r),rule.channelPolicy==='same_channel'?r.channelId:null]);if(!starts.has(key))starts.set(key,r);}
  let mature=0,converted=0,immature=0;const evidenceIds:string[]=[];
  const targets=new Map<string,FrozenInput[]>();for(const r of inputs.filter(r=>stage(r)===to)){const key=JSON.stringify([businessCustomerKey(profile,r),rule.channelPolicy==='same_channel'?r.channelId:null]);const group=targets.get(key)??[];group.push(r);targets.set(key,group);}
  for(const [key,start] of starts){const stop=new Date(Date.parse(start.businessDate)+rule.conversionWindowDays*day).toISOString().slice(0,10);if(stop>asOf){immature++;continue;}mature++;evidenceIds.push(start.id,...(start.identityEvidenceIds??[]));const found=targets.get(key)?.find(r=>r.businessDate>=start.businessDate&&r.businessDate<=stop);if(found){converted++;evidenceIds.push(found.id,...(found.identityEvidenceIds??[]));}}
  const metric:Metric={value:mature?converted/mature*100:null,knownValue:mature?converted/mature*100:null,unit:'%',status:mature?'complete':'missing',reason:mature?null:'没有完成观察窗口的客户，不计算转化率',evidenceIds};
  return {from,to,metric,matureCustomers:mature,convertedCustomers:converted,immatureCustomers:immature};
 };
 const transitions=['A1','A2','A3'].map((from,i)=>measure(from,'A'+(i+2))),purchaseCohort=rule?measure(rule.cohortStage,'A4'):null;
 return {rule,transitions,purchaseCohort,notice:'所选 cohort 阶段用于到购买的观察；三段旅程分别以各自起始阶段观察。未声明企业统一身份时只在同来源内匹配；按身份与渠道规则追踪有序旅程，未完成观察的客户不进分母；同日阶段仅能按日关联，无法证明日内先后。酒店购买阶段按已入住客户统计，订房需单独核查。'};
}
