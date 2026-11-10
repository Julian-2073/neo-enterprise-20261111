import type {Snapshot,Fact} from './contracts.ts';
import type {MarketEvidence} from './agent-contracts.ts';
import {financialWindow,type EvidenceFact,type EvidenceAnalysis} from './evidence-analysis.ts';

export type MarketDomain={products:Array<{id:string;name?:string;roleId?:string;role_id?:string}>;skus:Array<{id:string;productId?:string;product_id?:string;roleId?:string;role_id?:string}>;roles:Array<{id:string;name?:string}>;channels?:Array<{id:string;name?:string}>};
type Period={start:string;end:string};
export type MarketMetrics={intent:number|null;paidOrders:number|null;netRevenueCents:number|null;spendCents:number|null;costPerOrderCents:number|null};
const plus=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const change=(a:number|null,b:number|null)=>a!=null&&b!=null&&b>0?(a-b)/b:null;
const pct=(v:number|null)=>v==null?'缺少对照':`${v>0?'+':''}${(v*100).toFixed(1)}%`;
const currency=(v:number|null)=>v==null?'资料不足':`¥${(v/100).toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
const count=(v:number|null,unit:string)=>v==null?'资料不足':`${v} ${unit}`;
const compact=(s:string)=>s.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[#*>`]/g,'').replace(/\s+/g,' ').trim();
const sourceId=(s:Snapshot,id:string)=>`${s.id}:view:market-source:${encodeURIComponent(id)}`;
export const marketCellId=(s:Snapshot,channel:string,role:string)=>`${s.id}:view:channel-role:${encodeURIComponent(channel)}:${encodeURIComponent(role)}`;

