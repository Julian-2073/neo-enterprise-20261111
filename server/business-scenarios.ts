import {storeBusinessArtifact,loadBusinessArtifact,businessArtifactSummary} from './business-artifact-storage.ts';
import {loadGeneration} from './generation-storage.ts';
import type {Context} from './auth.ts';
import {all,first,statement} from './store.ts';
import {assert,ApiError} from './errors.ts';
import {hash} from './csv.ts';
import {calculateScenario,validateScenario,recommendScenario,SCENARIO_VERSION} from '../lib/business-scenarios.ts';
import {enterpriseResult} from './forecast-enterprise.ts';
import {enterpriseAsSales} from '../lib/forecast-enterprise.ts';
import {activeAssumptions,forecastPublicationGuard} from './forecast-assumptions.ts';
import {assumptionMultiplier} from '../lib/forecast-assumptions.ts';
import {currentBusinessGeneration} from './business-head.ts';
export async function readScenarioBundles(ctx:Context,nature:string,id?:string){const rows=await all<{payload:string}>(ctx.db,`SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND kind='business_scenario_bundle' ${id?'AND id=?':''} ORDER BY created_at DESC LIMIT 20`,ctx.businessId,nature,...(id?[id]:[]));const head=await currentBusinessGeneration(ctx,nature);return Promise.all(rows.map(async r=>{const summary=businessArtifactSummary(r.payload);if(!summary.forecastJobId&&!summary.assumptionSetId)return summary;const latest=summary.assumptionSetId?await first<{id:string}>(ctx.db,"SELECT id FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='forecast_assumptions' ORDER BY created_at DESC,id DESC LIMIT 1",ctx.businessId,nature,summary.generationId):null;return {...summary,needsUpdate:summary.generationId!==head?.id||!!summary.assumptionSetId&&latest?.id!==summary.assumptionSetId};}));}
export async function createScenarioBundle(ctx:Context,nature:string,body:Record<string,unknown>){
 assert(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId),422,'REQUEST_ID','需要稳定请求标识');
 assert(typeof body.generationId==='string',422,'GENERATION','须选择已保存经营代次');
 const row=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',body.generationId,ctx.businessId,nature);assert(row,404,'GENERATION','经营代次不存在');
 assert(Array.isArray(body.scenarios)&&body.scenarios.length>0&&body.scenarios.length<=10,422,'SCENARIOS','需要1至10个候选方案');
 let scenarios;try{scenarios=body.scenarios.map(validateScenario);}catch(e){throw new ApiError(422,'SCENARIO',(e as Error).message);}
 assert(new Set(scenarios.map(s=>s.id)).size===scenarios.length,422,'SCENARIOS','方案标识不能重复');
 assert(body.forecastJobId===undefined||typeof body.forecastJobId==='string',422,'FORECAST_JOB','候选预测标识无效');assert(body.assumptionSetId===undefined||typeof body.assumptionSetId==='string',422,'ASSUMPTIONS','假设版本标识无效');
 const links={...(body.forecastJobId?{forecastJobId:body.forecastJobId}:{}),...(body.assumptionSetId?{assumptionSetId:body.assumptionSetId}:{})};
 const requestId=nature+':'+body.requestId,requestHash=await hash(JSON.stringify({version:SCENARIO_VERSION,generationId:body.generationId,scenarios,...links}));
 const prior=await first<{payload:string;request_hash:string}>(ctx.db,"SELECT payload,request_hash FROM neo_artifacts WHERE business_id=? AND kind='business_scenario_bundle' AND request_id=?",ctx.businessId,requestId);
 if(prior){assert(prior.request_hash===requestHash,409,'REQUEST_CONFLICT','请求标识已用于不同方案');return {...(await loadBusinessArtifact(ctx,nature,'business_scenario_bundle',prior.payload)),reused:true};}
 const generation=await loadGeneration(ctx,nature,row.payload);let forecast=generation.salesForecast;
 if(body.forecastJobId){const result=await enterpriseResult(ctx,nature,body.forecastJobId as string);assert(result.forecast.generationId===generation.id&&result.forecast.horizonDays===generation.state.profile.horizonDays&&(await currentBusinessGeneration(ctx,nature))?.id===generation.id&&forecast,409,'FORECAST_STALE','候选模型必须与当前资料代次及期限一致');forecast=enterpriseAsSales(result.forecast,forecast);}
 const assumptions=body.assumptionSetId?await activeAssumptions(ctx,nature,body.assumptionSetId as string,generation.id,generation.state.asOf,generation.state.profile.horizonDays):null;
 const multiplier=assumptions?assumptionMultiplier(assumptions):1,appliedScenarios=scenarios.map(s=>({...s,demandBps:Math.round(s.demandBps*multiplier)}));assert(appliedScenarios.every(s=>s.demandBps<=20000),422,'ASSUMPTION_RANGE','方案与假设叠加后的销量比例超出0至2范围');
 const results=appliedScenarios.map(s=>calculateScenario(generation.state,s,generation.id,forecast));
 const sampleMultipliers=assumptions?Array.from({length:32},(_,i)=>assumptionMultiplier(assumptions,i)):[],sampleTotals=sampleMultipliers.map(m=>calculateScenario(generation.state,{...scenarios[0],demandBps:Math.round(scenarios[0].demandBps*m)},generation.id,forecast).totals.fulfilled).filter((v):v is number=>v!=null);
 const assumptionRange=sampleTotals.length?{scenarioId:scenarios[0].id,fulfilled:[Math.min(...sampleTotals),Math.max(...sampleTotals)],samples:32,notice:'专家分布驱动的条件范围，不能称销量预测区间；未声明独立的判断共享抽样'}:null;
 const guard=body.forecastJobId||body.assumptionSetId?forecastPublicationGuard(ctx,nature,generation.id,body.assumptionSetId as string|undefined):{sql:'1',args:[]};
 const id='scenario-bundle-'+crypto.randomUUID(),payload={id,businessId:ctx.businessId,dataNature:nature,generationId:generation.id,version:SCENARIO_VERSION,createdAt:new Date().toISOString(),scenarios:appliedScenarios,results,recommendation:recommendScenario(results),...links,...(assumptions?{assumptionSnapshot:assumptions,preAssumptionScenarios:scenarios,assumptionRange}:{})};
 try{await statement(ctx.db,`INSERT INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,parent_id,payload,created_at) SELECT ?,?,?,?,'business_scenario_bundle',?,?,NULL,?,? WHERE ${guard.sql}`,id,ctx.businessId,nature,generation.id,requestId,requestHash,await storeBusinessArtifact(ctx,nature,'business_scenario_bundle',payload),payload.createdAt,...guard.args).run();}catch{throw new ApiError(409,'REQUEST_CONFLICT','方案被并发保存，请回读请求');}
 assert(await first(ctx.db,'SELECT id FROM neo_artifacts WHERE id=?',id),409,'SCENARIO_STALE','资料或假设在计算时更新，请重新生成方案');return payload;
}
