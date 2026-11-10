import type {Context} from './auth.ts';
import type {Snapshot,Fact} from './contracts.ts';
import {assert} from './errors.ts';
import {all,first} from './store.ts';
import {channelName,productName,scopeName} from '../lib/business-presentation.ts';
import {eventStages} from './templates.ts';
import {customerJourney} from './customer-journey.ts';
import {customerPulse} from './customer-pulse.ts';
import {analyzeEvidence,analyzeForecast,financialWindow} from './evidence-analysis.ts';
import type {ForecastResult,MarketEvidence} from './agent-contracts.ts';
import {marketCell,marketPeriods,marketOverviewAnalysis,relevantMarketSources} from './market-workbench.ts';
import {savedMarketReview,marketCandidates} from './market-review.ts';
type Frozen={snapshot:Snapshot;facts:Array<{id:string;kind:string;sourceId?:string;fact:Fact}>;domain:{channels?:Array<{id:string;name:string}>;products:Array<{id:string;name:string;roleId?:string;role_id?:string}>;skus:Array<{id:string;product_id?:string;productId?:string;role_id?:string;roleId?:string}>;roles:Array<{id:string;name:string}>;arrivals:Array<{id:string;skuId:string;warehouseId:string;date:string;units:number}>}};
export function scopedEvidence(env:Frozen,id:string){
 const s=env.snapshot,prefix=`${s.id}:view:`;assert(id.startsWith(prefix),404,'NOT_FOUND','证据不属于当前经营记录');
 const [view,...args]=id.slice(prefix.length).split(':').map(decodeURIComponent);let rows:Frozen['facts']=[],title='',formula='',value:unknown=null,unit='次/笔/人民币分',periodStart=s.periodStart,periodEnd=s.periodEnd,extraFactIds:string[]=[],limitations=s.limitations;
 assert(!s.productId||view!=='inventory'||args[0]===s.productId,404,'NOT_FOUND','商品不属于当前查看范围');assert(!s.channel||!['channel-role','week'].includes(view)||(view==='channel-role'?args[0]:args[3]||s.channel)===s.channel,404,'NOT_FOUND','渠道不属于当前查看范围');assert(!s.productId||view!=='week'||!args[2]||args[2]===s.productId,404,'NOT_FOUND','商品不属于当前查看范围');
 const roleOf=(f:Fact)=>env.domain.skus.find(x=>x.id===f.sku_id)?.roleId||env.domain.skus.find(x=>x.id===f.sku_id)?.role_id||env.domain.products.find(x=>x.id===f.product_id)?.roleId||env.domain.products.find(x=>x.id===f.product_id)?.role_id;
 const sum=(key:keyof Fact,items:typeof rows)=>items.length&&items.every(x=>x.fact[key]!=null)?items.reduce((n,x)=>n+Number(x.fact[key]),0):null;
 if(view==='customer-pulse'){
  assert(args.length>=1&&args.length<=2&&args[0],404,'NOT_FOUND','请选择一个完整统计周');
  const result=customerPulse(s,env.facts,args[0],args[1]);rows=result.rows;value=result.pulse;title=`${result.pulse.start.slice(5)} 至 ${result.pulse.end.slice(5)} · 4A 客户旅程分析`;unit='客户/比例';periodStart=result.pulse.start;periodEnd=result.pulse.end;formula='本周去重客户与上周比较；承接分析按截至所点周的四周成熟观察窗口计算。';limitations=result.pulse.limitations;
  const links=new Map(s.data.materials?.customerLinks?.map(x=>[x.factId,x.customerId])??[]),customers=new Set(rows.map(r=>links.has(r.id)?links.get(r.id):(r.fact as Fact&{resolved_customer_id?:string}).resolved_customer_id).filter(Boolean));
  const identities=new Set(rows.filter(r=>r.fact.identity_namespace&&r.fact.external_contact_id).map(r=>JSON.stringify([r.fact.identity_namespace,r.fact.external_contact_id])));
  extraFactIds=[...(s.domain?.customers??[]).filter(r=>customers.has(r.id)),...(s.domain?.customerIdentities??[]).filter(r=>identities.has(JSON.stringify([r.identityNamespace,r.externalId])))].map(r=>r.factId);
 }else if(view==='customer-journey'){
  assert(args.length===0,404,'NOT_FOUND','客户旅程证据范围无效');
  const journey=s.data.customerJourney??customerJourney(s,env.facts);value=journey;title='4A 客户旅程';unit='客户/比例';formula='按快照中已关联客户去重；每环节首次进入后的成熟窗口依序转化；近期与前期各为四个完整周，各自截止于窗口结束。';limitations=journey.limitations;
  rows=env.facts.filter(r=>['events','orders'].includes(r.kind)&&r.fact.business_date>=s.periodStart&&r.fact.business_date<=(journey.rule?.observationEnd??journey.period.end));
  extraFactIds=[...(s.domain?.customers??[]),...(s.domain?.customerIdentities??[])].map(r=>r.factId);
 }else if(view==='supply-pulse'){
  assert(args.length===1,404,'NOT_FOUND','供给证据范围无效');const week=s.data.weeks.find(w=>w.start===args[0]);assert(week,404,'NOT_FOUND','本范围没有这个统计周');
  periodStart=week.start;periodEnd=week.end;title=`${week.start.slice(5)} 至 ${week.end.slice(5)} · 供给分析`;unit='比例';formula='按保存快照的有效规则与截至当周的库存观测计算供给达标率。';value=s.data.materials?.supply??null;
  const previous=s.data.weeks[s.data.weeks.indexOf(week)-1];const days=[week.end,...(previous?[previous.end]:[])];const ids=new Set<string>();
  for(const day of days){const latest=new Map<string,Frozen['facts'][number]>();for(const row of env.facts.filter(r=>r.kind==='inventory'&&r.fact.business_date<=day&&(!s.productId||r.fact.product_id===s.productId)).sort((a,b)=>a.fact.occurred_at.localeCompare(b.fact.occurred_at)||a.id.localeCompare(b.id)))latest.set(JSON.stringify([row.fact.warehouse_id,row.fact.sku_id]),row);for(const row of latest.values())ids.add(row.id);}
  rows=env.facts.filter(r=>ids.has(r.id));limitations=s.data.materials?.supply.limitations??s.limitations;
 }else if(view==='inventory'){
  const [product]=args;assert(product,422,'PRODUCT_REQUIRED','请选择商品');const stocks=s.data.inventory.filter(x=>x.product_id===product);assert(stocks.length,404,'NOT_FOUND','本范围没有这个商品的库存资料');
  rows=env.facts.filter(x=>stocks.some(r=>r.factId===x.id));title=`${productName(product,env.domain.products)} 库存与到货依据`;formula='仅汇总该商品各仓库的最新库存。可售不含在途；备货目标尚需业务确认。';
  value={sellable_units:sum('sellable_units',rows),in_transit_units:sum('in_transit_units',rows),inventory_cost_cents:sum('inventory_cost_cents',rows),safety_units:sum('safety_units',rows)};
 }else if(view==='channel-role'){
  const [channel,role]=args;assert(channel&&role,422,'SCOPE_REQUIRED','请选择渠道和货盘');const p=marketPeriods(s);periodStart=p.current.start;periodEnd=p.current.end;rows=env.facts.filter(x=>x.kind!=='inventory'&&x.fact.channel===channel&&roleOf(x.fact)===role&&x.fact.business_date>=(p.previous?.start??periodStart)&&x.fact.business_date<=periodEnd);
  title=`${channelName(channel,env.domain.channels??[])} / ${env.domain.roles.find(x=>x.id===role)?.name||'货盘归属待确认'} 经营依据`;formula='仅汇总同一渠道、同一货盘、同一期间的行为、支付、退款和投放；未关联的费用不分摊。';
  const orders=rows.filter(x=>x.kind==='orders'),fees=rows.filter(x=>x.kind==='expenses'),events=rows.filter(x=>x.kind==='events'&&eventStages[x.fact.event_type!]==='A3');
  value={paidOrders:orders.length?new Set(orders.filter(x=>x.fact.entry_type==='paid').map(x=>`${x.sourceId||''}/${x.fact.order_id}`)).size:null,events:sum('quantity',events),netRevenueCents:orders.length?orders.reduce((n,x)=>n+(x.fact.entry_type==='refund'?-1:1)*(x.fact.amount_cents||0),0):null,spendCents:sum('amount_cents',fees)};
 }else if(view==='market-channel'||view==='market-demand'||view==='market-efficiency'){
  assert(view==='market-channel'?args.length===1&&!!args[0]&&(!s.channel||s.channel===args[0]):args.length===0,404,'NOT_FOUND','市场分析范围无效');
  const p=marketPeriods(s);periodStart=p.current.start;periodEnd=p.current.end;
  rows=env.facts.filter(r=>['orders','events','expenses'].includes(r.kind)&&(!s.productId||r.fact.product_id===s.productId)&&(!s.channel||r.fact.channel===s.channel)&&(view!=='market-channel'||r.fact.channel===args[0])&&r.fact.business_date>=(p.previous?.start??periodStart)&&r.fact.business_date<=periodEnd);
  title=view==='market-channel'?`${channelName(args[0],env.domain.channels??[])} · 渠道经营分析`:view==='market-demand'?'需求场景 · 客户意向变化':'渠道效率 · 投放与支付对照';formula='按最近四个完整周与此前四周比较意向、支付及费用，缺项不视作零。';value=view==='market-channel'?marketCell(s,env.facts,env.domain,args[0]).current:null;
 }else if(view==='week'){
  const [start,metric,product,channel]=args,week=s.data.weeks.find(x=>x.start===start);assert(week,404,'NOT_FOUND','本范围没有这个统计周');assert(!product||env.domain.products.some(p=>p.id===product)||env.facts.some(f=>f.fact.product_id===product),404,'NOT_FOUND','商品资料未找到');assert(!channel||s.data.channels?.some(c=>c.channel===channel)||env.facts.some(f=>f.fact.channel===channel),404,'NOT_FOUND','渠道资料未找到');periodStart=week.start;periodEnd=week.end;
  const stage=metric==='A4'?'paidOrders':metric;assert(['A1','A2','A3','A5','paidOrders','paidUnits','netRevenueCents','spendCents'].includes(stage),422,'METRIC','请选择本周可核查的指标');
  const previous=s.data.weeks[s.data.weeks.indexOf(week)-1];
  rows=env.facts.filter(x=>x.fact.business_date>=(previous&&new Date(week.start+'T00:00:00Z').getTime()-new Date(previous.end+'T00:00:00Z').getTime()===86400000?previous.start:week.start)&&x.fact.business_date<=week.end&&(!product||x.fact.product_id===product)&&(!channel||x.fact.channel===channel)&&(stage==='spendCents'?x.kind==='expenses':['paidOrders','paidUnits','netRevenueCents'].includes(stage)?x.kind==='orders':x.kind==='events'&&eventStages[x.fact.event_type!]===stage));
  title=`${week.start} 至 ${week.end} · ${stage==='paidOrders'?'支付订单':stage==='paidUnits'?'支付出库':stage==='netRevenueCents'?'净成交额':stage==='spendCents'?'投放费用':{A1:'曝光行为',A2:'互动行为',A3:'意向行为',A5:'关系与复购行为'}[stage as 'A1']}`;formula='按所点击周、商品、渠道和指标计算，与相邻完整周比较；行为次数不能当作客户人数。';value=financialWindow(s,env.facts,week.start,week.end,product||s.productId,channel||s.channel)[stage as 'paidOrders'];unit=stage==='paidOrders'?'笔':stage==='paidUnits'?'件':stage.endsWith('Cents')?'人民币分':'次';
 }else assert(false,404,'NOT_FOUND','暂不支持这一证据范围');
 const arrivals=view==='inventory'?env.domain.arrivals.filter(x=>s.data.inventory.some(r=>r.product_id===args[0]&&r.sku_id===x.skuId&&r.warehouse_id===x.warehouseId)):[];
 const factIds=[...new Set([...rows.map(x=>x.id),...extraFactIds])].sort();
 return {evidence:{id,snapshotId:s.id,businessId:s.businessId,dataNature:s.dataNature,title,formula,value,unit,sourceCount:factIds.length,periodStart,periodEnd,asOf:s.asOf,scopeLabel:(view==='channel-role'?`${env.domain.roles.find(r=>r.id===args[1])?.name||'货盘归属待确认'} / `:'')+scopeName({...s,periodStart,periodEnd,productId:view==='inventory'?args[0]:view==='week'?args[2]||s.productId:s.productId,channel:['channel-role','market-channel'].includes(view)?args[0]:view==='week'?args[3]||s.channel:s.channel},env.domain.products,env.domain.channels??[]).replace(view==='channel-role'?'全部已导入商品':'__unused__','该货盘已导入商品'),limitations},factIds,arrivals};
}
export async function evidenceSources(ctx:Context,nature:string,factIds:string[]){
 return all(ctx.db,`SELECT f.kind,f.batch_id,b.filename,s.name AS source_name,COUNT(*) AS recordCount FROM business_facts f JOIN ingestion_batches b ON b.id=f.batch_id JOIN data_sources s ON s.id=f.source_id WHERE f.business_id=? AND f.data_nature=? AND f.id IN (SELECT value FROM json_each(?)) GROUP BY f.kind,f.batch_id,b.filename,s.name ORDER BY f.kind,b.filename,f.batch_id`,ctx.businessId,nature,JSON.stringify([...new Set(factIds)]));
}
export async function scopedEvidenceResponse(ctx:Context,env:Frozen,id:string,cursor:number,limit:number){
 const s=env.snapshot;let value:ReturnType<typeof scopedEvidence>;let analysis;
 if(id===`${s.id}:view:market-competition`){
  const review=(await savedMarketReview(ctx,s)).review,signal=review?.signals.find(x=>x.id==='competition'),selected=review?.sources.filter(x=>x.selected&&x.category==='competition')??[];
  const candidates=await marketCandidates(ctx,s,selected.map(x=>x.id)),items=relevantMarketSources(s,env.domain,candidates).items.filter(x=>selected.some(y=>y.id===x.id));
  return {evidence:{id,snapshotId:s.id,businessId:s.businessId,dataNature:s.dataNature,title:'竞品态势 · 相关原文分析',formula:'读取本次模型选择的竞品原文，不能将没有可比对象当成不存在竞争。',value:null,unit:'来源',sourceCount:items.length,periodStart:s.periodStart,periodEnd:s.periodEnd,asOf:s.asOf,scopeLabel:'与本企业相关的当前竞品观察',limitations:[]},analysis:{version:'evidence-analysis-v1',judgment:{title:signal?.title??'等待 AI 分析',summary:signal?.summary??'市场智能体尚未完成本次审查。',nextStep:review?.nextStep??'等待本次审查完成。'},metrics:[],observations:selected.map(x=>x.summary),limitations:['当前读取的原文不能证明历史经营变化的原因。']},sources:[],externalSources:items.map(x=>({title:x.title,url:x.url,publisher:x.publisher,publishedAt:x.publishedAt,retrievedAt:x.retrievedAt})),records:[],nextCursor:null};
 }
 if(id.startsWith(`${s.id}:view:market-source:`)){
  const eid=decodeURIComponent(id.slice(`${s.id}:view:market-source:`.length));
  const row=await first<{payload:string}>(ctx.db,'SELECT m.payload FROM neo_market_evidence m JOIN neo_runs r ON r.id=m.run_id AND r.business_id=m.business_id AND r.snapshot_id=m.snapshot_id WHERE m.id=? AND m.business_id=? AND m.snapshot_id=? AND r.data_nature=?',eid,ctx.businessId,s.id,s.dataNature);assert(row,404,'NOT_FOUND','市场来源不属于当前资料版本');
  const candidate=relevantMarketSources(s,env.domain,[JSON.parse(row.payload) as MarketEvidence]).items[0],review=(await savedMarketReview(ctx,s)).review,selection=review?.sources.find(x=>x.id===eid&&x.selected);assert(candidate&&selection,404,'NOT_FOUND','该来源尚未通过本次 AI 筛选');const item={...candidate,...selection};
  return {evidence:{id,snapshotId:s.id,businessId:s.businessId,dataNature:s.dataNature,title:item.title,formula:'读取已保存的相关市场原文，发布日期与抓取日期分别保留；不把当前信息当成历史原因。',value:null,unit:'来源',sourceCount:1,periodStart:s.periodStart,periodEnd:s.periodEnd,asOf:s.asOf,scopeLabel:'相关市场原文 · '+(item.timing==='historical'?'历史时点已可用':'近期观察'),limitations:item.limitations},analysis:{version:'evidence-analysis-v1',judgment:{title:'与本企业的关联',summary:item.relevance,nextStep:review!.nextStep},metrics:[],observations:[item.summary,item.timing==='current'?'这是近期读取的原文，不能用来解释此前经营变化。':'原文在经营时点已可读取；同期出现仍不证明因果。'],limitations:item.limitations},sources:[],externalSources:[{title:item.title,url:item.url,publisher:item.publisher,publishedAt:item.publishedAt,retrievedAt:item.retrievedAt}],records:[],nextCursor:null};
 }
 if(id.startsWith(`${s.id}:view:forecast-week:`)){
  const args=id.slice(`${s.id}:view:forecast-week:`.length).split(':').map(decodeURIComponent);assert(args.length===2,404,'NOT_FOUND','预测证据范围无效');
  const row=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=? AND snapshot_id=? AND kind IN ('forecast','scenario')",args[0],ctx.businessId,s.dataNature,s.id);assert(row,404,'NOT_FOUND','预测不属于当前经营范围');const f=JSON.parse(row.payload) as ForecastResult;assert(f.id===args[0]&&f.snapshotId===s.id&&f.businessId===ctx.businessId&&f.dataNature===s.dataNature,404,'NOT_FOUND','预测归属不一致');const week=f.weeks.find(w=>w.start===args[1]);assert(week,404,'NOT_FOUND','预测中没有这个统计周');
  const factIds=(await all<{fact_id:string}>(ctx.db,'SELECT DISTINCT ef.fact_id FROM evidence_facts ef JOIN evidence_records e ON e.id=ef.evidence_id WHERE e.business_id=? AND e.snapshot_id=? AND e.id IN (SELECT value FROM json_each(?))',ctx.businessId,s.id,JSON.stringify(f.evidenceIds))).map(x=>x.fact_id).sort();
  value={evidence:{id,snapshotId:s.id,businessId:s.businessId,dataNature:s.dataNature,title:`${week.start.slice(5)} 至 ${week.end.slice(5)} · 预测依据`,formula:'读取所选保存基线或方案的逐周条件推演；不重新估算或替换方案。',value:week,unit:'件/人民币分',sourceCount:factIds.length,periodStart:week.start,periodEnd:week.end,asOf:s.asOf,scopeLabel:scopeName({...s,periodStart:week.start,periodEnd:week.end},env.domain.products,env.domain.channels??[]),limitations:f.limitations},factIds,arrivals:[]};analysis=analyzeForecast(f,week.start);
 }else{value=scopedEvidence(env,id);if(id.includes(':view:supply-pulse:')){const masters=await all<{fact_id:string}>(ctx.db,"SELECT DISTINCT ef.fact_id FROM evidence_facts ef JOIN business_facts f ON f.id=ef.fact_id JOIN evidence_records e ON e.id=ef.evidence_id WHERE e.id=? AND e.business_id=? AND f.business_id=? AND f.data_nature=? AND f.kind IN ('roles','products','skus','supply_rules') AND f.business_date<=?",s.evidenceIds.supply,ctx.businessId,ctx.businessId,s.dataNature,value.evidence.periodEnd);value.factIds=[...new Set([...value.factIds,...masters.map(x=>x.fact_id)])].sort();value.evidence.sourceCount=value.factIds.length;}analysis=id.includes(':view:customer-pulse:')?undefined:analyzeEvidence(s,value.evidence,env.facts);}
 if(id.includes(':view:channel-role:')||id.includes(':view:market-channel:')){
  const marker=id.includes(':view:channel-role:')?':view:channel-role:':':view:market-channel:',args=id.slice(id.indexOf(marker)+marker.length).split(':').map(decodeURIComponent);
  assert(args.length===(marker===':view:channel-role:'?2:1)&&(!s.channel||s.channel===args[0]),404,'NOT_FOUND','渠道证据范围无效');
  const cell=marketCell(s,env.facts,env.domain,args[0],args[1]);value.factIds=cell.factIds;value.evidence={...value.evidence,value:cell.current,sourceCount:cell.factIds.length,periodStart:cell.periods.current.start,periodEnd:cell.periods.current.end};analysis=cell.analysis;
 }
 if(id.endsWith(':view:market-demand')||id.endsWith(':view:market-efficiency'))analysis=marketOverviewAnalysis(s,env.facts,id.endsWith('market-demand')?'demand':'efficiency');
 if(id.includes(':view:channel-role:')||id.includes(':view:market-channel:')||id.endsWith(':view:market-demand')||id.endsWith(':view:market-efficiency')){
  const review=(await savedMarketReview(ctx,s)).review;
  const args=id.includes(':view:channel-role:')?id.split(':view:channel-role:')[1].split(':').map(decodeURIComponent):[];
  const cell=review?.cells.find(c=>c.channel===args[0]&&c.role===args[1]),signal=review?.signals.find(x=>id.endsWith(`market-${x.id}`));
  if(analysis)analysis={...analysis,judgment:cell?{title:cell.headline,summary:cell.summary,nextStep:review!.nextStep}:signal?{title:signal.title,summary:signal.summary,nextStep:review!.nextStep}:{title:review?.judgment.title??'等待 AI 分析',summary:review?.judgment.summary??'经营数字已计算，市场智能体尚未完成判断。',nextStep:review?.nextStep??'等待市场智能体完成本次审查。'},observations:[],limitations:[...analysis.limitations,'经营数字由后台计算；判断来自当前资料版本的大模型审查。']};
 }
 const ids=value.factIds.slice(cursor,cursor+limit);const records=ids.length?await all(ctx.db,`SELECT f.id,f.kind,f.batch_id,f.row_number,f.payload,b.filename,s.name AS source_name FROM business_facts f JOIN ingestion_batches b ON b.id=f.batch_id JOIN data_sources s ON s.id=f.source_id WHERE f.business_id=? AND f.data_nature=? AND f.id IN (SELECT value FROM json_each(?)) ORDER BY f.id`,ctx.businessId,s.dataNature,JSON.stringify(ids)):[];
 const sources=await evidenceSources(ctx,s.dataNature,value.factIds);
 return {...value,factIds:undefined,records,sources,...(analysis?{analysis}:{}),nextCursor:cursor+limit<value.factIds.length?cursor+limit:null};
}
