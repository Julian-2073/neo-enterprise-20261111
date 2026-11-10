import {activePlatformSettings} from './platform-settings.ts';
import knowledge from '../agent-service/neo_agent/business-knowledge.json' with {type:'json'};
import {requireWrite,type Context} from './auth.ts';
import {agentPolicy,requireAgentExecution} from './agent-policy.ts';
import {hash} from './csv.ts';
import {assert,json} from './errors.ts';
import {first} from './store.ts';
import type {Snapshot} from './contracts.ts';
import type {AgentRun,ForecastResult,HomeDecisionBasis,HomeDecisionResponse} from './agent-contracts.ts';
import {completeAssessmentRow} from './business-assessment.ts';

export const HOME_DECISION_VERSION='home-decision-v3';
const CALCULATION_VERSION='scenario-v1.3';
const HOME_QUESTION='生成老板首页经营决策：查询当前企业、当前资料版本的完整经营范围，分别核查客户转化、供给库存、渠道费用与利润的全期间和每周统计，必要时继续分页查看商品渠道明细。结合已检索的行业经营知识，直接说明当前最重要的问题、维持现状的预测结论和建议先做的具体行动。重点核查贡献毛利、共享库存、到货与备货目标、客户成熟观察窗口、广告增量和支付退款。判断必须来自实际查询，知识只是解释与核查原则。使用已保存的基线预测，不重算、不编造增长，不执行采购、投放或派单。同时输出联合研判jointReview：综合企业现状和已保存的专业审查、已筛选且读取的市场原文，判断当前状况；列出会改变决策的确认问题、影响和核查方法；选择当前证据下最优先的一个动作，说明比其他动作优先的理由、成立条件及下一步决策门槛。';

type StoredRun={id:string;payload:string;result:string|null;status:string;[key:string]:unknown};
type Dependencies={
 snapshot:(ctx:Context,id:unknown,nature:unknown)=>Promise<Snapshot>;
 context:(ctx:Context,s:Snapshot,purpose:string)=>Promise<{meta:{inputHash:string}}>;
 publicRun:(row:StoredRun)=>AgentRun;
 body:(request:Request)=>Promise<Record<string,unknown>>;
 api:(request:Request,ctx:Context,segments:string[],ontologyEnvelope?:Record<string,unknown>,homeBasis?:HomeDecisionBasis)=>Promise<Response|null>;
};
const baselineRequestId=async(s:Snapshot)=>'home-baseline:'+ (await hash(JSON.stringify([s.businessId,s.dataNature,s.id,CALCULATION_VERSION]))).slice(0,32);

async function basis(ctx:Context,s:Snapshot,deps:Dependencies):Promise<HomeDecisionBasis>{
 const record=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='forecast' AND request_id=?",ctx.businessId,s.dataNature,s.id,await baselineRequestId(s));
 const forecast=record?JSON.parse(record.payload) as ForecastResult:null;
 const context=await deps.context(ctx,s,'home');
 const sourceKey=(await hash(JSON.stringify([HOME_DECISION_VERSION,s.id,s.businessId,s.dataNature,CALCULATION_VERSION,(await activePlatformSettings(ctx,s.dataNature)),knowledge.digest,context.meta.inputHash]))).slice(0,32);
 return {schemaVersion:HOME_DECISION_VERSION,sourceKey,knowledgeVersion:knowledge.version,knowledgeDigest:knowledge.digest,forecast,forecastNotice:null,contextHash:context.meta.inputHash};
}

async function saved(ctx:Context,s:Snapshot,input:HomeDecisionBasis,deps:Dependencies):Promise<AgentRun|null>{
 const assessment=await completeAssessmentRow(ctx,s);if(assessment)return deps.publicRun(assessment);
 const row=await first<StoredRun>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND json_extract(payload,'$.purpose')='home' AND request_id LIKE ? ORDER BY created_at DESC,rowid DESC LIMIT 1",ctx.businessId,s.dataNature,s.id,`home:${input.sourceKey}:%`);
 return row?deps.publicRun(row):null;
}

function response(ctx:Context,input:HomeDecisionBasis,run:AgentRun|null):HomeDecisionResponse{
 const policy=agentPolicy(ctx.runtime,ctx.businessId);
 const storedBasis=run?.result?.homeDecisionBasis as HomeDecisionBasis|undefined;
 return {basis:{...input,forecastNotice:input.forecastNotice??storedBasis?.forecastNotice??null},run,decision:run?.status==='completed'?run.result?.finding?.homeDecision??null:null,canGenerate:ctx.role!=='reader'&&policy.interactiveAllowed,notice:policy.interactiveAllowed?null:policy.notice};
}

export async function handleHomeDecision(request:Request,ctx:Context,deps:Dependencies){
 const url=new URL(request.url);
 assert(['GET','POST'].includes(request.method),405,'METHOD','只支持读取或生成首页判断');
 if(request.method==='GET'){
  const s=await deps.snapshot(ctx,url.searchParams.get('snapshotId'),url.searchParams.get('dataNature'));
  const input=await basis(ctx,s,deps);
  return json(response(ctx,input,await saved(ctx,s,input,deps)));
 }
 requireWrite(request,ctx);requireAgentExecution(ctx.runtime,ctx.businessId,'home');
 const body=await deps.body(request),s=await deps.snapshot(ctx,body.snapshotId,body.dataNature);
 assert(body.refresh===undefined||typeof body.refresh==='boolean',422,'REFRESH','更新标记须为布尔值');
 if(body.refresh)assert(typeof body.requestId==='string'&&/^[a-zA-Z0-9-]{1,40}$/.test(body.requestId),422,'REQUEST_ID','更新须有稳定请求标识');
 const child=(resource:string,input:Record<string,unknown>,homeBasis?:HomeDecisionBasis)=>{
  const target=new URL(request.url);target.pathname='/api/v1/'+resource;
  return deps.api(new Request(target,{method:'POST',headers:request.headers,body:JSON.stringify(input)}),ctx,[resource],undefined,homeBasis);
 };
 let input=await basis(ctx,s,deps);
 if(!input.forecast){
  const result=await child('forecasts',{snapshotId:s.id,dataNature:s.dataNature,requestId:await baselineRequestId(s),title:'首页维持现状基线'});
  assert(result,503,'FORECAST_UNAVAILABLE','预测服务未返回结果');
  if(result.ok)input=await basis(ctx,s,deps);
  else{
   const error=await result.json() as {error?:{message:string}};
   input.forecastNotice=error.error?.message??'资料不足，暂不能生成数值预测';
  }
 }
 const existing=await saved(ctx,s,input,deps);
 // Scope and source identity are chosen here; URL/body cannot inject a model
 // question, knowledge version, forecast, tenant, or execution budget.
 if(existing&&!body.refresh)return json(response(ctx,input,existing));
 const requestId=`home:${input.sourceKey}:${body.refresh?body.requestId:'auto'}`;
 const result=await child('agent-runs',{
  snapshotId:s.id,dataNature:s.dataNature,mode:'orchestrator',purpose:'home',requestId,question:HOME_QUESTION,...(body.recoveryFrom?{recoveryFrom:body.recoveryFrom}:{}),
  budget:{maxModelCalls:null,maxTokens:null,maxToolCalls:null,maxMarketSearches:0,completionTokens:null,timeoutSeconds:1800},
 },input);
 assert(result,503,'HOME_UNAVAILABLE','首页研判服务未返回结果');
 if(!result.ok)return result;
 return json(response(ctx,input,await result.json() as AgentRun),202);
}
