import {currentBusinessGeneration} from './business-head.ts';
import type {Context} from './auth.ts';
import {first} from './store.ts';
import {assert} from './errors.ts';
import {loadGeneration,generationSummary} from './generation-storage.ts';
import {operatingReviews} from './business-reviews.ts';
import {businessJourney} from '../lib/business-journey.ts';
import type {PlatformSettings} from '../lib/platform-settings.ts';
import type {Metric} from '../lib/business-metrics.ts';
import {buildBusinessState} from '../lib/business-state.ts';
// Pure projection over an immutable generation: pages, facts and AI use the
// same input cutoff; no inference/forecast creation or dispatch on this GET.
const compactMetrics=(metrics:Record<string,Metric>)=>Object.fromEntries(Object.entries(metrics).map(([key,m])=>[key,{...m,evidenceCount:m.evidenceIds.length,evidenceIds:m.evidenceIds.slice(0,20)}]));
export async function businessWorkbench(ctx:Context,nature:string,id?:string){
 const row=id?await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_generations WHERE business_id=? AND data_nature=? AND id=?',ctx.businessId,nature,id):await currentBusinessGeneration(ctx,nature);assert(row,404,'GENERATION','当前企业暂无已计算的经营代次');
 const g=await loadGeneration(ctx,nature,row.payload),s=g.state,configuration=g.configuration as {settings:PlatformSettings},journey=businessJourney(s,configuration.settings.customerFunnel);
 const revenueKind=s.profile.industry==='hotel'?'hotel_stay':'order';
 const channels=[...new Set(s.inputs.filter(r=>[revenueKind,'event','expense'].includes(r.kind)&&r.channelId).map(r=>r.channelId!))].map(channelId=>({channelId,metrics:buildBusinessState({...s,start:s.period.start,end:s.period.end},s.inputs.filter(r=>r.channelId===channelId),s.coverage).metrics}));
 for(const t of journey.transitions)t.metric={...t.metric,evidenceIds:t.metric.evidenceIds.slice(0,20)};
 for(const channel of channels)channel.metrics=compactMetrics(channel.metrics);
 const reviews=await operatingReviews(ctx,nature,g.id);
 const unallocatedSpend=s.inputs.some(r=>r.kind==='expense'&&!r.channelId&&r.businessDate>=s.period.start&&r.businessDate<=s.period.end);
 if(unallocatedSpend)for(const channel of channels){channel.metrics.spendCents={...channel.metrics.spendCents,value:null,status:'partial',reason:'存在未归属渠道的费用，不能视为该渠道零费用'};channel.metrics.contributionMarginCents={...channel.metrics.contributionMarginCents,value:null,status:'partial',reason:'渠道费用归属未完整确认'};}
 const days=new Map<string,{date:string;fulfilled:number;unmet:number;netRevenueCents:number}>();
 for(const point of g.baseline.points){const d=days.get(point.date)??{date:point.date,fulfilled:0,unmet:0,netRevenueCents:0};d.fulfilled+=point.fulfilled;d.unmet+=point.unmet;d.netRevenueCents+=point.revenueCents;days.set(point.date,d);}
 const weeks=[];for(let start=s.period.start;start<=s.period.end;){const end=new Date(Date.parse(start)+6*86400000).toISOString().slice(0,10),cut=end>s.period.end?s.period.end:end;weeks.push({start,end:cut,metrics:compactMetrics(buildBusinessState({...s,start,end:cut},s.inputs,s.coverage).metrics)});start=new Date(Date.parse(start)+7*86400000).toISOString().slice(0,10);}

 const stock=s.inputs.filter(r=>['inventory','material_inventory'].includes(r.kind)&&r.businessDate<=s.asOf);const latest=new Map<string,typeof stock[number]>();for(const r of stock.sort((a,b)=>a.businessDate.localeCompare(b.businessDate)||a.knownAt.localeCompare(b.knownAt)))latest.set(JSON.stringify([r.kind,r.entityId,r.warehouseId]),r);
 return {permissions:{canWrite:ctx.role!=="reader",canSaveDecision:ctx.role==="admin"},pipeline:g.steps.map(step=>step.name==='page-projection'?{...step,status:'completed',dependencies:['metrics']}:['joint-review','specialist-reviews'].includes(step.name)?{...step,status:reviews.status==='completed'?'completed':reviews.status==='failed'?'blocked':'pending'}:step),generation:generationSummary(g),journey,channels,reviews,weeks,entities:[...new Set(s.inputs.filter(r=>r.kind===revenueKind).map(r=>r.entityId))],forecastDays:[...days.values()],supply:{unit:g.baseline.unit,positionCount:latest.size,positions:[...latest.values()].slice(0,100),capacity:s.inputs.filter(r=>r.kind==='hotel_capacity'&&r.businessDate>s.asOf).slice(0,100),constraints:g.baseline.feasibility,planned:g.state.inputs.filter(r=>['arrival','production','hotel_reservation'].includes(r.kind)&&r.status==='planned').slice(0,100)},notice:'判断与推演绑定本代次；保存方案不表示已执行，资料不足保持未知。'};
}
