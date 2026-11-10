import type {BusinessState,FrozenInput} from './business-state.ts';
import {completeCoverage,plusDays,type Coverage} from './business-metrics.ts';

export const FORECAST_VERSION='paid-series-v1';
export const FORECAST_METHODS=['four_week_mean','last_week','weekday_mean_4'] as const;
export type ForecastMethod=typeof FORECAST_METHODS[number];
export type TimedCoverage=Coverage&{knownAt?:string};
export type ForecastManifest={businessId:string;dataNature:string;timezone:string;asOf:string;knownAt:string;start:string;end:string;expectedSources:string[];records:FrozenInput[];coverage:TimedCoverage[]};
export type SalesPoint={date:string;entityId:string;channelId:string;value:number;evidenceIds:string[]};
export type SalesSeries={entityId:string;channelId:string;units:number;status:'estimated'|'short_history'};
export type ErrorScore={actual:number;predicted:number;mae:number|null;wape:number|null;bias:number|null;cells:number};
export type SalesForecast={version:string;target:'paid_units';timezone:string;runNature:'forward'|'historical_reconstruction';pointMeaning:'mean';method:ForecastMethod;issuedAt:string;forecastOrigin:string;dataCutoff:string;trainingStart:string;trainingEnd:string;horizonDays:number;status:'ready'|'insufficient';points:SalesPoint[];totalUnits:number|null;series:SalesSeries[];unestimatedEntityIds:string[];audit:{paidRecords:number;refundRecords:number;series:number;historyDays:number;missingDays:number;unassignedRecords:number;availabilityUnknown:number;availableByOrigin:number;stockoutHistory:'not_identified';gaps:string[]};evaluation:{domain:'as_of_backtest';status:'evaluated'|'partially_evaluated'|'no_paid_series'|'insufficient_history'|'insufficient_folds';version:string;labelKnownAt:string;folds:Array<{trainEnd:string;start:string;end:string;metrics:Record<ForecastMethod,ErrorScore>;coldStartCells:number;unestimatedCells:number}>;skipped:Array<{trainEnd:string;reason:string}>;metrics:Record<ForecastMethod,ErrorScore>;promotion:{status:'baseline_only';reason:string};interval:{status:'not_calibrated';reason:string}};limitations:string[]};