// Source coverage is necessary for comparison. A few observed rows are not
// a complete period; unallocated channel fees never get divided among roles.
function covered(s:Snapshot,kind:string,p:Period){
 const spans=s.coverage.filter(c=>c.kind===kind),sources=new Set(spans.map(c=>c.sourceId));
 return sources.size>0&&[...sources].every(id=>{let next=p.start;for(const c of spans.filter(c=>c.sourceId===id).sort((a,b)=>a.start.localeCompare(b.start)))if(c.start<=next&&c.end>=next)next=plus(c.end,1);return next>p.end;});
}
function metrics(s:Snapshot,facts:EvidenceFact[],p:Period,channel:string|null):MarketMetrics{
 const r=financialWindow(s,facts,p.start,p.end,s.productId,channel);
 const intent=covered(s,'events',p)?(r as typeof r & Record<string,number|null>).A3:null,paidOrders=covered(s,'orders',p)?r.paidOrders:null;
 const netRevenueCents=covered(s,'orders',p)?r.netRevenueCents:null,spendCents=covered(s,'expenses',p)?r.spendCents:null;
 return {intent,paidOrders,netRevenueCents,spendCents,costPerOrderCents:spendCents!=null&&paidOrders!=null&&paidOrders>0?spendCents/paidOrders:null};
}
export function marketPeriods(s:Snapshot){
 const weeks=s.data.weeks.filter(w=>w.start>=s.periodStart&&w.end<=s.periodEnd&&w.end<=s.asOf&&Date.parse(w.end)-Date.parse(w.start)===6*86400000).slice(-8);
 const consecutive=weeks.every((w,i)=>i===0||plus(weeks[i-1].end,1)===w.start);
 const current=consecutive&&weeks.length>=4?{start:weeks.at(-4)!.start,end:weeks.at(-1)!.end}:{start:s.periodStart,end:s.periodEnd<s.asOf?s.periodEnd:s.asOf};
 const previous=consecutive&&weeks.length===8?{start:weeks[0].start,end:weeks[3].end}:null;
 return {current,previous,label:previous?'近四周与前四周':'当前统计期'};
}
export function marketRole(f:Fact,d:MarketDomain){return d.skus.find(x=>x.id===f.sku_id)?.roleId||d.skus.find(x=>x.id===f.sku_id)?.role_id||d.products.find(x=>x.id===f.product_id)?.roleId||d.products.find(x=>x.id===f.product_id)?.role_id;}
export function marketCell(s:Snapshot,facts:EvidenceFact[],d:MarketDomain,channel:string,role?:string){
 const periods=marketPeriods(s),rows=facts.filter(r=>(!s.productId||r.fact.product_id===s.productId)&&r.fact.channel===channel&&(!role||marketRole(r.fact,d)===role));
 const current=metrics(s,rows,periods.current,channel),previous=periods.previous?metrics(s,rows,periods.previous,channel):null;
 const changes={intent:change(current.intent,previous?.intent??null),paidOrders:change(current.paidOrders,previous?.paidOrders??null),netRevenue:change(current.netRevenueCents,previous?.netRevenueCents??null),spend:change(current.spendCents,previous?.spendCents??null),costPerOrder:change(current.costPerOrderCents,previous?.costPerOrderCents??null)};
 const pressure=changes.intent!=null&&changes.paidOrders!=null&&changes.intent>0&&changes.paidOrders<0||changes.costPerOrder!=null&&changes.costPerOrder>0.1;
 const headline=current.paidOrders==null?'订单资料不足':changes.intent!=null&&changes.paidOrders!=null&&changes.intent>0&&changes.paidOrders<0?'意向增加，支付减少':changes.costPerOrder!=null&&changes.costPerOrder>0.1?'每笔订单对应投放上升':changes.paidOrders!=null?`支付订单${changes.paidOrders>0?'增加':changes.paidOrders<0?'减少':'持平'}`:'已记录成交，前期对照不足';
 const summary=`意向 ${count(current.intent,'次')}，支付 ${count(current.paidOrders,'笔')}；净成交 ${currency(current.netRevenueCents)}，投放 ${currency(current.spendCents)}。`;
 const evidenceId=role?marketCellId(s,channel,role):`${s.id}:view:market-channel:${encodeURIComponent(channel)}`;
 const nextStep=pressure?'先联查该渠道货盘的客户承接、可售与到货，再核对投放费用；同期变化不能证明原因。':'按同一渠道与货盘核对订单、退款与投入，再判断是否继续增加预算。';
 const analysis:EvidenceAnalysis={version:'evidence-analysis-v1',judgment:{title:headline,summary,nextStep},metrics:[{label:'意向行为',value:current.intent,previous:previous?.intent??null,unit:'次'},{label:'支付订单',value:current.paidOrders,previous:previous?.paidOrders??null,unit:'笔'},{label:'净成交额',value:current.netRevenueCents,previous:previous?.netRevenueCents??null,unit:'人民币分'},{label:'投放费用',value:current.spendCents,previous:previous?.spendCents??null,unit:'人民币分'},{label:'每笔支付订单对应投放',value:current.costPerOrderCents,previous:previous?.costPerOrderCents??null,unit:'人民币分'}],observations:[`意向变化 ${pct(changes.intent)}；支付变化 ${pct(changes.paidOrders)}。`,`每笔支付订单对应投放变化 ${pct(changes.costPerOrder)}；该比值用于投入对照，不代表投放带来的新增订单。`],limitations:['行为按次、订单按来源与订单编号去重，不相除计算客户转化率。','仅使用冻结商品与规格的货盘关系；未关联到商品或规格的费用不分摊给货盘。','前后各四个连续完整周，覆盖或对照不足时不计算变化。'],...(periods.previous?{comparisonPeriod:`${periods.previous.start} 至 ${periods.previous.end}`}:{})};
 return {channel,role:role??null,evidenceId,headline,summary,status:pressure?'needs_check':current.paidOrders==null?'unavailable':'observed',current,previous,changes,periods,analysis,factIds:rows.filter(r=>r.fact.business_date>=(periods.previous?.start??periods.current.start)&&r.fact.business_date<=periods.current.end&&['events','orders','expenses'].includes(r.kind)).map(r=>r.id)};
}

