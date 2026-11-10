import {forecastSales} from '../lib/business-forecast.ts';
import {buildBusinessState} from '../lib/business-state.ts';
import {calculateScenario} from '../lib/business-scenarios.ts';
import type {DialogueScope} from './agent-conversation.ts';
import {diagnosticBasis} from '../lib/business-diagnostics.ts';
import type {PlatformSettings} from '../lib/platform-settings.ts';
import type {OperatingGeneration} from './business-generations.ts';
export function operatingReviewBasis(g:OperatingGeneration,modelIdentity:string){
 const diagnostics=diagnosticBasis(g.state,(g.configuration as {settings?:PlatformSettings})?.settings?.customerFunnel??null,g.baseline);
 const metrics=Object.fromEntries(Object.entries(g.state.metrics).map(([k,m])=>[k,{...m,evidenceIds:m.evidenceIds.slice(0,8)}]));
 if(g.baseline.status==='calculated')for(const k of ['fulfilled','unmet','contributionMarginCents'] as const)metrics['forecast'+k[0].toUpperCase()+k.slice(1)]={value:g.baseline.totals[k],knownValue:g.baseline.totals[k],unit:k.endsWith('Cents')?'人民币分':g.baseline.unit,status:g.baseline.coverage?.status==='partial'?'partial':'complete',reason:g.baseline.coverage?.status==='partial'?'仅覆盖已估计商品／房型，不能据此判断全企业需求或收益':null,evidenceIds:['forecast:'+g.id]};
 // Include typed constraints so the model does not mistake a metric-only
 // envelope for missing warehouse/BOM/capacity facts. Large inputs stay frozen
 // in storage; bounded samples are explicitly labelled, not full coverage.
 const kinds=['inventory','arrival','fulfillment_rule','hotel_capacity','hotel_reservation','hotel_service_capacity','material_inventory','bom','production_capacity','production'];
 const constraints=Object.fromEntries(kinds.map(kind=>{const rows=g.state.inputs.filter(r=>r.kind===kind);return [kind,{recordCount:rows.length,sampleOnly:rows.length>20,records:rows.slice(-20)}];}));
 return {diagnostics,queryData:{businessId:g.state.businessId,dataNature:g.state.dataNature,generationId:g.id,period:g.state.period,asOf:g.state.asOf,knownAt:g.state.knownAt,records:g.state.inputs},modelIdentity,businessId:g.state.businessId,dataNature:g.state.dataNature,operatingVersion:g.version,generationId:g.id,profileVersion:g.state.profileVersion,profile:g.state.profile,asOf:g.state.asOf,period:g.state.period,measurement:g.state.measurement,identity:g.state.identity,metrics,constraints,baseline:{status:g.baseline.status,coverage:g.baseline.coverage,totals:g.baseline.totals,limitations:g.baseline.limitations,assumptions:g.baseline.assumptions,feasibility:g.baseline.feasibility},quality:g.state.quality,configuration:g.configuration};
}