const seriesKey=(entityId:string,channelId:string)=>JSON.stringify([entityId,channelId]);
const validInstant=(v:string|undefined)=>!!v&&/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(v)&&Number.isFinite(Date.parse(v));
/** Convert a local calendar-day boundary using the business IANA timezone. */
export function businessDayEnd(day:string,timezone:string){
 const target=Date.parse(plusDays(day,1)+'T00:00:00Z');let utc=target;
 const f=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<3;i++){const p=Object.fromEntries(f.formatToParts(new Date(utc)).map(x=>[x.type,x.value]));const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);utc+=target-local;}
 return new Date(utc-1).toISOString();
}
function revisions(records:FrozenInput[],cutoff:string){
 const latest=new Map<string,FrozenInput>(),cutoffInstant=Date.parse(cutoff);
 for(const r of records){if(!validInstant(r.knownAt)||Date.parse(r.knownAt)>cutoffInstant)continue;const k=JSON.stringify([r.sourceId,r.kind,r.recordKey]),old=latest.get(k);if(!old||r.revision>old.revision||r.revision===old.revision&&(r.knownAt>old.knownAt||r.knownAt===old.knownAt&&r.id>old.id))latest.set(k,r);}
 return [...latest.values()];
}
export function forecastTimeline(m:ForecastManifest,start:string,end:string,cutoff:string){
 const prefix=revisions(m.records,cutoff).filter(r=>r.kind==='order'&&r.businessDate<=end&&r.entryType==='paid');
 const records=prefix.filter(r=>r.businessDate>=start);
 const spans=m.coverage.filter(c=>validInstant(c.knownAt)&&Date.parse(c.knownAt!)<=Date.parse(cutoff));
 const dates:string[]=[];for(let day=start;day<=end;day=plusDays(day,1))dates.push(day);
 const complete=dates.map(d=>completeCoverage(spans,'order',d,d,m.expectedSources));
 const groups=new Map<string,{entityId:string;channelId:string;first:string;values:Map<string,number>;ids:Map<string,string[]>}>();
 for(const r of prefix){if(!r.channelId||!Number.isSafeInteger(r.quantity)||r.quantity!<0)continue;const k=seriesKey(r.entityId,r.channelId),g=groups.get(k)??{entityId:r.entityId,channelId:r.channelId,first:r.businessDate,values:new Map(),ids:new Map()};g.first=g.first<r.businessDate?g.first:r.businessDate;if(r.businessDate>=start){g.values.set(r.businessDate,(g.values.get(r.businessDate)??0)+r.quantity!);const ids=g.ids.get(r.businessDate)??[];if(ids.length<8)ids.push(r.id);g.ids.set(r.businessDate,ids);}groups.set(k,g);}
 const invalid=prefix.some(r=>!r.channelId||!Number.isSafeInteger(r.quantity)||r.quantity!<0)||m.records.some(r=>r.kind==='order'&&!validInstant(r.knownAt));
 return {dates,complete,groups,records,invalid};
}
const timeline=forecastTimeline;
function predict(values:number[],horizon:number,method:ForecastMethod){
 const recent=values.slice(-28),week=values.slice(-7),mean=recent.reduce((n,v)=>n+v,0)/recent.length;
 return Array.from({length:horizon},(_,i)=>method==='last_week'?week[i%7]:method==='weekday_mean_4'?recent.filter((_,j)=>j%7===i%7).reduce((n,v)=>n+v,0)/4:mean);
}
export function errorScore(cells:Array<[number,number]>):ErrorScore{
 const actual=cells.reduce((n,[a])=>n+a,0),predicted=cells.reduce((n,[,p])=>n+p,0),absolute=cells.reduce((n,[a,p])=>n+Math.abs(a-p),0);
 return {actual,predicted,mae:cells.length?absolute/cells.length:null,wape:actual>0?absolute/actual:null,bias:actual>0?(predicted-actual)/actual:null,cells:cells.length};
}
const emptyScores=()=>Object.fromEntries(FORECAST_METHODS.map(m=>[m,errorScore([])])) as Record<ForecastMethod,ErrorScore>;

