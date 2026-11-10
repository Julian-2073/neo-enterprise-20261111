import {scopeName,productName,channelName} from './business-presentation.ts';
import type {Snapshot} from '../server/contracts.ts';
import type raw from './neo-demo-data.json';
type Missing<T> = T extends number ? number | null : T extends Array<infer U> ? Missing<U>[] : T extends object ? {[K in keyof T]:Missing<T[K]>} : T;
export type NeoData = Missing<typeof raw>;
export const displayNumber = (n:number|null|undefined) => n == null ? '待补数据' : n.toLocaleString('zh-CN');
export const displayMoney = (n:number|null|undefined) => n == null ? '待补数据' : `¥${n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export const displayPercent = (n:number|null|undefined,digits=1) => n == null || !Number.isFinite(n) ? '待接入' : `${(n*100).toFixed(digits)}%`;
export const divide = (a:number|null|undefined,b:number|null|undefined) => a == null || b == null || b <= 0 ? null : a/b;
// Only schema names are shared with the original UI. No fixture values are read here.
export function savedNeoData(s:Snapshot|null,business='经营数据加载中',error=''):NeoData {
 const period=s ? `${s.periodStart} 至 ${s.periodEnd}` : '暂无经营快照';
 const label=s ? scopeName(s,s.domain?.products.map(p=>({id:p.id,name:String(p.name)})),s.domain?.channels.map(c=>({id:c.id,name:String(c.name)}))) : period;
 const f=s?.data.financial;
 const units=(n:number|null|undefined)=>n == null ? null : n/100;
 const stageWeekly={A1:s?.data.weeks.map(w=>w.events.A1) ?? [],A2:s?.data.weeks.map(w=>w.events.A2) ?? [],A3:s?.data.weeks.map(w=>w.events.A3) ?? [],A4:s?.data.weeks.map(w=>w.paidOrders) ?? []};
 const roleNames=['入门品','主力成交品','旗舰形象品'];
 const roles=s?.data.materials?s.data.materials.supply.roles.map(r=>r.roleId):['entry','core','flagship'];
 const scopes={id:s?.id||'',productId:s?.productId||'',channelId:s?.channel||'',period,label};
 const stocks=s?.data.inventory || [];
 const ids=s?.data.channels.map(c=>c.channel)||[];
 const na4=[null,null,null,null];
 return {
 meta:{version:s?.calculationVersion||'',isMock:s?.dataNature!=='business',asOf:s?.asOf||'',business:s?.businessName||business,periodStart:s?.periodStart||'',periodEnd:s?.periodEnd||'',units:{people:'次 / 笔',stock:'件',salesQuantity:'件',money:'元',rate:'百分比'},weeks:s?.data.weeks.map((w,i)=>({label:`第${i+1}周`,start:w.start,end:w.end}))||[]},
 scopes:{conversion:scopes,inventory:{...scopes,asOf:s?.asOf||'',valuation:'成本'},channelSpend:scopes,r1Stock:{...scopes,asOf:s?.asOf||''},supply:scopes},
 issue:{id:'saved-summary',title:error ? '经营数据读取失败' : s ? '已读取保存的经营数据' : '等待导入经营数据',status:error ? '读取失败' : '待业务核实',anomalyWeekIndexes:[],causalityConfirmed:false},
 conversion:{scopeId:s?.id||'',stageWeekly,stageTotals:{A1:s?.data.events.A1??null,A2:s?.data.events.A2??null,A3:s?.data.events.A3??null,A4:f?.paidOrders??null},stageNames:{A1:'曝光行为',A2:'互动行为',A3:'意向行为',A4:'支付订单'},previousComparablePeriod:{label:"前期数据待接入",a3ToA4Ratio:null,isMockBenchmark:false},normalizedMode:{baseline:"实际记录",baseValue:null},rateNote:s?.data.materials?.customerAnalysis.status==='ready'?'行为按次数，支付订单按笔；已关联客户的观察窗口与成交比例见下方。':'行为按次数，支付订单按笔；客户身份或统计规则不足时不计算客户转化率。'},
 financial:{scopeId:s?.id||'',netRevenue:units(f?.netRevenueCents),variableCost:units(f?.variableCostCents),advertisingSpend:units(f?.spendCents),contributionMargin:units(f?.contributionMarginCents),formula:'净成交额 − 变动成本 − 投放费用',isNetProfit:false},
 productRoles:s?.data.materials?s.data.materials.supply.roles.map(r=>({id:r.roleId,name:String(s.domain?.roles.find(x=>x.id===r.roleId)?.name||'角色名称待确认'),skuCount:r.skuCount,currentInventoryCost:units(r.currentInventoryCostCents),currentQualifiedSkuCount:r.qualifiedSkuCount,qualifiedSkuWeekly:r.weekly.map(w=>w.qualifiedSkuCount),rolePurpose:'按已保存的角色与备货规则核查，目标仍需业务确认'})):roles.map((id,i)=>({id,name:roleNames[i],skuCount:null,currentInventoryCost:null,currentQualifiedSkuCount:null,qualifiedSkuWeekly:stageWeekly.A1.map(()=>null),rolePurpose:'商品角色与供给目标待接入'})),
 inventory:{scopeId:s?.id||'',totalInventoryCost:units(s?.data.inventoryCostCents),supplyTargetRatio:null,stockSafetyDaysMethod:'可售天数待接入',r1CurrentSellableStockCost:units(s?.data.inventoryCostCents),shortageOpportunityScenarioRange:[null,null],shortageOpportunityType:'缺货情景待接入'},
 products:[...new Set(stocks.map(r=>r.product_id).filter((p):p is string=>!!p))].map(id=>{const rows=stocks.filter(r=>r.product_id===id);return {id,name:productName(id),roleId:'',netQuantity8w:null,sellableUnits:rows.every(r=>r.sellable_units!=null)?rows.reduce((n,r)=>n+r.sellable_units!,0):null,inTransitUnits:rows.every(r=>r.in_transit_units!=null)?rows.reduce((n,r)=>n+r.in_transit_units!,0):null,eta:null,coverageDays:null,status:'已保存库存；商品名称与备货目标待核对'};}),
 market:{scopeId:s?.id||'',channelSpends:s?.data.channels.map(c=>({channelId:c.channel,name:channelName(c.channel),amount:units(c.spendCents)}))||[],totalChannelSpend:units(f?.spendCents),roleMatrix:ids.flatMap(channelId=>roles.map(roleId=>({channelId,roleId,headline:'待接入',status:'unavailable',subtext:'尚无商品角色归属与经营规则'}))),signals:['demand','competition','channel'].map(id=>({id,title:id==='demand'?'需求来源待接入':id==='competition'?'竞品来源待接入':'效率指标待接入',delta:null,comparison:'暂无可核验比较数据',date:s?.asOf||'',sourceType:'待接入',verified:false})),events:[]},
 opportunities:[],
 forecast:{scopeId:s?.id||'',forecastOrigin:s?.asOf||'',historicalSeriesKey:'conversion.stageWeekly.A4',forecastWeeks:[],baselineWeeklyMedian:na4,baselineTotalRange:[null,null],weeklyDisplayLower:na4,weeklyDisplayUpper:na4,intervalNote:'预测后端待接入',modelStatus:'待接入',judgment:{name:'Jev判断辅助',priority:'待接入',mainConstraint:'待接入',evidenceSufficiency:'待接入',requiresHumanReview:true},scenarioFixtures:['A','B','C'].map(id=>({id,budgetMultiplier:null,eta:'',weeklyMedian:na4,totalRange:[null,null],type:'待接入'})),scenarioCards:['A','B','C'].map((id,i)=>({id,title:['保持现状','先核查并保供','加大投放'][i],fixtureId:id,assumption:'尚无可验证的情景计算'}))},
 actions:{defaultDraft:{id:'',title:'行动后端待接入',status:'unavailable',owner:'待接入',dueDate:'待接入',goal:'待接入',budget:null,evidenceIds:[],hypotheses:[],observationMetrics:[],isDemo:false},lifecycle:['draft','human_confirmed','executing_demo','observing_demo','reviewed_demo'],statusLabels:{draft:'待接入',human_confirmed:'待接入',executing_demo:'待接入',observing_demo:'待接入',reviewed_demo:'待接入'},initialCounts:{awaitingConfirmation:null,executing:null,observing:null},sideEffectPolicy:'unavailable'},
 agents:['conversion','supply','market','joint','orchestrator'].map((id,i)=>({id,name:['转化纠察智能体','供需纠察智能体','市场观察智能体','三智能体协作','行动编排智能体'][i],recommendedAction:'待接入',placeholder:'智能体对话后端待接入',questions:[],initialAssistant:'智能体后端待接入。当前页面只读取已保存的经营数据与证据，不生成经营判断。',availableAgents:[]}))
 };
}
export function neoCalculations(d:NeoData,connected:boolean,snapshot?:Snapshot|null) {
 const stageKeys=['A1','A2','A3','A4'] as const;
 const stageSeries=stageKeys.map((id,i)=>{
 const weekly=d.conversion.stageWeekly[id];
 const baseline=weekly.slice(0,4).reduce<number>((sum,x)=>sum+(x??0),0)/4;
 return {id,name:d.conversion.stageNames[id]+(connected ? id==='A4'?'（笔）':'（次）':''),color:['#7395df','#a86bf4','#006aff','#10b6a5'][i],values:connected?weekly:weekly.map(v=>{const ratio=divide(v,baseline);return ratio==null?null:ratio*100;}),actualValues:connected?undefined:weekly};
 });
 const values=stageSeries.flatMap(x=>x.values).filter((x):x is number=>x!==null);
 const relativeStageSeries=stageSeries.map((s,i)=>{const weekly=d.conversion.stageWeekly[stageKeys[i]],first=weekly.slice(0,4);const base=first.length===4&&first.every(x=>x!=null)?first.reduce<number>((n,x)=>n+x!,0)/4:null;return {...s,values:connected?weekly.map(x=>{const ratio=divide(x,base);return ratio==null?null:ratio*100;}):s.values,actualValues:weekly,actualFormat:(value:number)=>`${Math.round(value)} ${connected?(s.id==='A4'?'笔':'次'):'人'}`};});
 return {relativeStageSeries,weeks:d.meta.weeks.map(w=>connected?`${w.start.slice(5)}–${w.end.slice(5)}`:w.label.replace('第','')),stageSeries,
 supplySeries:d.productRoles.map((r,i)=>({id:r.id,name:r.name,color:['#83beff','#006aff','#b87dfb'][i],values:connected&&snapshot?.data.materials?snapshot.data.weeks.map(w=>{const point=snapshot.data.materials!.supply.roles.find(x=>x.roleId===r.id)?.weekly.find(x=>x.start===w.start);return point?.qualifiedRatio==null?null:point.qualifiedRatio*100;}):r.qualifiedSkuWeekly.map(n=>{const ratio=divide(n,r.skuCount);return ratio==null?null:ratio*100;})})),
 futureSeries:[{id:'A4',name:connected?'支付订单（笔）':'每周有效成交用户',color:'#2274ea',values:[...d.conversion.stageWeekly.A4,...d.forecast.baselineWeeklyMedian]}],
 inventoryTotal:d.inventory.totalInventoryCost,marketSpendTotal:d.market.totalChannelSpend,
 totalConversion:connected?null:divide(d.conversion.stageTotals.A4,d.conversion.stageTotals.A3),previousConversion:connected?null:d.conversion.previousComparablePeriod.a3ToA4Ratio,
 conversionSteps:connected?[null,null,null]:[divide(d.conversion.stageTotals.A2,d.conversion.stageTotals.A1),divide(d.conversion.stageTotals.A3,d.conversion.stageTotals.A2),divide(d.conversion.stageTotals.A4,d.conversion.stageTotals.A3)],
 weeklyConversion:connected?d.conversion.stageWeekly.A3.map(()=>null):d.conversion.stageWeekly.A4.map((v,i)=>divide(v,d.conversion.stageWeekly.A3[i])),
 contributionShares:[divide(d.financial.variableCost,d.financial.netRevenue),divide(d.financial.advertisingSpend,d.financial.netRevenue),divide(d.financial.contributionMargin,d.financial.netRevenue)],
 max:Math.max(1,...values)*1.15,channelIds:connected?d.market.channelSpends.map(c=>c.channelId):['douyin','tmall','xiaohongshu']};
}
