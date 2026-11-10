import type {Snapshot} from './contracts.ts';
import type {HomeSections} from './home-sections.ts';

const DAY=86400000;
const day=(value:string|null|undefined)=>{
 const date=value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
 return date&&Number.isFinite(Date.parse(value!))&&new Date(Date.parse(date)).toISOString().slice(0,10)===date?date:null;
};
// Align by business dates, never by the position of independently collected
// series. Reading a source today does not make it historical evidence.
export function operatingTimeline(s:Snapshot,sections:HomeSections){
 const weeks=s.data.weeks.filter(w=>w.start>=s.periodStart&&w.end<=s.periodEnd&&w.end<=s.asOf&&Date.parse(w.end)-Date.parse(w.start)===6*DAY).sort((a,b)=>a.start.localeCompare(b.start)).slice(-8);
 const people=sections.people,goods=sections.goods;
 const align=(series:HomeSections['people']['series']|HomeSections['goods']['series'],sourceWeeks:Array<{start:string}>)=>series.map(row=>({...row,
  values:weeks.map(w=>{const index=sourceWeeks.findIndex(p=>p.start===w.start);return index<0?null:row.values[index]??null;}),
 }));
 const customer=align(people.series??[],people.weeks??[]),supply=align(goods.series??[],goods.weeks??[]);
 const consecutive=weeks.length>=3&&weeks.slice(-3).every((w,i,tail)=>i===0||Date.parse(w.start)-Date.parse(tail[i-1].end)===DAY);
 const intent=customer.find(r=>r.id==='A3')?.values,purchase=customer.find(r=>r.id==='A4')?.values;
 const defined=(values:Array<number|null>|undefined)=>!!values&&values.length>=3&&values.slice(-3).every(n=>n!=null&&Number.isFinite(n));
 const conversionGap=consecutive&&defined(intent)&&defined(purchase)&&[weeks.length-2,weeks.length-1].every(i=>intent![i]!>intent![i-1]!&&purchase![i]!<purchase![i-1]!);
 const constrained=supply.filter(row=>consecutive&&s.data.materials?.supply.ruleStatus==='configured'&&row.values.slice(-2).length===2&&row.values.slice(-2).every(n=>n!=null&&n<100)).sort((a,b)=>a.values.at(-1)!-b.values.at(-1)!);
 const signals=[...conversionGap?[{domain:'people' as const,seriesId:'A4',label:'连续两周意向增、购买降',evidenceId:`${s.id}:view:customer-pulse:${weeks.at(-1)!.start}`}]:[],...constrained.length?[{domain:'goods' as const,seriesId:constrained[0].id,label:`${constrained.map(r=>r.name).join('、')}连续两周低于参考目标`,evidenceId:`${s.id}:view:supply-pulse:${weeks.at(-1)!.start}`}]:[]];
 const events:Array<{id:string;evidenceId:string;date:string;weekIndex:number;summary:string;publisher:string}>=[],observations:Array<HomeSections['market']['sources'][number]&{date:string|null;dateLabel:string;reason:string}>=[];
 for(const source of sections.market.sources??[]){
  const published=day(source.publishedAt),retrieved=day(source.retrievedAt),index=published?weeks.findIndex(w=>published>=w.start&&published<=w.end):-1;
  if(index>=0&&source.timing==='historical'&&retrieved&&retrieved<=s.asOf){events.push({id:source.id,evidenceId:source.evidenceId,date:published!,weekIndex:index,summary:source.summary,publisher:source.publisher});}
  else observations.push({...source,date:published,dateLabel:published?`${published.slice(5)} · 发布`:`${retrieved?.slice(5)??'日期待核'} · 读取`,reason:!published?'发布日期待核，不能定位历史周':index>=0?'期间发布，后续读取':'共同时间轴之外的观察'});
 }
 return {version:'operating-timeline-v1',businessId:s.businessId,dataNature:s.dataNature,snapshotId:s.id,
  weeks:weeks.map((w,i)=>({...w,label:`${i+1}周`,date:w.start.slice(5).replace('-','.'),peopleEvidenceId:`${s.id}:view:customer-pulse:${w.start}`,supplyEvidenceId:`${s.id}:view:supply-pulse:${w.start}`})),
  people:customer,supply,signals,highlightLastTwo:weeks.length===8&&signals.length>0,
  events:events.sort((a,b)=>a.date.localeCompare(b.date)),observations,
  note:'近八个完整周；人、货与市场共用日期刻度。客户指数沿用统计期前四周均值100，供给按已保存参考规则计算。',
  marketNote:'仅把期间发布、且截至经营资料日期已读取的来源定位到历史周；后续读取或日期待核的原文单独展示。'};
}
export type OperatingTimeline=ReturnType<typeof operatingTimeline>;