/** Same-origin baseline comparison. No selection using the reported test folds. */
export function evaluateSales(m:ForecastManifest,horizon:number):SalesForecast['evaluation']{
 const folds:SalesForecast['evaluation']['folds']=[],skipped:SalesForecast['evaluation']['skipped']=[],cells=Object.fromEntries(FORECAST_METHODS.map(k=>[k,[] as Array<[number,number]>])) as Record<ForecastMethod,Array<[number,number]>>;
 const originCutoff=businessDayEnd(m.asOf,m.timezone),paid=m.records.filter(r=>r.kind==='order'&&r.entryType==='paid');
 const historyDays=Math.round((Date.parse(m.end)-Date.parse(m.start))/86400000)+1;
 const output=(status:SalesForecast['evaluation']['status'])=>({domain:'as_of_backtest' as const,status,version:FORECAST_VERSION,labelKnownAt:m.knownAt,folds,skipped,metrics:folds.length?Object.fromEntries(FORECAST_METHODS.map(k=>[k,errorScore(cells[k])])) as Record<ForecastMethod,ErrorScore>:emptyScores(),promotion:{status:'baseline_only' as const,reason:'只发布预先确定的四周均值基线；对照误差不用于同一测试集选模型，尚未满足独立验证和真实前瞻晋级条件。'},interval:{status:'not_calibrated' as const,reason:'尚未建立独立校准样本，不输出概率区间或缺货概率。'}});
 if(!paid.some(r=>validInstant(r.knownAt)&&Date.parse(r.knownAt)<=Date.parse(originCutoff)))return output('no_paid_series');
 if(historyDays<28+horizon)return output('insufficient_history');
 // Bound CPU and result size. Each test window is non-overlapping.
 const count=Math.min(6,Math.floor((historyDays-28)/horizon));
 for(let i=count;i>=1;i--){
  const start=plusDays(m.end,-i*horizon+1),end=plusDays(start,horizon-1),trainEnd=plusDays(start,-1),trainStart=plusDays(trainEnd,-27),cutoff=businessDayEnd(trainEnd,m.timezone);
  if(Date.parse(m.knownAt)<Date.parse(businessDayEnd(end,m.timezone))){skipped.push({trainEnd,reason:'标签经营周期尚未成熟'});continue;}
  const train=timeline(m,trainStart,trainEnd,cutoff),labels=timeline(m,start,end,m.knownAt);
  if(train.invalid||labels.invalid||!train.complete.every(Boolean)||!labels.complete.every(Boolean)){skipped.push({trainEnd,reason:'当时训练资料、渠道归属或成熟标签未完整发布，不能把缺失当成零'});continue;}
  if(!train.groups.size){skipped.push({trainEnd,reason:'预测时点没有已知支付序列'});continue;}
  const keys=new Set([...train.groups.keys(),...labels.groups.keys()]);if(keys.size*horizon+cells.four_week_mean.length>100000){skipped.push({trainEnd,reason:'检验超过十万个叶子日单元预算，请缩小SKU或期限范围'});continue;}
  const fc=Object.fromEntries(FORECAST_METHODS.map(k=>[k,[] as Array<[number,number]>])) as Record<ForecastMethod,Array<[number,number]>>;let coldStartCells=0,unestimatedCells=0;
  for(const k of keys){const t=train.groups.get(k),label=labels.groups.get(k);if(t&&t.first>trainStart){unestimatedCells+=horizon;continue;}
   const values=t?train.dates.map(d=>t.values.get(d)??0):Array(28).fill(0);if(!t)coldStartCells+=horizon;
   for(const method of FORECAST_METHODS){const predicted=predict(values,horizon,method);labels.dates.forEach((d,j)=>{const cell:[number,number]=[label?.values.get(d)??0,predicted[j]];fc[method].push(cell);cells[method].push(cell);});}
  }
  if(!fc.four_week_mean.length){skipped.push({trainEnd,reason:'可见序列的历史偏短，无法形成完整训练窗'});continue;}
  folds.push({trainEnd,start,end,metrics:Object.fromEntries(FORECAST_METHODS.map(k=>[k,errorScore(fc[k])])) as Record<ForecastMethod,ErrorScore>,coldStartCells,unestimatedCells});
 }
 return output(folds.length?(skipped.length||folds.some(f=>f.unestimatedCells>0)?'partially_evaluated':'evaluated'):'insufficient_folds');
}