export type MarketSource=MarketEvidence&{category:'competition'|'demand'|'channel'|'policy';summary:string;relevance:string;timing:'historical'|'current';evidenceId:string;publisher:string};
export function relevantMarketSources(s:Snapshot,_d:MarketDomain,input:MarketEvidence[]){
 const seen=new Map<string,MarketSource>();let excluded=0;
 for(const source of [...input].sort((a,b)=>b.retrievedAt.localeCompare(a.retrievedAt))){
  let url:URL;try{url=new URL(source.url);if(!['http:','https:'].includes(url.protocol))throw Error();}catch{excluded++;continue;}
  const body=compact(source.excerpt??'');
  if(source.verificationStatus!=='source_read'||body.length<40||/^(404|403|access denied|forbidden)$/i.test(source.title.trim())){excluded++;continue;}
  const key=source.id;if(seen.has(key))continue;
  const category:MarketSource['category']='demand';
  const published=source.publishedAt?Date.parse(source.publishedAt):NaN,retrieved=Date.parse(source.retrievedAt),end=Date.parse(s.asOf+'T23:59:59.999Z');
  const historical=Number.isFinite(published)&&published>=Date.parse(s.periodStart)&&published<=Date.parse(s.periodEnd+'T23:59:59.999Z')&&Number.isFinite(retrieved)&&retrieved<=end;
  const relevance='原文已读取，相关性由市场智能体进一步判断。';
  seen.set(key,{...source,excerpt:body,category,summary:body.split(/(?<=[。！？])/u).find(t=>t.trim().length>=15)?.trim().slice(0,100)??body.slice(0,100),relevance,timing:historical?'historical':'current',evidenceId:sourceId(s,source.id),publisher:url.hostname.replace(/^www\./,'')});
 }
 return {items:[...seen.values()],excluded};
}
export function marketWorkbench(s:Snapshot,facts:EvidenceFact[],d:MarketDomain,sources:MarketEvidence[]){
 const periods=marketPeriods(s),scoped=facts.filter(r=>(!s.productId||r.fact.product_id===s.productId)&&(!s.channel||r.fact.channel===s.channel));
 const channelIds=[...new Set([...s.data.channels.map(c=>c.channel),...scoped.map(r=>r.fact.channel).filter((c):c is string=>!!c)])].filter(c=>!s.channel||c===s.channel);
 const roles=d.roles.filter(r=>!s.productId||scoped.some(f=>marketRole(f.fact,d)===r.id));
 const channels=channelIds.map(channel=>({...marketCell(s,scoped,d,channel),name:d.channels?.find(c=>c.id===channel)?.name??channel}));
 const cells=channelIds.flatMap(channel=>roles.map(role=>({...marketCell(s,scoped,d,channel,role.id),roleName:role.name??'货盘'})));
 const current=metrics(s,scoped,periods.current,s.channel),previous=periods.previous?metrics(s,scoped,periods.previous,s.channel):null;
 const intentChange=change(current.intent,previous?.intent??null),costChange=change(current.costPerOrderCents,previous?.costPerOrderCents??null);
 const market=relevantMarketSources(s,d,sources),competition=market.items.filter(x=>x.category==='competition');
 const signals=[{id:'demand',name:'需求场景',title:intentChange==null?'意向已记录，需求趋势待对照':`客户意向${intentChange>0?'增加':intentChange<0?'减少':'持平'}`,value:pct(intentChange),delta:intentChange,note:'来自意向行为；不等于行业搜索热度',evidenceId:`${s.id}:view:market-demand`},{id:'competition',name:'竞品态势',title:competition.length?'有相关产品与品牌原文':'尚无可用的竞品原文',value:competition.length?`${competition.length} 条`:'待核实',delta:null,note:competition.length?'已读取原文，查看与本企业的关联':'不以搜索摘要或无关文章作判断',evidenceId:competition[0]?.evidenceId??null},{id:'efficiency',name:'渠道效率',title:costChange==null?'投入已记录，效率变化待对照':`每笔订单对应投放${costChange>0?'上升':costChange<0?'下降':'持平'}`,value:pct(costChange),delta:costChange,note:'同期间投放费用 ÷ 支付订单笔数',evidenceId:`${s.id}:view:market-efficiency`}];
 const pressure=cells.filter(c=>c.status==='needs_check');
 const judgment={title:pressure.length?'部分渠道货盘投入与成交需核查':intentChange!=null&&intentChange>0?'意向上升，分渠道确认成交承接':current.paidOrders==null?'渠道资料不足，先补齐经营记录':'渠道经营已核算，结合竞品判断机会',summary:pressure.length?`${pressure.length} 个渠道货盘出现承接或费用提示，先定位变化，再联查客户与库存。`:`${periods.label}：意向 ${count(current.intent,'次')}，支付 ${count(current.paidOrders,'笔')}；相关市场原文 ${market.items.length} 条。`};
 const spendTotal=s.data.financial.spendCents;
 const spends=s.data.channels.map(c=>({channel:c.channel,name:d.channels?.find(x=>x.id===c.channel)?.name??c.channel,amountCents:c.spendCents,evidenceId:c.evidenceId}));
 const unallocatedSpendCents=spendTotal!=null&&spends.every(c=>c.amountCents!=null)?spendTotal-spends.reduce((n,c)=>n+c.amountCents!,0):null;
 return {version:'market-workbench-v1' as const,snapshotId:s.id,businessId:s.businessId,dataNature:s.dataNature,periods,judgment,signals,roles:roles.map(r=>({id:r.id,name:r.name??'货盘'})),channels,cells,sources:market.items,excludedSources:market.excluded,spends,unallocatedSpendCents,spendTotalCents:spendTotal,limitations:['近期市场原文与历史经营分别解释，同期变化不能证明因果。','数据导入后发布新的资料版本会重新计算；已保存版本的经营数字不变。']};
}
export type MarketWorkbench=ReturnType<typeof marketWorkbench>;
export function marketOverviewAnalysis(s:Snapshot,facts:EvidenceFact[],focus:'demand'|'efficiency'):EvidenceAnalysis{
 const p=marketPeriods(s),rows=facts.filter(r=>(!s.productId||r.fact.product_id===s.productId)&&(!s.channel||r.fact.channel===s.channel));
 const current=metrics(s,rows,p.current,s.channel),previous=p.previous?metrics(s,rows,p.previous,s.channel):null;
 const d=focus==='demand'?change(current.intent,previous?.intent??null):change(current.costPerOrderCents,previous?.costPerOrderCents??null);
 return {version:'evidence-analysis-v1',judgment:{title:d==null?'资料或前期对照不足':focus==='demand'?`客户意向${d>0?'增加':d<0?'减少':'持平'}`:`每笔订单对应投放${d>0?'上升':d<0?'下降':'持平'}`,summary:`意向 ${count(current.intent,'次')}，支付 ${count(current.paidOrders,'笔')}；每笔订单对应投放 ${currency(current.costPerOrderCents)}，变化 ${pct(d)}。`,nextStep:focus==='demand'?'拆分渠道和商品，核对意向增量是否被后续客户旅程承接。':'优先核查每笔订单对应投入上升的渠道，再联查订单、退款与货盘可售。'},metrics:[{label:'意向行为',value:current.intent,previous:previous?.intent??null,unit:'次'},{label:'支付订单',value:current.paidOrders,previous:previous?.paidOrders??null,unit:'笔'},{label:'投放费用',value:current.spendCents,previous:previous?.spendCents??null,unit:'人民币分'},{label:'每笔支付订单对应投放',value:current.costPerOrderCents,previous:previous?.costPerOrderCents??null,unit:'人民币分'}],observations:['意向来自内部行为记录，不代表行业搜索热度。','费用与支付订单同期间对照，不代表投放新增成交或投资回报。'],limitations:['前后各四个完整周，资料覆盖不足不计算变化。','只分析当前企业、商品与渠道的保存记录。'],...(p.previous?{comparisonPeriod:`${p.previous.start} 至 ${p.previous.end}`}:{})};
}
