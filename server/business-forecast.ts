import type {Context} from './auth.ts';
import {all,first,statement} from './store.ts';
import {assert} from './errors.ts';
import {registeredInputVisibility} from './business-input-visibility.ts';
import {legacyOperatingInputs} from './business-legacy-adapter.ts';
import {loadGeneration} from './generation-storage.ts';
import {storeBusinessArtifact,loadBusinessArtifact} from './business-artifact-storage.ts';
import {hash} from './csv.ts';
import {plusDays} from '../lib/business-metrics.ts';
import type {BusinessState,FrozenInput} from '../lib/business-state.ts';
import {FORECAST_VERSION,evaluateIssuedForecast,type ForecastManifest} from '../lib/business-forecast.ts';

/** Keep revisions and publication clocks; a latest-only state cannot prove past visibility. */
export async function forecastManifest(ctx:Context,nature:string,state:BusinessState):Promise<ForecastManifest>{
 const start=plusDays(state.period.end,-729),cutoff=state.knownAt;
 const rows=await all<{id:string;source_id:string;revision:number;known_at:string;import_id:string;payload:string}>(ctx.db,`SELECT i.id,i.source_id,i.revision,i.known_at,i.import_id,i.payload FROM neo_business_inputs i WHERE i.business_id=? AND i.data_nature=? AND i.kind='order' AND i.business_date>=? AND i.business_date<=? AND i.known_at<=? AND ${registeredInputVisibility('i')} ORDER BY i.business_date,i.known_at,i.id LIMIT 100001`,ctx.businessId,nature,start,state.period.end,cutoff,cutoff);
 assert(rows.length<=100000,413,'FORECAST_HISTORY_SIZE','预测历史超过十万记录，请缩小历史范围');
 const legacy=await legacyOperatingInputs(ctx,nature,cutoff,state.period.end,state.profile,undefined,start);
 const imports=await all<{id:string;created_at:string;payload:string}>(ctx.db,'SELECT id,created_at,payload FROM neo_business_imports WHERE business_id=? AND data_nature=? AND created_at<=?',ctx.businessId,nature,cutoff);
 const sealed=new Map(imports.filter(r=>JSON.parse(r.payload).requestId?.startsWith('seal:')).map(r=>[JSON.parse(r.payload).requestId,r.created_at]));
 // Seal rows may not carry requestId in the payload: read the durable key.
 const seals=await all<{request_id:string;created_at:string}>(ctx.db,"SELECT request_id,created_at FROM neo_business_imports WHERE business_id=? AND data_nature=? AND request_id LIKE 'seal:%' AND created_at<=?",ctx.businessId,nature,cutoff);for(const r of seals)sealed.set(r.request_id,r.created_at);
 const publication=new Map(imports.map(r=>{const p=JSON.parse(r.payload);return [r.id,p.group?sealed.get('seal:'+p.group.id):r.created_at];}));
 const frozen=new Map(state.inputs.map(r=>[r.id,r]));
 const records:FrozenInput[]=[...legacy.filter(r=>r.kind==='order'),...rows.map(r=>{const published=publication.get(r.import_id),knownAt=published&&published>r.known_at?published:r.known_at,existing=frozen.get(r.id);return existing?.knownAt===knownAt?existing:{...JSON.parse(r.payload),id:r.id,sourceId:r.source_id,revision:r.revision,knownAt};})].filter(r=>state.profile.expectedSources.some(s=>s.sourceId===r.sourceId&&s.kinds.includes('order')));
 assert(records.length<=100000,413,'FORECAST_HISTORY_SIZE','预测历史超过十万记录，请缩小历史范围');
 const coverage=imports.flatMap(r=>{const p=JSON.parse(r.payload),published=p.group?sealed.get('seal:'+p.group.id):r.created_at;if(!published)return [];return (p.coverage??[]).filter((c:{kind:string;sourceId:string})=>c.kind==='order'&&state.profile.expectedSources.some(s=>s.sourceId===c.sourceId&&s.kinds.includes('order'))).map((c:object)=>({...c,knownAt:published}));});
 const batches=await all<{source_id:string;coverage_start:string;coverage_end:string;committed_at:string}>(ctx.db,"SELECT source_id,coverage_start,coverage_end,committed_at FROM ingestion_batches WHERE business_id=? AND data_nature=? AND kind='orders' AND status='committed' AND committed_at<=?",ctx.businessId,nature,cutoff);
 coverage.push(...batches.filter(r=>state.profile.expectedSources.some(s=>s.sourceId===r.source_id&&s.kinds.includes('order'))).map(r=>({kind:'order',sourceId:r.source_id,start:r.coverage_start,end:r.coverage_end,knownAt:r.committed_at})));
 const earliest=coverage.filter(c=>c.start<=state.period.end).map(c=>c.start).sort()[0]??state.period.start;
 return {businessId:ctx.businessId,dataNature:nature,timezone:state.profile.timezone,asOf:state.asOf,knownAt:cutoff,start:earliest<start?start:earliest,end:state.period.end,expectedSources:state.profile.expectedSources.filter(s=>s.kinds.includes('order')).map(s=>s.sourceId),records,coverage};
}

export async function evaluateGenerationForecast(ctx:Context,nature:string,body:Record<string,unknown>){
 assert(typeof body.generationId==='string'&&typeof body.actualGenerationId==='string',422,'FORECAST_GENERATION','请选择原预测和后续实际资料版本');
 const read=async(id:string)=>{const row=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',id,ctx.businessId,nature);assert(row,404,'GENERATION','经营代次不属于当前企业与资料性质');return loadGeneration(ctx,nature,row.payload);};
 const g=await read(body.generationId),actual=await read(body.actualGenerationId);
 assert(g.salesForecast,409,'FORECAST_VERSION','该历史代次没有保存新口径预测，不能继承旧模型评估');
 assert(actual.state.knownAt>=g.state.knownAt&&actual.state.asOf>=g.state.asOf,409,'ACTUAL_SCOPE','实际资料须来自后续知识时点和经营周期');
 const evaluation=evaluateIssuedForecast(g.salesForecast,await forecastManifest(ctx,nature,actual.state));
 const digest=await hash(JSON.stringify({version:FORECAST_VERSION,forecast:g.id,actual:actual.id})),id='sales-evaluation-'+digest;
 const prior=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=? AND kind='sales_forecast_evaluation'",id,ctx.businessId,nature);
 if(prior)return loadBusinessArtifact(ctx,nature,'sales_forecast_evaluation',prior.payload);
 const value={id,businessId:ctx.businessId,dataNature:nature,generationId:g.id,actualGenerationId:actual.id,createdAt:new Date().toISOString(),evaluation};
 await statement(ctx.db,"INSERT OR IGNORE INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,parent_id,payload,created_at) VALUES(?,?,?,?,'sales_forecast_evaluation',?,?,?,?,?)",id,ctx.businessId,nature,g.id,id,digest,g.id,await storeBusinessArtifact(ctx,nature,'sales_forecast_evaluation',value),value.createdAt).run();
 return value;
}