export function forecastSales(state:BusinessState,m:ForecastManifest,issuedAt:string):SalesForecast{
 if(m.businessId!==state.businessId||m.dataNature!==state.dataNature||m.asOf!==state.asOf||m.knownAt!==state.knownAt||m.timezone!==state.profile.timezone)throw Error('预测清单与经营资料范围不一致');
 const horizon=state.profile.horizonDays,trainingStart=plusDays(m.end,-27),train=timeline(m,trainingStart,m.end,m.knownAt),points:SalesPoint[]=[],unknown=new Set<string>(),gaps:string[]=[];
 const paid=revisions(m.records,m.knownAt).filter(r=>r.kind==='order'&&r.entryType==='paid'),refunds=revisions(m.records,m.knownAt).filter(r=>r.kind==='order'&&r.entryType==='refund');
 const originInstant=Date.parse(businessDayEnd(m.asOf,m.timezone));
 const availableByOrigin=paid.filter(r=>Date.parse(r.knownAt)<=originInstant).length;
 if(!train.complete.every(Boolean)||trainingStart<m.start)gaps.push('最近四周支付资料未完整发布，不能建立销量基线');
 if(paid.some(r=>!r.channelId))gaps.push('存在未归属渠道的支付记录，SKU×渠道范围尚不完整');
 if(m.records.some(r=>r.kind==='order'&&!validInstant(r.knownAt)))gaps.push('存在缺少明确资料可见时间的订单');
 if(train.groups.size*horizon>100000)gaps.push('预测超过十万个 SKU×渠道×日组合，请缩小范围');
 for(const g of train.groups.values()){
  if(g.first>trainingStart){unknown.add(g.entityId);continue;}
  if(!gaps.length){const values=train.dates.map(d=>g.values.get(d)??0),predicted=predict(values,horizon,'four_week_mean'),evidenceIds=[...g.ids.values()].flat().slice(0,8);predicted.forEach((value,i)=>points.push({date:plusDays(m.asOf,i+1),entityId:g.entityId,channelId:g.channelId,value,evidenceIds}));}
 }
 const totals=new Map<string,number>();for(const p of points){const k=seriesKey(p.entityId,p.channelId);totals.set(k,(totals.get(k)??0)+p.value);}
 const series:SalesSeries[]=[...train.groups].map(([k,g])=>({entityId:g.entityId,channelId:g.channelId,units:totals.get(k)??0,status:totals.has(k)?'estimated':'short_history'}));
 const forecasted=new Set(points.map(p=>p.entityId));for(const r of state.inputs.filter(r=>['order','inventory','arrival','fulfillment_rule'].includes(r.kind)))if(!forecasted.has(r.entityId))unknown.add(r.entityId);
 if(!points.length)gaps.push('没有历史足够且范围明确的支付序列');
 const evaluation=evaluateSales(m,horizon);
 return {version:FORECAST_VERSION,target:'paid_units',timezone:m.timezone,runNature:Date.parse(issuedAt)<=originInstant?'forward':'historical_reconstruction',pointMeaning:'mean',method:'four_week_mean',issuedAt,forecastOrigin:m.asOf,dataCutoff:m.knownAt,trainingStart,trainingEnd:m.end,horizonDays:horizon,status:points.length?'ready':'insufficient',points,totalUnits:points.length?points.reduce((n,p)=>n+p.value,0):null,series,unestimatedEntityIds:[...unknown].sort(),audit:{paidRecords:paid.length,refundRecords:refunds.length,series:train.groups.size,historyDays:Math.max(0,Math.round((Date.parse(m.end)-Date.parse(m.start))/86400000)+1),missingDays:train.complete.filter(v=>!v).length,unassignedRecords:paid.filter(r=>!r.channelId).length,availabilityUnknown:m.records.filter(r=>r.kind==='order'&&!validInstant(r.knownAt)).length,availableByOrigin,stockoutHistory:'not_identified',gaps:[...new Set(gaps)]},evaluation,limitations:['预测目标为已支付件数，退款不抵消需求；不等于实际发货。','零销量依据来源完整性声明；未掌握上架、停业与历史缺货状态，不能证明潜在需求或损失销量。','新品及短历史序列保留未知，不填零；汇总仅覆盖已估计序列。','当前为预先确定的四周均值基线，未晋级机器学习模型，也未建立经校准概率区间。']};
}

/** HTTP/D1 summaries must not duplicate full daily prediction payloads. */
export function salesForecastSummary(f:SalesForecast):SalesForecast{return {...f,points:[],series:f.series.slice(0,100)};}

/** Mature forward labels are scored separately from historical folds. */
export function evaluateIssuedForecast(f:SalesForecast,m:ForecastManifest){
 const start=plusDays(f.forecastOrigin,1),end=plusDays(f.forecastOrigin,f.horizonDays);
 const label=timeline(m,start,end,m.knownAt);
 if(f.status!=='ready'||m.end<end||Date.parse(m.knownAt)<Date.parse(businessDayEnd(end,m.timezone))||label.invalid||!label.complete.every(Boolean))return {status:'awaiting_labels',start,end,labelKnownAt:m.knownAt,metrics:null,reason:'预测不可评估、周期尚未结束或实际支付资料未完整发布'};
 const cells=f.points.map(p=>[label.groups.get(seriesKey(p.entityId,p.channelId))?.values.get(p.date)??0,p.value] as [number,number]);
 return {status:'evaluated',domain:Date.parse(f.issuedAt)<=Date.parse(businessDayEnd(f.forecastOrigin,m.timezone))?'forward':'retrospective',start,end,labelKnownAt:m.knownAt,metrics:errorScore(cells),reason:'只评估原预测覆盖的SKU×渠道；新出现序列另计覆盖缺口，不证明决策因果收益'};
}