/** Calculate the turn's actual frozen scope; keep whole-enterprise context explicitly separate. */
export function scopedOperatingReviewBasis(g:OperatingGeneration,modelIdentity:string,scope:DialogueScope){
 const general=operatingReviewBasis(g,modelIdentity),period=scope.period??g.state.period;
 const inputs=g.state.inputs;
 const entityMatches=(r:typeof inputs[number])=>!scope.entityId||r.entityId===scope.entityId;
 const channelMatches=(r:typeof inputs[number])=>scope.channelId===undefined||(r.channelId??null)===scope.channelId;
 // Resource ownership is SKU/warehouse or material/work-center, not sales channel.
 // Preserve the selected product's dependency graph before invoking the original calculator.
 const boms=inputs.filter(r=>r.kind==='bom'&&entityMatches(r));
 const production=inputs.filter(r=>r.kind==='production'&&entityMatches(r));
 const materials=new Set(boms.map(r=>r.materialId));
 const centers=new Set([...boms,...production].map(r=>r.workCenterId));
 const sharedKinds=new Set(['inventory','arrival','bom','production','hotel_capacity','hotel_reservation','hotel_service_capacity']);
 const rows=inputs.filter(r=>{
  if(r.kind==='arrival'&&materials.has(r.entityId))return true;
  if(r.kind==='material_inventory')return !scope.entityId||materials.has(r.entityId);
  if(r.kind==='production_capacity')return !scope.entityId||centers.has(r.workCenterId);
  if(sharedKinds.has(r.kind))return entityMatches(r);
  return entityMatches(r)&&channelMatches(r);
 });
 const state=buildBusinessState({...g.state,start:period.start,end:period.end},rows,g.state.coverage);
 const salesForecast=g.salesForecast?forecastSales(state,{businessId:state.businessId,dataNature:state.dataNature,timezone:state.profile.timezone,asOf:state.asOf,knownAt:state.knownAt,start:state.period.start,end:state.period.end,expectedSources:state.profile.expectedSources.filter(s=>s.kinds.includes('order')).map(s=>s.sourceId),records:rows,coverage:state.coverage},g.salesForecast.issuedAt):undefined;
 const baseline=calculateScenario(state,{id:'baseline',name:'本轮范围现状',demandBps:10000,actions:[]},g.id,salesForecast);
 const allocationGaps:string[]=[];
 if(scope.channelId!==undefined){
  baseline.limitations.push('库存、到货和产能为共享供给事实，不表示已为当前渠道预留。');
  const revenueKind=state.profile.industry==='hotel'?'hotel_stay':'order';
  if(inputs.some(r=>entityMatches(r)&&!channelMatches(r)&&((r.kind===revenueKind&&r.entryType!=='refund'&&r.businessDate>=period.start&&r.businessDate<=period.end)||(r.kind==='hotel_reservation'&&r.status!=='cancelled'&&r.businessDate>state.asOf))))allocationGaps.push('其他渠道存在同商品或房型需求，共享供给的渠道分配尚未确认');
 }
 if(scope.entityId&&state.profile.industry==='manufacturing'){
  const otherBoms=inputs.filter(r=>r.kind==='bom'&&!entityMatches(r));
  const competingProducts=new Set(otherBoms.filter(r=>materials.has(r.materialId)||centers.has(r.workCenterId)).map(r=>r.entityId));
  if(inputs.some(r=>r.kind==='production'&&!entityMatches(r)&&r.status==='planned'&&r.businessDate>state.asOf&&(centers.has(r.workCenterId)||competingProducts.has(r.entityId))))allocationGaps.push('其他产品生产计划占用共享物料或工作中心，本范围的供给分配尚未确认');
 }
 if(allocationGaps.length){
  // Filtering demand cannot establish a new exclusive allocation of a shared pool.
  // Keep observed facts and missing provenance; publish no forecast as a zero or success.
  baseline.status='insufficient';baseline.points=[];
  baseline.totals={requested:null,fulfilled:null,unmet:null,netRevenueCents:null,variableCostCents:null,spendCents:null,actionCostCents:baseline.totals.actionCostCents,contributionMarginCents:null,endingSellable:null};
  baseline.feasibility={status:'unconfirmed',reasons:[...baseline.feasibility.reasons,...allocationGaps]};
  baseline.limitations.push(...allocationGaps);
 }
 const scoped=operatingReviewBasis({...g,state,baseline},modelIdentity);
 const metricScope={period,entityId:scope.entityId??null,channelId:scope.channelId??null,channelMode:scope.channelId===undefined?'all' as const:'exact' as const};
 scoped.diagnostics.scope=metricScope;
 return {...scoped,metricScope,queryData:general.queryData,generalContext:{period:general.period,metrics:general.metrics,notice:'全企业原冻结范围上下文，不是本轮筛选范围的指标；禁止混用'}};
}
