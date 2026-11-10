import type {Snapshot} from './contracts.ts';
import {customerJourney,JOURNEY_STAGES,type JourneyFact,type JourneyStage,type JourneyTransition} from './customer-journey.ts';
import {assert} from './errors.ts';
import {eventStages} from './templates.ts';

const labels={A1:'了解',A2:'互动',A3:'意向',A4:'购买'};
const plus=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export type PulseStage={stage:JourneyStage;name:string;customers:number|null;previousCustomers:number|null;difference:number|null;change:number|null;index:number|null};
export type CustomerPulse={version:'customer-pulse-v1';start:string;end:string;previousWeek:{start:string;end:string}|null;focus:JourneyStage|null;stages:PulseStage[];judgment:{title:string;summary:string;nextStep:string};observations:string[];conversion:{start:string;end:string;previousStart:string|null;previousEnd:string|null;transitions:Array<JourneyTransition&{previousRate:number|null;difference:number|null}>}|null;rule:{days:number;channelPolicy:string}|null;limitations:string[];sourcePeriods:Array<{start:string;end:string}>};
const quantity=(n:number|null)=>n==null?'资料不足':`${n} 人`;
const movement=(s:PulseStage)=>s.difference==null?'缺少上周对照':s.difference===0?'与上周相同':`较上周${s.difference>0?'增加':'减少'} ${Math.abs(s.difference)} 人`;

