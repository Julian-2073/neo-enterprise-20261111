import type {Snapshot,Fact,Batch,StoredFact} from './contracts.ts';
import type {ForecastResult} from './agent-contracts.ts';
import {calculate,addDays} from './snapshots.ts';
import {customerJourney} from './customer-journey.ts';
export type EvidenceFact={id:string;kind:string;sourceId?:string;fact:Fact};
export type EvidenceMetric={label:string;value:number|null;unit:string;previous?:number|null;change?:number|null};
export type EvidenceAnalysis={version:'evidence-analysis-v1';judgment:{title:string;summary:string;nextStep:string};metrics:EvidenceMetric[];observations:string[];comparisonPeriod?:string;limitations:string[]};
export type AnalyzedEvidence={id:string;title:string;value:unknown;unit:string;periodStart:string;periodEnd:string;formula:string;limitations:string[]};
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const money=(v:number|null)=>v==null?'资料不足':`¥${(v/100).toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
const percent=(v:number|null)=>v==null?'资料不足':`${(v*100).toFixed(1)}%`;
const labels:Record<string,string>={events:'意向行为',paidOrders:'支付订单',netRevenueCents:'净成交额',spendCents:'投放费用',variableCostCents:'商品及履约成本',contributionMarginCents:'贡献毛利',paidUnits:'支付出库',A1:'了解行为',A2:'互动行为',A3:'意向行为',A5:'关系行为',sellable_units:'可售库存',in_transit_units:'在途库存',inventory_cost_cents:'库存成本货值',safety_units:'已设定备货目标'};
const unit=(key:string)=>key.endsWith('Cents')||key.endsWith('_cents')?'人民币分':key==='paidOrders'?'笔':key.startsWith('A')||key==='events'?'次':'件';
export function financialWindow(s:Snapshot,facts:EvidenceFact[],start:string,end:string,product=s.productId,channel=s.channel){
 const rows=facts.filter(r=>(!product||r.fact.product_id===product)&&(!channel||r.fact.channel===channel));
 const prepared=rows.map(r=>({...r,fact:{...r.fact,variable_cost_cents:r.fact.variable_cost_cents??null},kind:r.kind,source_id:r.sourceId??'',batch_id:'',row_number:0,record_key:r.id,content_hash:'',payload:''})) as Array<StoredFact&{fact:Fact}>;
 const batches=(s.coverage??[]).map(c=>({kind:c.kind,source_id:c.sourceId,coverage_start:c.start,coverage_end:c.end})) as Batch[];
 const result=calculate(prepared,batches,start,end,!product&&!channel);
 const orders=rows.filter(r=>r.kind==='orders'&&r.fact.entry_type==='paid'&&r.fact.business_date>=start&&r.fact.business_date<=end);
 return {...result.financial,...result.events,paidUnits:result.financial.paidOrders==null||orders.some(r=>r.fact.quantity==null)?null:orders.reduce((n,r)=>n+(r.fact.quantity??0),0)};
}
export function analyzeEvidence(s:Snapshot,e:AnalyzedEvidence,facts:EvidenceFact[]):EvidenceAnalysis{
 const value=e.value&&typeof e.value==='object'?e.value as Record<string,unknown>:{};
 const a:EvidenceAnalysis={version:'evidence-analysis-v1',judgment:{title:'已保存经营依据',summary:'先核对当前范围的关键数字，再决定下一步。',nextStep:'按同一商品、渠道和期间核查，补齐资料后再作经营调整。'},metrics:[],observations:[],limitations:e.limitations};
 const key=e.id.split(':').at(-1)!;
 if(key==='customerJourney'||key==='customer-journey'||key==='customerAnalysis'||key==='operatingPulse'){
  const j=s.data.customerJourney??customerJourney(s,facts),p=j.recent??j.period,prior=j.previous;
  a.metrics=Object.entries(p.counts).map(([stage,n])=>({label:{A1:'了解客户',A2:'互动客户',A3:'意向客户',A4:'购买客户'}[stage]!,value:n,unit:'人',previous:prior?.counts[stage as 'A1']??null}));
  const t=p.transitions[2],old=prior?.transitions[2].rate??null;
  a.judgment={title:p.counts.A4==null?'购买客户资料不足':prior?.counts.A4!=null?`购买客户${p.counts.A4>prior.counts.A4?'增加':p.counts.A4<prior.counts.A4?'减少':'持平'}，结合成熟转化核查`:'客户旅程已记录，前期对照不足',summary:`了解、互动、意向、购买分别为 ${Object.values(p.counts).map(n=>n==null?'资料不足':`${n} 人`).join('、')}；意向到购买成熟转化为 ${percent(t.rate)}。`,nextStep:'先按商品和渠道核查变化集中的旅程阶段，再联查客服和库存；未完成观察不当作流失。'};
  a.judgment.summary=`${p.start} 至 ${p.end}：${a.judgment.summary}`;if(prior)a.comparisonPeriod=`${prior.start} 至 ${prior.end}`;
  a.observations=[old!=null&&t.rate!=null?`意向到购买成熟转化由 ${percent(old)} 变为 ${percent(t.rate)}，完成观察 ${t.matureCustomers} 人。`:'缺少完整的身份、观察窗口或前期对照，暂不判断转化变化。'];a.limitations=j.limitations;return a;
 }
 if(key==='supply'||e.id.includes(':view:supply-pulse:')){
  const supply=s.data.materials?.supply;
  const start=e.id.includes(':view:supply-pulse:')?e.periodStart:null;
  const index=s.data.weeks.findIndex(w=>w.start===start),prior=index>0&&addDays(s.data.weeks[index-1].end,1)===start?s.data.weeks[index-1]:null;
  const roles=(supply?.roles??[]).map(r=>{const p=start?r.weekly.find(w=>w.start===start):r,previous=prior?r.weekly.find(w=>w.start===prior.start):null;return {r,p,previous};});
  a.metrics=roles.map(({r,p,previous})=>({label:String(s.domain?.roles.find(x=>x.id===r.roleId)?.name??'货盘')+'供给达标率',value:p?.qualifiedRatio??null,unit:'比例',previous:previous?.qualifiedRatio??null}));
  const known=roles.filter(x=>x.p?.qualifiedRatio!=null),drops=known.filter(x=>x.previous?.qualifiedRatio!=null&&x.p!.qualifiedRatio!<x.previous.qualifiedRatio);
  a.judgment={title:!known.length?'供给规则或历史库存不足':drops.length?'部分货盘供给达标率下降':'供给达标率已核算，继续核查缺货规格',summary:roles.map(({r,p})=>`${String(s.domain?.roles.find(x=>x.id===r.roleId)?.name??'货盘')}：${p?.qualifiedSkuCount??'未知'} / ${p?.observedSkuCount??0} 个已观测规格达标，比例 ${percent(p?.qualifiedRatio??null)}`).join('；')||'尚未取得有效供给规则和规格库存。',nextStep:'优先核查未达标规格所在仓库的可售及到货，确认目标后再决定调拨或补货。'};
  a.observations=['按明确备货规则计算；缺失规格或安全库存时不把缺项算成零，在途不计入当前可售。'];a.limitations=supply?.limitations??e.limitations;if(prior)a.comparisonPeriod=`${prior.start} 至 ${prior.end}`;return a;
 }
 if(key==='inventoryCostCents'||e.id.includes(':stock-')||e.id.includes(':view:inventory:')){
  const product=e.id.includes(':view:inventory:')?decodeURIComponent(key):null;
  const stock=s.data.inventory.filter(x=>!product||x.product_id===product).filter(x=>!e.id.includes(':stock-')||e.id===x.evidenceId);
  const sum=(k:keyof Fact)=>stock.length&&stock.every(x=>typeof x[k]==='number')?stock.reduce((n,x)=>n+Number(x[k]),0):null;
  const sellable=sum('sellable_units'),target=sum('safety_units'),cost=sum('inventory_cost_cents');const zero=stock.filter(x=>x.sellable_units===0).length;
  a.metrics=['sellable_units','in_transit_units','safety_units','inventory_cost_cents'].map(k=>({label:labels[k],value:sum(k as keyof Fact),unit:unit(k)}));
  a.judgment={title:sellable==null?'库存资料不足':zero?'部分仓库规格没有可售库存':target!=null&&sellable<target?'可售低于已设定备货目标':'可售已记录，核查各仓规格分布',summary:`已保存 ${stock.length} 处仓库与规格库存；可售 ${sellable??'未知'} 件，${zero} 处为零，库存成本货值 ${money(cost)}。`,nextStep:'先核对缺货规格的仓库、可售和预计到货，再判断是否调拨或补货；各渠道共享库存。'};
  a.observations=[target==null?'备货目标未完整设置，暂不判断安全库存是否达标。':`可售 ${sellable??'未知'} 件，对照已设定目标 ${target} 件；目标需业务确认。`,'在途只是待到货数量，不直接增加当前可售。'];return a;
 }
 const point=e.id.includes(':view:week:');
 const args=point?e.id.slice(e.id.indexOf(':view:week:')+11).split(':').map(decodeURIComponent):[];
 const pointKey=point?(args[1]==='A4'?'paidOrders':args[1]):null;
 let current:Record<string,unknown>=value.financial&&typeof value.financial==='object'?{...value.financial as Record<string,unknown>,...value.events as Record<string,unknown>}:Object.keys(value).length?value:{[pointKey??key]:e.value};
 if(e.id.includes(':channel-'))current=s.data.channels.find(x=>x.evidenceId===e.id)?{...value}:current;
 let previous:Record<string,unknown>|null=null;
 if(point){const i=s.data.weeks.findIndex(w=>w.start===e.periodStart),p=s.data.weeks[i-1];if(p&&addDays(p.end,1)===e.periodStart){previous=financialWindow(s,facts,p.start,p.end,args[2]||s.productId,args[3]||s.channel);a.comparisonPeriod=`${p.start} 至 ${p.end}`;}}
 a.metrics=Object.entries(current).filter(([k])=>labels[k]).map(([k,v])=>({label:labels[k],value:number(v),unit:unit(k),...(previous?{previous:number(previous[k])}: {})}));
 const paid=number(current.paidOrders),revenue=number(current.netRevenueCents),spend=number(current.spendCents),margin=number(current.contributionMarginCents);
 if(point&&pointKey){const metric=a.metrics[0],old=previous?number(previous[pointKey]):null,n=number(e.value);a.judgment={title:n==null?'本周指标资料不足':old==null?'本周已记录，缺少完整上周对照':`${metric?.label??e.title}${n>old?'增加':n<old?'减少':'持平'}`,summary:`${metric?.label??e.title}：${n==null?'资料不足':unit(pointKey)==='人民币分'?money(n):`${n} ${unit(pointKey)}`}${old!=null?`；上周 ${unit(pointKey)==='人民币分'?money(old):`${old} ${unit(pointKey)}`}`:''}。`,nextStep:'先按商品和渠道定位变化，再核对对应订单、退款或行为记录；同期变化不直接解释原因。'};}
 else if(a.metrics.length)a.judgment={title:margin!=null&&margin<0?'当前贡献毛利为负，先核查费用与成本':revenue!=null&&revenue<0?'退款金额超过本期支付金额':paid==null&&revenue==null&&spend==null?'该指标已记录，仍需核对经营范围':'订单与投入已核算，关注成交与费用匹配',summary:a.metrics.slice(0,4).map(m=>`${m.label} ${m.unit==='人民币分'?money(m.value):m.value==null?'资料不足':`${m.value} ${m.unit}`}`).join('；')+'。',nextStep:'核对同一商品、渠道和期间的支付、退款、投放与成本，再判断投入是否值得继续。'};
 else a.judgment={title:'当前依据尚不足以形成经营判断',summary:'资料已保存，但缺少可比较的经营指标。',nextStep:'补齐相关业务记录与统计规则，再重新计算。'};
 a.observations=[revenue!=null&&spend!=null&&revenue>0?`投放费用占净成交 ${percent(spend/revenue)}；这是费用比例，不是投放带来的增量收益。`:'费用、成交或完整对照不足，暂不判断投入效率。','行为次数、订单笔数和客户人数分别计算；退款按发生日期扣减。'];return a;
}
export function analyzeForecast(f:ForecastResult,start:string):EvidenceAnalysis{
 const i=f.weeks.findIndex(w=>w.start===start),w=f.weeks[i],prior=f.weeks[i-1];
 const a:EvidenceAnalysis={version:'evidence-analysis-v1',judgment:{title:w.unmetUnits>0?'供给条件限制了这一周的预计销量':'这一周预计销量已计算',summary:`预计支付出库 ${w.units} 件，未承接需求 ${w.unmetUnits} 件，期末可售 ${w.endingUnits} 件。`,nextStep:'先核查缺口规格的可售、到货时间与方案条件，再比较补货、调拨或投放调整的结果。'},metrics:[{label:'预计支付出库',value:w.units,unit:'件',previous:prior?.units??null},{label:'未承接需求',value:w.unmetUnits,unit:'件'},{label:'净成交额',value:w.netRevenueCents,unit:'人民币分'},{label:'贡献毛利',value:w.contributionMarginCents,unit:'人民币分'},{label:'期末可售',value:w.endingUnits,unit:'件'}],observations:[`该周贡献毛利 ${money(w.contributionMarginCents)}。`,'结果来自同一保存基线及成立条件，是条件推演，不是实际成交或收益。'],limitations:f.limitations};if(f.forecastCoverage?.status==='partial')a.observations.unshift('只估算具有可用销售历史的规格，尚未覆盖完整潜在需求。');if(prior)a.comparisonPeriod=`${prior.start} 至 ${prior.end}（前一预测周）`;return a;
}
