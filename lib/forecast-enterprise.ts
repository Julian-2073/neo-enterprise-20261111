import {businessDayEnd,forecastTimeline,type ForecastManifest,type SalesForecast} from './business-forecast.ts';
import {plusDays} from './business-metrics.ts';

export const ENTERPRISE_FORECAST_VERSION='enterprise-paid-v1';
export const MODEL_IDS=['four_week_mean','last_week','weekday_mean_4','auto_ets','croston_sba','mlforecast_lightgbm','autogluon_timeseries'] as const;
export type ModelId=typeof MODEL_IDS[number];
export type ForecastWindow={role:'selection'|'calibration'|'test';origin:string;dates:string[];series:Array<{id:string;entityId:string;channelId:string;values:number[];actual:number[]}>};
export type ForecastDataset={modelIds?:ModelId[];version:string;businessId:string;dataNature:string;generationId:string;target:'paid_units';timezone:string;origin:string;dataCutoff:string;horizonDays:number;domain:'as_of'|'historical_reconstruction';current:ForecastWindow;windows:ForecastWindow[];skipped:Array<{origin:string;reason:string}>;limitations:string[]};
export type ModelScore={wape:number|null;bias:number|null;mae:number|null;cells:number;actual:number;predicted:number};
export type EnterpriseForecast={version:string;businessId:string;dataNature:string;generationId:string;target:'paid_units';pointMeaning:'mean';origin:string;dataCutoff:string;issuedAt:string;horizonDays:number;domain:ForecastDataset['domain'];selectedModel:ModelId;points:Array<{date:string;entityId:string;channelId:string;value:number;lower:number|null;upper:number|null}>;models:Array<{id:ModelId;status:'completed'|'failed';reason?:string;selection:ModelScore;test:ModelScore;params:Record<string,unknown>}>;folds:Array<{role:string;origin:string;metrics:Partial<Record<ModelId,ModelScore>>}>;interval:{status:'calibrated'|'partially_calibrated'|'unavailable';method:string;nominalCoverage:number;coverage:number|null;meanWidth:number|null;wis:number|null;intervalScore?:number|null;baselineWidth?:number|null;baselineIntervalScore?:number|null;calibrationBlocks:number;testBlocks:number;reason:string};promotion:{status:'shadow_eligible'|'baseline_only';reasons:string[];rules:Record<string,number>;wins:number;testBlocks:number};samples:Array<Array<{date:string;entityId:string;channelId:string;value:number}>>;registry:{codeHash:string;featureSchema:string;dependencies:Record<string,string>;seed:number;trainingStart:string;trainingEnd:string;modelArtifactSha256?:string;modelArtifactBytes?:number};skipped:ForecastDataset['skipped'];limitations:string[]};

/** One shared as-of normalizer for every candidate. Research never borrows as-of credentials. */
export function enterpriseDataset(m:ForecastManifest,generationId:string,horizon:number,domain:ForecastDataset['domain']='as_of'):ForecastDataset{
 if(![7,28].includes(horizon)||m.asOf!==m.end)throw Error('首批高级预测支持7/28天，支付资料须覆盖预测起点');
 const skipped:ForecastDataset['skipped']=[];
 const matrix=(end:string,role:ForecastWindow['role'],withLabels:boolean):ForecastWindow|null=>{
  const start=plusDays(end,-83),cutoff=domain==='as_of'&&withLabels?businessDayEnd(end,m.timezone):m.knownAt;
  const t=forecastTimeline(m,start,end,cutoff),labelStart=plusDays(end,1),labelEnd=plusDays(end,horizon);
  if(start<m.start||t.invalid||!t.complete.every(Boolean)){skipped.push({origin:end,reason:'训练期不足84天，或当时资料/渠道/可见时间不完整'});return null;}
  const labels=withLabels?forecastTimeline(m,labelStart,labelEnd,m.knownAt):null;
  if(labels&&(labels.invalid||!labels.complete.every(Boolean)||Date.parse(m.knownAt)<Date.parse(businessDayEnd(labelEnd,m.timezone)))){skipped.push({origin:end,reason:'实际标签缺失或周期未成熟'});return null;}
  const series=[...t.groups.entries()].filter(([,g])=>g.first<=start).map(([id,g])=>({id,entityId:g.entityId,channelId:g.channelId,values:t.dates.map(d=>g.values.get(d)??0),actual:labels?labels.dates.map(d=>labels.groups.get(id)?.values.get(d)??0):[]}));
  if(!series.length){skipped.push({origin:end,reason:'没有历史足够的可见SKU序列'});return null;}
  if(series.length>64)throw Error('本轮训练预算最多64条序列，请按业务分组运行');
  return {role,origin:end,dates:t.dates,series};
 };
 const current=matrix(m.end,'test',false);if(!current)throw Error('最近84天支付资料或渠道归属不足，保留原基线');
 const count=Math.min(11,Math.floor((Date.parse(m.end)-Date.parse(m.start)+86400000-84*86400000)/(horizon*86400000))),windows:ForecastWindow[]=[];
 for(let i=count;i>=1;i--){const index=count-i,role=index<2?'selection':index<5?'calibration':'test',w=matrix(plusDays(m.end,-i*horizon),role,true);if(w)windows.push(w);}
 return {version:ENTERPRISE_FORECAST_VERSION,businessId:m.businessId,dataNature:m.dataNature,generationId,target:'paid_units',timezone:m.timezone,origin:m.asOf,dataCutoff:m.knownAt,horizonDays:horizon,domain,current,windows,skipped,limitations:['历史缺货、上架与停业状态未识别；预测不是潜在需求。','所有方法使用相同完整支付序列；新品与短历史不补零。','内部选择、校准与外层测试分离；真实晋级还需成熟前瞻周期。',...(domain==='historical_reconstruction'?['历史重建使用现在已知修订，不能证明过去当时可用。']:[])]};
}

export function enterpriseAsSales(result:EnterpriseForecast,basis:SalesForecast):SalesForecast{
 const totals=new Map<string,{entityId:string;channelId:string;units:number;status:'estimated'}>();
 for(const p of result.points){const key=JSON.stringify([p.entityId,p.channelId]),r=totals.get(key)??{entityId:p.entityId,channelId:p.channelId,units:0,status:'estimated'};r.units+=p.value;totals.set(key,r);}
 const omitted=basis.series.filter(s=>!totals.has(JSON.stringify([s.entityId,s.channelId])));
 return {...basis,version:result.version,issuedAt:result.issuedAt,horizonDays:result.horizonDays,points:result.points.map(p=>({...p,evidenceIds:[]})),totalUnits:result.points.reduce((n,p)=>n+p.value,0),series:[...totals.values(),...omitted.map(s=>({...s,units:0,status:'short_history' as const}))],unestimatedEntityIds:[...new Set([...basis.unestimatedEntityIds,...omitted.map(s=>s.entityId)])],status:'ready',limitations:[...result.limitations,'这是保存的挑战模型结果；正式经营代次基线保持原值。']};
}
