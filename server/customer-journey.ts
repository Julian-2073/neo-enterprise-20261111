import type {Fact,Snapshot} from './contracts.ts';
import {eventStages} from './templates.ts';

export const JOURNEY_STAGES=['A1','A2','A3','A4'] as const;
export type JourneyStage=typeof JOURNEY_STAGES[number];
export type JourneyFact={id:string;kind:string;sourceId?:string;fact:Fact&{resolved_customer_id?:string|null}};
export type JourneyTransition={from:JourneyStage;to:JourneyStage;customers:number;matureCustomers:number;convertedCustomers:number|null;immatureCustomers:number;rate:number|null;reason:string|null};
type Period={start:string;end:string;counts:Record<JourneyStage,number|null>;transitions:JourneyTransition[]};
export type CustomerJourney={version:'customer-journey-v1';snapshotId:string;businessId:string;dataNature:string;period:Period;recent:Period|null;previous:Period|null;changes:Array<{stage:JourneyStage;current:number|null;previous:number|null;change:number|null}>;weekly:Array<{start:string;end:string;counts:Record<JourneyStage,number|null>}>;rule:{days:number;channelPolicy:string;observationEnd:string}|null;evidenceId:string|null;limitations:string[]};
const plus=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const stageOf=(row:JourneyFact):JourneyStage|undefined=>{const stage=row.kind==='orders'&&row.fact.entry_type==='paid'?'A4':row.kind==='events'?eventStages[row.fact.event_type!]:undefined;return JOURNEY_STAGES.includes(stage as JourneyStage)?stage as JourneyStage:undefined;};

// Work only on the immutable, authorized snapshot input. Never read later
// imports, infer customer IDs from contacts, or divide events by orders.
export function customerJourney(s:Snapshot,input:JourneyFact[]):CustomerJourney{
 const links=new Map(s.data.materials?.customerLinks?.map(x=>[x.factId,x.customerId])??[]);
 const identity=(r:JourneyFact)=>links.has(r.id)?links.get(r.id):r.fact.resolved_customer_id??null;
 const observationEnd=s.periodEnd<s.asOf?s.periodEnd:s.asOf;
 const rows=input.filter(r=>stageOf(r)&&r.fact.business_date>=s.periodStart&&r.fact.business_date<=observationEnd&&(!s.productId||r.fact.product_id===s.productId)&&(!s.channel||r.fact.channel===s.channel)).sort((a,b)=>a.fact.occurred_at.localeCompare(b.fact.occurred_at)||a.id.localeCompare(b.id));
 const configured=s.data.materials?.customerAnalysis.rule;
 const covered=(kind:'events'|'orders',start:string,end:string)=>{
  if(start>end)return false;
  const spans=(s.coverage??[]).filter(x=>x.kind===kind),sources=new Set([...spans.map(x=>x.sourceId),...rows.filter(x=>x.kind===kind&&x.sourceId).map(x=>x.sourceId!)]);
  return sources.size>0&&[...sources].every(source=>{let next=start;for(const span of spans.filter(x=>x.sourceId===source).sort((a,b)=>a.start.localeCompare(b.start))){if(span.start<=next&&span.end>=next)next=plus(span.end,1);}return next>end;});
 };
 const stageCounts=(start:string,end:string):Period['counts']=>Object.fromEntries(JOURNEY_STAGES.map(stage=>{const xs=rows.filter(r=>r.fact.business_date>=start&&r.fact.business_date<=end&&stageOf(r)===stage);const observed=xs.length>0||!s.productId&&!s.channel;return [stage,observed&&covered(stage==='A4'?'orders':'events',start,end)&&xs.every(identity)?new Set(xs.map(identity)).size:null];})) as Period['counts'];
 const period=(start:string,end:string):Period=>{
  const within=rows.filter(r=>r.fact.business_date>=start&&r.fact.business_date<=end);
  const counts=stageCounts(start,end);
  const transitions=JOURNEY_STAGES.slice(0,3).map((from,i):JourneyTransition=>{
   const to=JOURNEY_STAGES[i+1],anchors=new Map<string,JourneyFact>();
   for(const r of within.filter(r=>stageOf(r)===from)){const id=identity(r);if(id&&!anchors.has(id))anchors.set(id,r);}
   // Both comparison windows stop at their own end, giving the cohorts the
   // same observation opportunity rather than extra weeks for the old one.
   const mature=configured?[...anchors].filter(([,r])=>plus(r.fact.business_date,configured.conversionWindowDays)<=end):[];
   const candidates=within.filter(r=>stageOf(r)===to);
   const coverage=covered('events',start,end)&&covered(to==='A4'?'orders':'events',start,end);
   const identified=within.filter(r=>stageOf(r)===from).every(identity)&&candidates.every(identity);
   const channelsKnown=configured?.channelPolicy!=='same_channel'||within.filter(r=>stageOf(r)===from||stageOf(r)===to).every(r=>!!r.fact.channel);
   const scopedTarget=candidates.length>0||!s.productId&&!s.channel;
   const reason=!configured?'尚未设置观察规则':!coverage||!scopedTarget?'这段时间的记录不完整':!identified?'部分记录还未关联客户':!channelsKnown?'部分记录缺少渠道信息':!mature.length?'客户尚未完成观察':null;
   const converted=reason?null:mature.filter(([id,r])=>candidates.some(p=>identity(p)===id&&p.fact.occurred_at>=r.fact.occurred_at&&p.fact.business_date<=plus(r.fact.business_date,configured!.conversionWindowDays)&&(configured!.channelPolicy==='any'||p.fact.channel===r.fact.channel))).length;
   return {from,to,customers:anchors.size,matureCustomers:mature.length,convertedCustomers:converted,immatureCustomers:anchors.size-mature.length,rate:converted==null?null:converted/mature.length,reason};
  });
  return {start,end,counts,transitions};
 };
 const full=period(s.periodStart,observationEnd),weeks=(s.data.weeks??[]).filter(w=>w.start>=s.periodStart&&w.end<=observationEnd&&Date.parse(w.end)-Date.parse(w.start)===6*86400000);
 const recent=weeks.length>=8?period(weeks.at(-4)!.start,weeks.at(-1)!.end):null;
 const previous=weeks.length>=8?period(weeks.at(-8)!.start,weeks.at(-5)!.end):null;
 return {version:'customer-journey-v1',snapshotId:s.id,businessId:s.businessId,dataNature:s.dataNature,period:full,recent,previous,changes:JOURNEY_STAGES.map(stage=>{const current=recent?.counts[stage]??null,prior=previous?.counts[stage]??null;return {stage,current,previous:prior,change:current!=null&&prior!=null&&prior>0?(current-prior)/prior:null};}),weekly:weeks.map(w=>({start:w.start,end:w.end,counts:stageCounts(w.start,w.end)})),rule:configured?{days:configured.conversionWindowDays,channelPolicy:configured.channelPolicy,observationEnd}:null,evidenceId:s.evidenceIds.customerJourney??`${s.id}:view:customer-journey`,limitations:['各阶段按已关联身份去重，同一客户可在不同阶段出现；购买为支付客户，不扣减退款。','每个环节取统计期内客户首次进入该阶段的记录，依次观察下一阶段；只统计完成观察窗口的客户。','每个比较窗口各自留出完整观察时间，截止于该窗口结束；期末未完成观察的客户不作失败转化。','近期比较使用最近四个完整周与此前四个完整周；缺少覆盖或身份关联时不计算比率。']};
}