// The graph point selects an actual completed week. All diagnostics below
// reuse the frozen customer identity and mature-window calculation; later
// weeks cannot change the rolling conversion context of an earlier point.
export function customerPulse(s:Snapshot,facts:JourneyFact[],start:string,focus?:string){
 assert(!focus||JOURNEY_STAGES.includes(focus as JourneyStage),404,'NOT_FOUND','客户阶段不在当前范围');
 const journey=s.data.customerJourney??customerJourney(s,facts),index=journey.weekly.findIndex(w=>w.start===start);
 assert(index>=0,404,'NOT_FOUND','本范围没有这个完整统计周');
 const week=journey.weekly[index],candidate=journey.weekly[index-1],previous=candidate&&plus(candidate.end,1)===week.start?candidate:null;
 const base=journey.weekly.slice(0,4),baselineComplete=base.length===4&&base.every((w,i)=>i===0||plus(base[i-1].end,1)===w.start);
 const stages=JOURNEY_STAGES.map((stage):PulseStage=>{
  const customers=week.counts[stage],previousCustomers=previous?.counts[stage]??null,baseValues=base.map(w=>w.counts[stage]);
  const mean=baselineComplete&&baseValues.every(v=>v!=null)?baseValues.reduce((a,b)=>a+b!,0)/4:null;
  return {stage,name:labels[stage],customers,previousCustomers,difference:customers!=null&&previousCustomers!=null?customers-previousCustomers:null,change:customers!=null&&previousCustomers!=null&&previousCustomers>0?(customers-previousCustomers)/previousCustomers:null,index:customers!=null&&mean!=null&&mean>0?customers/mean*100:null};
 });
 const history=journey.weekly.slice(0,index+1),tail=history.slice(-8),consecutive=tail.every((w,i)=>i===0||plus(tail[i-1].end,1)===w.start);
 const window=(weeks:typeof history)=>customerJourney({...s,periodStart:weeks[0].start,periodEnd:weeks.at(-1)!.end,data:{...s.data,weeks:s.data.weeks.filter(w=>w.start>=weeks[0].start&&w.end<=weeks.at(-1)!.end)}},facts).period;
 const currentWeeks=history.slice(-4),current=consecutive&&currentWeeks.length===4?window(currentWeeks):null;
 const previousWeeks=history.slice(-8,-4),prior=consecutive&&previousWeeks.length===4?window(previousWeeks):null;
 const conversion=current?{start:current.start,end:current.end,previousStart:prior?.start??null,previousEnd:prior?.end??null,transitions:current.transitions.map((t,i)=>({...t,previousRate:prior?.transitions[i].rate??null,difference:t.rate!=null&&prior?.transitions[i].rate!=null?(t.rate-prior.transitions[i].rate!)*100:null}))}:null;
 const [aware,interest,intent,paid]=stages,missing=stages.filter(x=>x.customers==null),ranked=stages.filter(x=>x.difference!=null&&x.difference!==0).sort((a,b)=>Math.abs(b.difference!)-Math.abs(a.difference!));
 let title='本周各阶段客户人数与上周相同',nextStep='继续按同一客户身份和观察规则跟踪；人数稳定不代表所有客户都顺利转化。';
 if(missing.length){title='本周部分阶段资料不足';nextStep=`先补齐${missing.map(x=>x.name).join('、')}阶段的记录覆盖或客户身份关联，再判断变化。`;}
 else if(!previous){title='本周客户旅程已记录，缺少上周对照';nextStep='补齐相邻完整周后再判断客户变化；当前人数不直接代表阶段转化率。';}
 else if(stages.some(x=>x.previousCustomers==null)){title='本周已记录，上周部分阶段资料不足';nextStep='先补齐上周的记录覆盖或身份关联，再比较完整客户旅程。';}
 else if(intent.difference!>0&&paid.difference!<0){title='意向客户增加，购买客户减少';nextStep='先按商品和渠道核查意向客户的后续支付与观察进度，再联查客服承接和可售库存。';}
 else if(aware.difference!>0&&interest.difference!<0){title='了解客户增加，互动客户减少';nextStep='先按渠道核查新增了解客户是否继续互动，再看内容、商品和活动的变化。';}
 else if(interest.difference!>0&&intent.difference!<0){title='互动客户增加，意向客户减少';nextStep='先按商品和渠道核查互动客户是否继续咨询或留资，再看咨询入口与响应。';}
 else if(paid.difference!<0){title=intent.difference!<0?'意向与购买客户同步减少':'购买客户减少，需核查承接';nextStep='先拆分商品和渠道，核对购买减少是否与意向变化集中在同一范围，再联查供给与客服承接。';}
 else if(paid.difference!>0){title='购买客户增加，先确认增量来源';nextStep='核对新增支付客户集中在哪些商品和渠道，再结合成熟转化判断增长能否延续。';}
 else if(ranked[0]){title=`${ranked[0].name}客户${ranked[0].difference!>0?'增加':'减少'}，购买人数持平`;nextStep='按商品和渠道核查变化最大的阶段，结合后续成熟转化观察，先不把人数变化当成流失。';}
 const highlighted=intent.difference!>0&&paid.difference!<0?[intent,paid]:aware.difference!>0&&interest.difference!<0?[aware,interest]:interest.difference!>0&&intent.difference!<0?[interest,intent]:intent.difference!<0&&paid.difference!<0?[intent,paid]:paid.difference!=null&&paid.difference!==0?[paid,ranked.find(x=>x.stage!=='A4')??intent]:ranked.length?ranked.slice(0,2):[intent,paid];
 const explained=missing.length?`${missing.map(x=>x.name).join('、')}阶段不能完整计算；缺项不按零处理。`:previous?highlighted.map(x=>`${x.name}客户 ${quantity(x.previousCustomers)} → ${quantity(x.customers)}，${movement(x)}`).join('；')+'。':stages.map(x=>`${x.name} ${quantity(x.customers)}`).join('、')+'。';
 const observations:string[]=[];
 const changed=conversion?.transitions.filter(t=>t.difference!=null&&Math.abs(t.difference)>=.05).sort((a,b)=>Math.abs(b.difference!)-Math.abs(a.difference!))[0];
 if(changed)observations.push(`截至本周的近四周，${labels[changed.from]} → ${labels[changed.to]}成熟转化率 ${(changed.previousRate!*100).toFixed(1)}% → ${(changed.rate!*100).toFixed(1)}%，${changed.difference!>0?'上升':'下降'} ${Math.abs(changed.difference!).toFixed(1)} 个百分点；当前完成观察 ${changed.matureCustomers} 人。`);
 else if(conversion&&!prior)observations.push('已有截至本周的近四周成熟转化；缺少再前四周的完整资料，暂不比较转化变化。');
 else if(conversion&&conversion.transitions.every(t=>t.rate!=null&&t.previousRate!=null))observations.push('前后两个四周的成熟转化率没有可显示到一位小数的变化。');
 else observations.push('成熟转化的观察时间、身份关联或资料覆盖不足，暂不能确认承接是否变化。');
 const periods=[week,...(previous?[previous]:[]),...(baselineComplete?[{start:base[0].start,end:base.at(-1)!.end}]:[]),...(current?[current]:[]),...(prior?[prior]:[])].map(w=>({start:w.start,end:w.end}));
 const pulse:CustomerPulse={version:'customer-pulse-v1',start:week.start,end:week.end,previousWeek:previous?{start:previous.start,end:previous.end}:null,focus:(focus as JourneyStage)||null,stages,judgment:{title,summary:explained,nextStep},observations,conversion,rule:journey.rule?{days:journey.rule.days,channelPolicy:journey.rule.channelPolicy}:null,limitations:['人数按已关联客户身份去重，同一客户可在多个阶段出现；阶段总人数不能直接相除当成转化率。','本周变化与紧邻的上一个完整周比较；图表指数以统计期前四个完整周的平均人数为 100。','转化核查使用截至所点周的四周成熟观察窗口，前期也各自截止于期末；尚未完成观察的客户不计作流失。','阶段人数同期变化只能指出核查方向，不能证明客服、库存、投放等因素造成了变化。'],sourcePeriods:periods};
 const rows=facts.filter(r=>(!s.productId||r.fact.product_id===s.productId)&&(!s.channel||r.fact.channel===s.channel)&&periods.some(w=>r.fact.business_date>=w.start&&r.fact.business_date<=w.end)&&(r.kind==='orders'?r.fact.entry_type==='paid':r.kind==='events'&&['A1','A2','A3'].includes(eventStages[r.fact.event_type!]??'')));
 return {pulse,rows};
}
