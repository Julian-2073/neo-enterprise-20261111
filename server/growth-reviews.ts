import {knowledgeFreshness} from './knowledge.ts';
import {activePlatformSettings} from './platform-settings.ts';
import knowledge from '../agent-service/neo_agent/business-knowledge.json' with {type:'json'};
import {GROWTH_REVIEW_MODES,GROWTH_REVIEW_MISSIONS,GROWTH_REVIEW_VERSION} from '../lib/growth-review-missions.ts';
import {requireWrite,type Context} from './auth.ts';
import {agentPolicy,requireAgentExecution} from './agent-policy.ts';
import {hash} from './csv.ts';
import {assert,json} from './errors.ts';
import {first} from './store.ts';
import type {Snapshot} from './contracts.ts';
import type {AgentRun,HomeDecisionBasis} from './agent-contracts.ts';
import {completeAssessmentRow,assessmentRun,rowConfigurationFreshness} from './business-assessment.ts';
import {readStoredResult} from './agent-state.ts';
type Row={id:string;payload:string;result:string|null;status:string;configurationFreshness?:AgentRun['configurationFreshness'];[key:string]:unknown};
type Dependencies={snapshot:(ctx:Context,id:unknown,nature:unknown)=>Promise<Snapshot>;body:(r:Request)=>Promise<Record<string,unknown>>;publicRun:(row:Row)=>AgentRun;api:(r:Request,c:Context,segments:string[],ontologyEnvelope?:Record<string,unknown>,homeBasis?:HomeDecisionBasis,trustedReview?:boolean)=>Promise<Response|null>};
export async function handleGrowthReviews(request:Request,ctx:Context,deps:Dependencies){
 assert(['GET','POST'].includes(request.method),405,'METHOD','只支持读取或更新专业审查');
 const url=new URL(request.url),body=request.method==='POST'?await deps.body(request):null;
 if(body){requireWrite(request,ctx);requireAgentExecution(ctx.runtime,ctx.businessId,'review');assert(body.refresh===undefined||typeof body.refresh==='boolean',422,'REFRESH','更新标记须为布尔值');if(body.refresh)assert(typeof body.requestId==='string'&&/^[a-zA-Z0-9-]{1,40}$/.test(body.requestId),422,'REQUEST_ID','更新须有稳定请求标识');}
 const s=await deps.snapshot(ctx,body?body.snapshotId:url.searchParams.get('snapshotId'),body?body.dataNature:url.searchParams.get('dataNature'));
 const key=(await hash(JSON.stringify([GROWTH_REVIEW_VERSION,s.businessId,s.dataNature,s.id,(await activePlatformSettings(ctx,s.dataNature)),knowledge.digest,agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed]))).slice(0,32);
 const requested=url.searchParams.get('mode');
 assert(!requested||GROWTH_REVIEW_MODES.includes(requested as typeof GROWTH_REVIEW_MODES[number]),422,'MODE','未知专业审查类型');
 const selected=requested?GROWTH_REVIEW_MODES.filter(mode=>mode===requested):GROWTH_REVIEW_MODES;
 const reviews:Partial<Record<typeof GROWTH_REVIEW_MODES[number],AgentRun>>={};
 let current=(!body||!body.refresh)?await first<Row>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND json_extract(payload,'$.purpose')='review' AND json_extract(payload,'$.mode')='joint' AND substr(request_id,1,?)=? ORDER BY created_at DESC,rowid DESC LIMIT 1",ctx.businessId,s.dataNature,s.id,`assessment:${key}:`.length,`assessment:${key}:`):null;
 const shared=await completeAssessmentRow(ctx,s);
 if(current){current.knowledgeFreshness=await knowledgeFreshness(ctx,s.dataNature,current.id);if(readStoredResult(current.result).result){current.configurationFreshness=await rowConfigurationFreshness(ctx,s.dataNature,current);if(current.configurationFreshness.status==='stale')current=null;}}
 if(shared)Object.assign(shared,{knowledgeFreshness:await knowledgeFreshness(ctx,s.dataNature,shared.id)});
 if(current&&(!shared||current.id===shared.id||current.status!=='completed'&&String(current.created_at)>=shared.created_at)){
  const run=deps.publicRun(current),completeReviews:typeof reviews={};
  for(const mode of selected){
   const projected=assessmentRun(run,mode),previous=shared?assessmentRun(deps.publicRun(shared),mode):null;
   if(previous)completeReviews[mode]=previous;
   reviews[mode]={...projected,result:projected.result??(previous?.result?{...previous.result,displayOnly:true,displaySourceRunId:shared!.id}:null)};
  }
  const policy=agentPolicy(ctx.runtime,ctx.businessId);return json({reviews,completeReviews,sourceKey:key,canGenerate:ctx.role!=='reader'&&policy.interactiveAllowed,marketSearchAllowed:policy.marketSearchAllowed,notice:policy.notice},body?202:200);
 }
 if(shared&&(!body||!body.refresh)){
  const run=deps.publicRun(shared);for(const mode of selected)reviews[mode]=assessmentRun(run,mode);
  const policy=agentPolicy(ctx.runtime,ctx.businessId);return json({reviews,sourceKey:key,canGenerate:ctx.role!=='reader'&&policy.interactiveAllowed,marketSearchAllowed:policy.marketSearchAllowed,notice:policy.notice},body?202:200);
 }
 if(body&&!requested){
  const target=new URL(request.url);target.pathname='/api/v1/agent-runs';
  const result=await deps.api(new Request(target,{method:'POST',headers:request.headers,body:JSON.stringify({snapshotId:s.id,dataNature:s.dataNature,mode:'joint',purpose:'review',requestId:`assessment:${key}:${body.refresh?body.requestId:'auto'}`,question:'综合复核当前经营，分别核查客户转化、供给库存与市场渠道，给出同一经营判断的专业结论和联合下一步。',budget:{maxModelCalls:null,maxTokens:null,maxToolCalls:null,maxMarketSearches:agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed?null:0,completionTokens:null,timeoutSeconds:600}})}),ctx,['agent-runs'],undefined,undefined,true);
  assert(result,503,'REVIEW_UNAVAILABLE','统一研判服务未返回结果');if(!result.ok)return result;
  const run=await result.json() as AgentRun;for(const mode of selected)reviews[mode]=assessmentRun(run,mode);
  const policy=agentPolicy(ctx.runtime,ctx.businessId);return json({reviews,sourceKey:key,canGenerate:ctx.role!=='reader'&&policy.interactiveAllowed,marketSearchAllowed:policy.marketSearchAllowed,notice:policy.notice},202);
 }
 for(const mode of selected){
  // Only the conversion input changed; reuse existing supply/market reviews.
  const modeKey=mode==='conversion'?(await hash(key+':customer-journey-v1-summary-v2')).slice(0,32):key;
  const prefix=`review:${modeKey}:${mode}:`;
  const row=await first<Row>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND json_extract(payload,'$.purpose')='review' AND json_extract(payload,'$.mode')=? AND substr(request_id,1,?)=? ORDER BY created_at DESC,rowid DESC LIMIT 1",ctx.businessId,s.dataNature,s.id,mode,prefix.length,prefix);
  if(body&&(!row||body.refresh)){
   const target=new URL(request.url);target.pathname='/api/v1/agent-runs';
   const result=await deps.api(new Request(target,{method:'POST',headers:request.headers,body:JSON.stringify({snapshotId:s.id,dataNature:s.dataNature,mode,purpose:'review',requestId:`review:${modeKey}:${mode}:${body.refresh?body.requestId:'auto'}`,question:GROWTH_REVIEW_MISSIONS[mode],budget:{maxModelCalls:null,maxTokens:null,maxToolCalls:null,maxMarketSearches:mode==='market'&&agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed?null:0,completionTokens:null,timeoutSeconds:600}})}),ctx,['agent-runs'],undefined,undefined,true);
   assert(result,503,'REVIEW_UNAVAILABLE','专业审查服务未返回结果');if(!result.ok)return result;reviews[mode]=await result.json() as AgentRun;
  }else if(row){row.knowledgeFreshness=await knowledgeFreshness(ctx,s.dataNature,row.id);row.configurationFreshness=await rowConfigurationFreshness(ctx,s.dataNature,row);if(row.configurationFreshness.status==='current')reviews[mode]=deps.publicRun(row);}
 }
 const policy=agentPolicy(ctx.runtime,ctx.businessId);
 return json({reviews,sourceKey:key,canGenerate:ctx.role!=='reader'&&policy.interactiveAllowed,marketSearchAllowed:policy.marketSearchAllowed,notice:policy.notice},body?202:200);
}
