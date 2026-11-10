import type {SalesForecast} from '../lib/business-forecast.ts';
import type {Snapshot,Fact} from './contracts.ts';
import type {HomeSections} from './home-sections.ts';
import type {HomeDecisionResponse,ForecastResult,ScenarioResult,DecisionRecord} from './agent-contracts.ts';
import {scenarioBelongsToBaseline,sameResultScope} from '../lib/decision-history.ts';
import {recommendScenario} from '../components/neo-demo/forecast-presentation.ts';
import {operatingTimeline} from './operating-timeline.ts';
export type DecisionDomain={products:Array<{id:string;name:string}>;skus:Array<{id:string;product_id:string}>;arrivals:Array<{id:string;skuId:string;warehouseId:string;date:string;units:number}>;facts:Array<{kind:string;fact:Fact}>};
function paidUnits(s:Snapshot,domain:DecisionDomain,start:string,end:string){
 const coverage=(s.coverage??[]).filter(c=>c.kind==='orders'),sources=[...new Set(coverage.map(c=>c.sourceId))];
 const complete=sources.length>0&&sources.every(id=>{let next=start;for(const c of coverage.filter(c=>c.sourceId===id).sort((a,b)=>a.start.localeCompare(b.start)))if(c.start<=next&&c.end>=next)next=new Date(Date.parse(c.end+'T00:00:00Z')+86400000).toISOString().slice(0,10);return next>end;});
 if(!complete)return null;
 const rows=domain.facts.filter(f=>f.kind==='orders'&&f.fact.entry_type==='paid'&&f.fact.business_date>=start&&f.fact.business_date<=end);
 return rows.every(f=>f.fact.quantity!=null&&Number.isFinite(f.fact.quantity))?rows.reduce((n,f)=>n+f.fact.quantity!,0):null;
}
// One read projection for all three steps. Numbers remain calculation artifacts;
// model language is taken only from a completed, source-bound home review.
export function decisionWorkbench(s:Snapshot,sections:HomeSections,home:HomeDecisionResponse,forecasts:ForecastResult[],scenarios:ScenarioResult[],decisions:DecisionRecord[],domain:DecisionDomain,requestedBaseline?:string|null){
 const scope={businessId:s.businessId,dataNature:s.dataNature,snapshotId:s.id};
 const history=forecasts.filter(f=>sameResultScope(f,{...scope,ontologyRef:f.ontologyRef}));
 const baseline=requestedBaseline?history.find(f=>f.id===requestedBaseline)??null:history.find(f=>f.id===home.basis.forecast?.id)??history[0]??null;
 const comparable=scenarios.filter(f=>scenarioBelongsToBaseline(f,baseline));
 const currentDecisions=decisions.filter(d=>d.selectedScenario&&scenarioBelongsToBaseline(d.selectedScenario,baseline));
 const h=home.run?.status==='completed'?home.decision:null;
 const review=h?.jointReview??null;
 const action=review?.nextAction??h?.action;
 const metricPool={
  netRevenue:{key:'netRevenue',label:'统计期净成交额',value:s.data.financial?.netRevenueCents??null,unit:'cents',evidenceId:s.evidenceIds?.netRevenueCents??null},
  margin:{key:'margin',label:'统计期贡献毛利',value:s.data.financial?.contributionMarginCents??null,unit:'cents',evidenceId:s.evidenceIds?.contributionMarginCents??null},
  stock:{key:'stock',label:'当前可售库存',value:sections.goods.metrics.sellableUnits??null,unit:'件',evidenceId:sections.goods.evidenceId??null},
  conversion:{key:'conversion',label:'近四周意向 → 购买',value:sections.people.metrics?.conversionRate??null,unit:'rate',evidenceId:sections.people.evidenceId??null},
 };
 const metrics=(review?.metricKeys??[]).map(key=>metricPool[key]).filter(m=>m&&m.value!=null);
 const jointEvidenceIds=review?[...new Set([...review.status.evidenceIds,...review.market.evidenceIds,...review.nextAction.evidenceIds,...review.confirmations.flatMap(c=>c.evidenceIds)])]:[];
 const plans=domain.arrivals.filter(a=>a.date>s.asOf&&s.data.inventory.some(r=>r.sku_id===a.skuId&&r.warehouse_id===a.warehouseId)).sort((a,b)=>a.date.localeCompare(b.date));
 return {forecastQuality:null as SalesForecast|null,forecastBasisState:'unknown' as 'unknown'|'current'|'historical',version:'decision-workbench-v1',operating:s.operating,...scope,asOf:s.asOf,sections,home,baseline,forecasts:history,scenarios:comparable,decisions:currentDecisions,timeline:operatingTimeline(s,sections),
  notice:requestedBaseline&&!baseline?'链接中的预测不属于当前资料版本，请选择其他版本。':null,
  history:s.data.weeks.map(w=>({start:w.start,end:w.end,units:paidUnits(s,domain,w.start,w.end)})),
  joint:{review,metrics,runId:home.run?.id??null,generatedAt:home.run?.createdAt??null,status:review?'ready':home.run?.status??'missing',title:review?.status.title??h?.judgment.title??null,summary:review?.status.summary??h?.judgment.summary??null,gaps:home.run?.status==='completed'?home.run.result?.finding?.gaps??[]:[],action:action??null,evidenceIds:review?jointEvidenceIds:h?[...new Set([...h.judgment.evidenceIds,...h.action.evidenceIds])]:[]},
  recommendation:recommendScenario(baseline,comparable),
  templates:[{id:'A',title:'保持现状',summary:'保持当前供给、价格与投放节奏'},{id:'B',title:'先核查并保供',summary:plans.length?'核对到货日期和数量，比较供给改善':'填写补货或调拨条件，比较供给改善'},{id:'C',title:'调整投放',summary:'填写预算变化及需求响应假设，比较投入产出'}],
  arrivals:plans,products:domain.products,skus:domain.skus,warehouses:[...new Set(s.data.inventory.map(r=>r.warehouse_id).filter(Boolean))],
  draft:{title:action?.title??'经营行动草案',summary:action?.summary??null,steps:action?.steps??[],observationMetrics:['商品销量','贡献毛利','未承接需求','库存占用'],stage:currentDecisions.length?'recorded':comparable.length?'compared':'draft'},
  limitations:['预测单位为支付出库件数，不能换算为客户人数。','当前市场观察与历史经营分别解释；同期变化不能证明因果。','保存的是经营选择；执行及实际收益尚未记录。']};
}
export type DecisionWorkbench=ReturnType<typeof decisionWorkbench>;
