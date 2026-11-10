import {researchTime} from './knowledge-time.ts';
import {knowledgeContext,recordKnowledgeDependencies,knowledgeFreshness} from './knowledge.ts';
import {assertSession,freezeConversation,validateDialogueScope,type DialogueScope} from './agent-conversation.ts';
import {boundedRequestBytes} from './request-body.ts';
import {scopeMarketReferences} from './agent-state.ts';
import {decisionPlan} from './decision-plan.ts';
import {recognizeTask,taskBudget} from './neo-task-plan.ts';
import {completeAssessmentRow,rowConfigurationFreshness} from './business-assessment.ts';
import {decisionWorkbench,type DecisionDomain} from './decision-workbench.ts';
import {configuredAgentEnvelope,activePlatformSettings} from './platform-settings.ts';
import {forecastAvailability} from '../lib/forecast-availability.ts';
import {sameCalculation} from '../lib/decision-history.ts';
import {PATROL_QUESTION,patrolRequestId} from '../lib/agent-missions.ts';
import {requireWrite,type Context} from './auth.ts';
import {assert,json,ApiError} from './errors.ts';
import {all,first,statement} from './store.ts';
import {hash} from './csv.ts';
import {readDecision,sameArtifactScope} from './decision-readback.ts';
import type {Snapshot} from './contracts.ts';
import {agentPolicy,requireAgentExecution,offlineAgentBase,automaticMonitorAllowed} from './agent-policy.ts';
import {validatedBudget,readStoredResult,storedObservation,mergeResult,mergeSteps} from './agent-state.ts';
import type {AgentRun,AgentResult,RunObservation} from './agent-contracts.ts';
import {inputProvenance} from './input-provenance.ts';
import {encodeInput,decodeInput} from './input-storage.ts';
import {transportEnvelope} from './ontology/transport.ts';
import {handleHomeDecision} from './home-decision.ts';
import {specialistReview,supplyOverview,homeSections} from './home-sections.ts';
import {handleGrowthReviews} from './growth-reviews.ts';
import {handlePolicyBriefing} from './policy-briefing.ts';
import {customerJourney,type JourneyFact} from './customer-journey.ts';
import {marketWorkbench,type MarketDomain} from './market-workbench.ts';
import {marketCandidates,savedMarketReview,marketModelBasis,modelMarketPresentation,MARKET_REVIEW_VERSION} from './market-review.ts';
import type {HomeDecisionBasis} from './agent-contracts.ts';
const modes=['conversion','supply','market','joint','orchestrator'];
const stamp=()=>new Date().toISOString();
const uid=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;
export async function agentBody(request:Request):Promise<Record<string,unknown>>{
 const bytes=await boundedRequestBytes(request,65536);
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));assert(value&&typeof value==='object'&&!Array.isArray(value),422,'INVALID_BODY','需要 JSON 对象');return value;}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(422,'INVALID_BODY','JSON格式错误');}
}
function string(x:unknown,label:string,max=4000){assert(typeof x==='string'&&x.trim().length>0&&x.length<=max,422,'INVALID_FIELD',`${label}无效`);return x.trim();}
export async function service(ctx:Context,path:string,body?:unknown){
 const mode=ctx.runtime.agentExecutionMode??'live';
 const agentOperation=/^\/(runs|patrols|knowledge-runs|knowledge-source)(\/|$)/.test(path);
 const startsWork=['/runs','/knowledge-runs','/knowledge-source'].includes(path)&&body!==undefined||path.endsWith('/resume')&&body!==undefined;
 assert(!startsWork||mode!=='disabled',503,'AGENT_UNAVAILABLE','分析服务已由服务端关闭');
 const policy=agentPolicy(ctx.runtime,ctx.businessId);
 const monitorBody=body as {envelope?:{monitorReview?:unknown}}|undefined;
 const monitorPath=/^\/knowledge-(?:runs|source)(?:\/|$)/.test(path)||/^\/runs\/knowledge-/.test(path);
 const monitoredRun=/^\/runs\/[^/]+/.test(path)?await first(ctx.db,"SELECT id FROM neo_runs WHERE id=? AND business_id=? AND json_extract(payload,'$.envelope.monitorReview') IS NOT NULL",path.split('/')[2],ctx.businessId):null;
 const monitorOperation=automaticMonitorAllowed(ctx.runtime,ctx.businessId)&&(monitorPath||!!monitorBody?.envelope?.monitorReview||!!monitoredRun);
 assert(!agentOperation||!policy.isolated||mode==='offline'||policy.manualModelAllowed||monitorOperation,503,'AGENT_UNAVAILABLE','隔离企业未获准连接手动模型服务');
 const base=mode==='offline'?offlineAgentBase(ctx.runtime):ctx.runtime.NEO_AGENT_URL,token=ctx.runtime.NEO_SERVICE_TOKEN;
 assert(base&&token,503,'AGENT_UNAVAILABLE','智能体服务未连接，请启动本地 NEO 服务');
 try{
  if(mode==='offline'){const health=await fetch(base+'/health',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});const h=await health.json() as Record<string,unknown>;assert(health.ok&&h.executionMode==='offline'&&h.modelConfigured===false&&h.marketConfigured===false&&h.autoPatrolEnabled===false,503,'OFFLINE_AGENT_UNAVAILABLE','离线分析服务未证明外部调用与自动巡检已关闭');}
  const r=await fetch(base.replace(/\/$/,'')+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const value=await r.json() as Record<string,unknown>;
  if(!r.ok)throw new ApiError(r.status===422?422:r.status===409?409:503,'AGENT_SERVICE',typeof value.detail==='string'?value.detail:Array.isArray(value.detail)?value.detail.map((d:Record<string,unknown>)=>`${Array.isArray(d.loc)?d.loc.join('.'):''}: ${String(d.msg??'请求校验失败')}`).join('；').slice(0,1000):'智能体服务请求未完成');
  return value;
 }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(503,'AGENT_UNAVAILABLE','智能体服务暂时不可用；已保存任务不会丢失');}
}
async function snapshot(ctx:Context,id:unknown,nature:unknown){
 assert(nature==='demo'||nature==='business',422,'INVALID_NATURE','数据性质无效');
 const row=await first<{payload:string;generated_at:string}>(ctx.db,'SELECT payload,generated_at FROM operating_snapshots WHERE id=? AND business_id=? AND data_nature=?',string(id,'snapshotId',200),ctx.businessId,nature);
 assert(row,404,'NOT_FOUND','快照不存在');return {...JSON.parse(row.payload),generatedAt:row.generated_at} as Snapshot;
}
export async function envelope(ctx:Context,input:Snapshot){
 const row=await first<{payload:string;generated_at:string}>(ctx.db,'SELECT payload,generated_at FROM operating_snapshots WHERE id=? AND business_id=?',input.id,ctx.businessId);
 assert(row,404,'NOT_FOUND','快照不存在');const s={...JSON.parse(row.payload),generatedAt:row.generated_at} as Snapshot;
 assert(!input.dataNature||input.dataNature===s.dataNature,404,'NOT_FOUND','快照不存在');
 const existing=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_inputs WHERE business_id=? AND snapshot_id=?',ctx.businessId,s.id);
 if(existing)return inputProvenance(ctx,s,await decodeInput(existing.payload));
 // evidence_facts fixes the exact record IDs used by this immutable snapshot.
 const rows=await all<{id:string;kind:string;payload:string;source_id:string;available_at:string}>(ctx.db,`SELECT DISTINCT f.id,f.kind,f.payload,f.source_id,b.committed_at available_at FROM business_facts f JOIN evidence_facts ef ON ef.fact_id=f.id JOIN evidence_records e ON e.id=ef.evidence_id JOIN ingestion_batches b ON b.id=f.batch_id WHERE e.business_id=? AND e.snapshot_id=? AND f.business_id=? AND f.data_nature=? AND b.status='committed' AND b.committed_at<=? AND f.kind IN ('events','orders','inventory','expenses') ORDER BY f.id`,ctx.businessId,s.id,ctx.businessId,s.dataNature,s.knownAt??s.generatedAt);
 const records=await all<{kind:string;payload:string}>(ctx.db,'SELECT kind,payload FROM neo_domain_records WHERE business_id=? AND data_nature=? AND created_at<=? ORDER BY id',ctx.businessId,s.dataNature,s.knownAt??s.generatedAt);
 const domain:Record<string,unknown[]>={products:[],skus:[],roles:[],arrivals:[]};
 for(const r of records)if(domain[r.kind])domain[r.kind].push(JSON.parse(r.payload));
 const data={snapshot:s,facts:rows.map(r=>({id:r.id,kind:r.kind,sourceId:r.source_id,availableAt:r.available_at,fact:{...JSON.parse(r.payload),...(s.data?.materials?{resolved_customer_id:s.data.materials.customerLinks?.find(c=>c.factId===r.id)?.customerId??null}:{})}})),domain:s.domain??domain};
 const payload=await encodeInput(data);
 await statement(ctx.db,'INSERT OR IGNORE INTO neo_inputs(id,business_id,snapshot_id,payload,created_at) VALUES(?,?,?,?,?)',uid('input'),ctx.businessId,s.id,payload,stamp()).run();
 return inputProvenance(ctx,s,await decodeInput((await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_inputs WHERE business_id=? AND snapshot_id=?',ctx.businessId,s.id))!.payload));
}
export function normalizeMarketEvidence<T extends {title:string;verificationStatus:string;limitations:string[];content?:string;excerpt?:string}>(item:T):T {
 const text=(item.content??item.excerpt??'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\s+/g,' ').trim();
 const errorPage=/^(?:40[0-9]|50[0-9]|access denied|forbidden)$/i.test(item.title.trim());
 if(item.verificationStatus==='source_read'&&(errorPage||(item.content!=null&&text.length<200)))return {...item,verificationStatus:'unavailable',limitations:[...item.limitations,'原文为错误页或正文不足，不能作为已核实依据。']};
 return {...item,excerpt:text.slice(0,1500)};
}
type RunRow={configurationFreshness?:AgentRun['configurationFreshness'];knowledgeFreshness?:AgentRun['knowledgeFreshness'];communicationError?:string;created_at:string;updated_at:string;id:string;business_id:string;data_nature:string;snapshot_id:string;session_id:string;payload:string;request_hash:string;status:string;steps:string;result:string|null;error:string|null};
function publicRun(r:RunRow){
 const p=JSON.parse(r.payload);const stored=readStoredResult(r.result),result=scopeMarketReferences(stored.result,r.id),observability=stored.observability;
 if(result)result.marketEvidence=result.marketEvidence.map(normalizeMarketEvidence);
 return {...(p.envelope?.operatingPlanRef?{operatingPlanId:p.envelope.operatingPlanRef}:{}),configurationFreshness:r.configurationFreshness??null,knowledgeFreshness:r.knowledgeFreshness??null,id:r.id,runId:r.id,sessionId:r.session_id,snapshotId:r.snapshot_id,question:p.question,mode:p.mode,purpose:p.purpose||"analysis",createdAt:r.created_at,status:r.status,steps:JSON.parse(r.steps),result,error:r.error,observability,communicationError:r.communicationError};
}
async function run(ctx:Context,id:string){const r=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE id=? AND business_id=?',id,ctx.businessId);assert(r,404,'NOT_FOUND','任务不存在');r.knowledgeFreshness=await knowledgeFreshness(ctx,r.data_nature,r.id);if(readStoredResult(r.result).result)r.configurationFreshness=await rowConfigurationFreshness(ctx,r.data_nature,r);return r;}
function checkRunScope(r:RunRow,url:URL){
 assert(!url.searchParams.get('dataNature')||url.searchParams.get('dataNature')===r.data_nature,404,'RUN_SCOPE','分析记录与当前资料性质不同');
 assert(!url.searchParams.get('snapshotId')||url.searchParams.get('snapshotId')===r.snapshot_id,404,'RUN_SCOPE','分析记录与当前快照不同');
}
// Gateway control metadata is durable and never supplied by the worker.
function resumeEventCount(obs:RunObservation|undefined){return Array.isArray(obs?.events)?obs.events.filter((e:{kind?:string})=>e.kind==='resume_requested').length:0;}
function gatewayObservation(r:RunRow){return readStoredResult(r.result).observability??{};}
function withGatewayObservation(r:RunRow,patch:Partial<RunObservation>){
 const previous=readStoredResult(r.result);
 return JSON.stringify(storedObservation(previous.result,{...previous.observability,...patch,gatewayRevision:crypto.randomUUID()}));
}
async function controlState(ctx:Context,r:RunRow,patch:Partial<RunObservation>,status=r.status){
 const result=withGatewayObservation(r,patch);
 const saved=await statement(ctx.db,'UPDATE neo_runs SET status=?,result=?,updated_at=? WHERE id=? AND business_id=? AND updated_at=? AND status=? AND result IS ?',status,result,stamp(),r.id,ctx.businessId,r.updated_at,r.status,r.result).run();
 return {row:await run(ctx,r.id),accepted:saved.meta.changes===1};
}
async function saveServiceState(ctx:Context,r:RunRow,updated:Record<string,unknown>,controlDone=false,cancelAcknowledged=false){
 assert(updated.id===r.id,503,'AGENT_RESPONSE_SCOPE','分析服务返回了其他任务');
 const previous=readStoredResult(r.result);
 const observed=updated.observability as RunObservation|undefined;
 if(previous.observability?.inputHash&&observed?.inputHash)assert(previous.observability.inputHash===observed.inputHash,409,'INPUT_VERSION','本次分析输入版本发生变化，不能继续恢复');
 for(const [field,expected] of [['businessId',ctx.businessId],['snapshotId',r.snapshot_id],['dataNature',r.data_nature]])assert(updated[field]===undefined||updated[field]===expected,503,'AGENT_RESPONSE_SCOPE','分析服务返回范围不匹配');
 assert(['queued','running','completed','failed','cancelled','deferred'].includes(String(updated.status)),503,'AGENT_RESPONSE_STATUS','分析服务状态无效');
 const incoming=updated.result as AgentResult|null|undefined;
 if(incoming)for(const [field,expected] of [['businessId',ctx.businessId],['snapshotId',r.snapshot_id],['dataNature',r.data_nature]])assert(incoming[field]===undefined||incoming[field]===expected,503,'AGENT_RESPONSE_SCOPE','分析结果范围不匹配');
 if(incoming?.businessAssessment)for(const [field,expected] of [['businessId',ctx.businessId],['inputId',r.snapshot_id],['dataNature',r.data_nature]])assert(incoming.businessAssessment.scope[field as 'businessId'|'inputId'|'dataNature']===expected,503,'AGENT_RESPONSE_SCOPE','统一评估范围不匹配');
 const result=scopeMarketReferences(mergeResult(previous.result,incoming),r.id);
 const scopedId=(id:string)=>id.startsWith(r.id+':')?id:`${r.id}:${id}`;
 const ev=[...new Map((result?.marketEvidence??[]).map(normalizeMarketEvidence).map(e=>[scopedId(e.id),e])).values()];
 if(result){const ids=new Map(ev.map(e=>[e.id,scopedId(e.id)]));for(const f of [result.finding,...Object.values(result.specialists??{})]){if(!f)continue;f.evidenceIds=f.evidenceIds.map(id=>ids.get(id)??id);if(f.businessReview)f.businessReview.evidenceIds=f.businessReview.evidenceIds.map(id=>ids.get(id)??id);for(const p of f.organization?.priorities??[])p.evidenceIds=p.evidenceIds.map(id=>ids.get(id)??id);}for(const f of [result.finding,...Object.values(result.specialists??{})]){const w=f?.marketWorkbench;if(!w)continue;for(const entry of [w.judgment,...w.signals,...w.cells])entry.evidenceIds=entry.evidenceIds.map(id=>ids.get(id)??id);for(const source of w.sources)source.id=ids.get(source.id)??source.id;}result.marketEvidence=ev.map(e=>({...e,id:scopedId(e.id)}));}
 if(result?.businessAssessment){
  const ids=new Map(ev.map(e=>[e.id,scopedId(e.id)]));
  const rewrite=(value:unknown):unknown=>typeof value==='string'?(ids.get(value)??[...ids].reduce((out,[id,mapped])=>out.startsWith(id+':paragraph:')?mapped+out.slice(id.length):out,value)):Array.isArray(value)?value.map(rewrite):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)])):value;
  result.businessAssessment=rewrite(result.businessAssessment) as typeof result.businessAssessment;
  result.finding=rewrite(result.finding) as typeof result.finding;result.specialists=rewrite(result.specialists) as typeof result.specialists;if(result.operatingReviews)result.operatingReviews=rewrite(result.operatingReviews) as typeof result.operatingReviews;
  result.businessAssessment.projections={...result.businessAssessment.projections,finding:result.finding,specialists:result.specialists,marketEvidence:result.marketEvidence,...(result.operatingReviews?{operatingReviews:result.operatingReviews as NonNullable<typeof result.businessAssessment.projections.operatingReviews>}:{})};
 }
 const remote=observed??incoming?.runtime??previous.observability;
 const local=previous.observability??{};
 const observability:RunObservation={...remote,...(local.resumePending!==undefined?{resumePending:local.resumePending}:{})};
 for(const key of Object.keys(observability))if(key.startsWith('gateway')||key==='localCancelledBeforeDispatch')delete observability[key];
 // Remote responses cannot clear local cancellation, dispatch or control intent.
 for(const [key,value] of Object.entries(local))if(key.startsWith('gateway')||key==='localCancelledBeforeDispatch')observability[key]=value;
 if(cancelAcknowledged)observability.gatewayCancelAcknowledged=true;
 if(controlDone){observability.gatewayControl=null;observability.resumePending=false;}
 else if(local.gatewayControl){
  const resolved=local.gatewayControl==='resume_unknown'&&(['queued','running','completed'].includes(String(updated.status))||resumeEventCount(remote)>Number(local.gatewayResumeEvents??0));
  observability.gatewayControl=resolved?null:local.gatewayControl;observability.resumePending=!resolved;
 }
 if(local.gatewayCancellationRequested===true){
  if(['queued','running'].includes(String(updated.status)))observability.gatewayCancelAcknowledged=false;
  const terminal=['cancelled','failed','completed'].includes(String(updated.status));
  observability.cancellationPending=!(observability.gatewayCancelAcknowledged===true&&terminal&&remote?.cancellationPending!==true&&local.gatewayDispatch!=='sending'&&observability.gatewayControl!=='resume'&&observability.gatewayControl!=='resume_unknown');
  if(observability.cancellationPending)observability.retryable=false;
 }
 const revision=crypto.randomUUID();observability.gatewayRevision=revision;
 const stored=storedObservation(result,observability);
 const statements=[statement(ctx.db,'UPDATE neo_runs SET status=?,steps=?,result=?,error=?,updated_at=? WHERE id=? AND business_id=? AND updated_at=? AND status=? AND result IS ?',updated.status,JSON.stringify(mergeSteps(JSON.parse(r.steps),updated.steps)),JSON.stringify(stored),updated.error===undefined?r.error:updated.error,stamp(),r.id,ctx.businessId,r.updated_at,r.status,r.result)];
 // The same transaction accepts evidence only for the accepted state revision.
 for(const item of ev){const eid=scopedId(item.id);statements.push(statement(ctx.db,"INSERT OR IGNORE INTO neo_market_evidence(id,business_id,snapshot_id,run_id,payload,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM neo_runs WHERE id=? AND business_id=? AND json_extract(result,'$.runtime.gatewayRevision')=?)",eid,ctx.businessId,r.snapshot_id,r.id,JSON.stringify({...item,id:eid,sourceEvidenceId:item.sourceEvidenceId??item.id}),stamp(),r.id,ctx.businessId,revision));}
 if(r.status!==updated.status||JSON.stringify(previous.result)!==JSON.stringify(result))statements.push(statement(ctx.db,"INSERT OR IGNORE INTO audit_events(id,business_id,actor_id,action,resource_id,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM neo_runs WHERE id=? AND business_id=? AND json_extract(result,'$.runtime.gatewayRevision')=?)",'agent-result:'+revision,ctx.businessId,'agent-sync','business:review_result',r.id,stamp(),r.id,ctx.businessId,revision));
 await ctx.db.batch(statements);if(result?.businessAssessment)await recordKnowledgeDependencies(ctx,r.data_nature,r.id,result.businessAssessment);return run(ctx,r.id);
}
async function reconcileCancellation(ctx:Context,r:RunRow){
 const obs=gatewayObservation(r);
 if(obs.localCancelledBeforeDispatch===true)return r;
 if(obs.gatewayCancelAcknowledged!==true){
  r=await saveServiceState(ctx,r,await service(ctx,`/runs/${encodeURIComponent(r.id)}/cancel`,{}),false,true);
  return r;
 }
 if(obs.cancellationPending!==true&&obs.gatewayDispatch!=='sending'&&obs.gatewayControl!=='resume'&&obs.gatewayControl!=='resume_unknown')return r;
 return saveServiceState(ctx,r,await service(ctx,`/runs/${encodeURIComponent(r.id)}`));
}
async function sync(ctx:Context,initial:RunRow,forceRemote=false):Promise<RunRow>{
 let r=await run(ctx,initial.id);
 try{
  let obs=gatewayObservation(r);
  if(obs.gatewayDispatchRejected===true&&r.status==='failed')return r;
  if(obs.localCancelledBeforeDispatch===true&&obs.gatewayDispatch!=='not_sent'){
   r=(await controlState(ctx,r,{localCancelledBeforeDispatch:false,gatewayCancellationRequested:true,gatewayCancelAcknowledged:false,cancellationPending:true,retryable:false})).row;obs=gatewayObservation(r);
  }
  if(obs.gatewayCancellationRequested===true){
   if(obs.gatewayDispatch==='sending'&&Date.now()-Number(obs.gatewayDispatchStartedAt)>=90000)r=(await controlState(ctx,r,{gatewayDispatch:'unknown'})).row;
   return await reconcileCancellation(ctx,r);
  }
  // A published failed response is terminal until the user explicitly resumes
  // it. Legacy/local failures with no stored result get one remote reconciliation
  // so a worker-side partial result is not hidden forever. Once stored, ordinary
  // page reads still do not fan out repeated remote GETs.
  const hasStoredResult=readStoredResult(r.result).result!==null;
  if(!forceRemote&&(r.status==='completed'||r.status==='failed'&&hasStoredResult&&!obs.gatewayControl&&obs.resumePending!==true&&obs.gatewayCancellationRequested!==true||obs.localCancelledBeforeDispatch===true))return r;
  if(r.status==='pending_dispatch'){
   // Claim before HTTP. A missing legacy marker means unknown, never "not sent".
   if(obs.gatewayDispatch==='sending'&&Date.now()-Number(obs.gatewayDispatchStartedAt)<90000)return r;
   // Missing connection configuration proves HTTP cannot have started.
   assert(ctx.runtime.NEO_SERVICE_TOKEN&&(ctx.runtime.agentExecutionMode==='offline'?offlineAgentBase(ctx.runtime):ctx.runtime.NEO_AGENT_URL),503,'AGENT_UNAVAILABLE','智能体服务未连接，请启动本地 NEO 服务');
   const claimed=await controlState(ctx,r,{gatewayDispatch:'sending',gatewayDispatchStartedAt:Date.now()});
   if(!claimed.accepted)return claimed.row;r=claimed.row;
   try{try{await service(ctx,'/runs',JSON.parse(r.payload));}catch(e){
    // HTTP 422 is a received validation rejection, so no remote job was accepted.
    // Retain the immutable payload and surface the failure instead of resending it.
    if(e instanceof ApiError&&e.status===422){const latest=await run(ctx,r.id),cancelled=gatewayObservation(latest).gatewayCancellationRequested===true;r=(await controlState(ctx,latest,{gatewayDispatch:'rejected',gatewayDispatchRejected:true,errorCode:'DISPATCH_REJECTED',gatewayCancelAcknowledged:cancelled,cancellationPending:false,retryable:false},'failed')).row;return saveServiceState(ctx,r,{id:r.id,status:'failed',steps:[],error:e.message},false,cancelled);}
    throw e;
   }}
   catch(e){
    const current=await run(ctx,r.id);
    if(gatewayObservation(current).gatewayDispatch==='sending')await controlState(ctx,current,{gatewayDispatch:'unknown'});
    throw e;
   }
   // Read latest control intent after acknowledgement; do not apply the late POST reply.
   r=await run(ctx,r.id);
   if(gatewayObservation(r).gatewayDispatch==='sending')r=(await controlState(ctx,r,{gatewayDispatch:'confirmed'})).row;
   if(gatewayObservation(r).gatewayCancellationRequested===true)return await reconcileCancellation(ctx,r);
  }
  return await saveServiceState(ctx,r,await service(ctx,`/runs/${encodeURIComponent(r.id)}`));
 }catch(e){if(e instanceof ApiError&&e.status===503){const latest=await run(ctx,r.id);return {...latest,communicationError:e.message,error:latest.error??e.message};}throw e;}
}
async function cancelRun(ctx:Context,id:string):Promise<RunRow>{
 for(let attempt=0;attempt<4;attempt++){
  const r=await run(ctx,id),obs=gatewayObservation(r);
  if(obs.gatewayCancellationRequested===true)return sync(ctx,r);
  // Only the initial not_sent marker can prove no sender claimed the task.
  const neverSent=r.status==='pending_dispatch'&&obs.gatewayDispatch==='not_sent';
  const claimed=await controlState(ctx,r,{gatewayCancellationRequested:true,gatewayCancelAcknowledged:neverSent,cancellationPending:!neverSent,localCancelledBeforeDispatch:neverSent,retryable:neverSent},neverSent?'cancelled':r.status);
  if(claimed.accepted)return neverSent?claimed.row:sync(ctx,claimed.row);
 }
 throw new ApiError(409,'CONTROL_CONFLICT','分析状态正在变化，请再次核对停止状态');
}
async function finishResume(ctx:Context,id:string,token:string,unknown:boolean){
 for(let attempt=0;attempt<4;attempt++){
  const r=await run(ctx,id),obs=gatewayObservation(r);
  if(obs.gatewayControlToken!==token||!obs.gatewayControl)return r;
  const cancelled=obs.gatewayCancellationRequested===true;
  const done=await controlState(ctx,r,{gatewayControl:unknown?'resume_unknown':null,resumePending:unknown,...(cancelled?{gatewayCancelAcknowledged:false,cancellationPending:true}:{}),...(unknown?{retryable:false}:{})});
  if(done.accepted)return done.row;
 }
 return run(ctx,id);
}
async function resumeRun(ctx:Context,id:string):Promise<RunRow>{
 const r=await run(ctx,id),obs=gatewayObservation(r);
 if(obs.cancellationPending||obs.gatewayDispatch==='sending')throw new ApiError(409,'CANCEL_PENDING','本次分析仍在停止收尾，请等待已有结论保存后再继续');
 if(obs.gatewayControl)throw new ApiError(409,'RESUME_PENDING','继续分析的回应尚未确认，请先核对任务状态，不能重复恢复');
 const neverSent=obs.localCancelledBeforeDispatch===true&&obs.gatewayDispatch==='not_sent';
 if(obs.localCancelledBeforeDispatch===true&&!neverSent)throw new ApiError(409,'CANCEL_PENDING','旧任务的发送状态尚未核实，请先核对停止状态');
 const token=crypto.randomUUID();
 const claimed=await controlState(ctx,r,{gatewayControl:neverSent?null:'resume',gatewayControlToken:token,gatewayResumeEvents:resumeEventCount(obs),resumePending:!neverSent,gatewayCancellationRequested:false,gatewayCancelAcknowledged:false,localCancelledBeforeDispatch:false,...(neverSent?{gatewayDispatch:'not_sent'}:{})},neverSent?'pending_dispatch':r.status);
 assert(claimed.accepted,409,'CONTROL_CONFLICT','分析状态已变化，请先核对后再继续');
 if(neverSent)return sync(ctx,claimed.row);
 try{
  const updated=await service(ctx,`/runs/${encodeURIComponent(id)}/resume`,{});
  const saved=await saveServiceState(ctx,claimed.row,updated,true);
  const released=await finishResume(ctx,id,token,false);
  return gatewayObservation(released).gatewayCancellationRequested===true||gatewayObservation(saved).gatewayRevision!==gatewayObservation(released).gatewayRevision?sync(ctx,released,true):released;
 }catch(e){
  await finishResume(ctx,id,token,e instanceof ApiError&&e.status===503);
  if(gatewayObservation(await run(ctx,id)).gatewayCancellationRequested===true)return sync(ctx,await run(ctx,id));
  throw e;
 }
}

async function artifact(ctx:Context,id:string,kind?:string){const r=await first<{payload:string;kind:string;snapshot_id:string;data_nature:string}>(ctx.db,'SELECT * FROM neo_artifacts WHERE id=? AND business_id=?',id,ctx.businessId);assert(r&&(!kind||r.kind===kind),404,'NOT_FOUND','结果不存在');return {row:r,value:JSON.parse(r.payload)};}
export function recordPeriodStart(purpose:string,now=new Date()){
 const local=new Date(now.getTime()+8*3600000);local.setUTCHours(0,0,0,0);
 if(purpose==='weekly')local.setUTCDate(local.getUTCDate()-((local.getUTCDay()+6)%7));
 return new Date(local.getTime()-8*3600000).toISOString();
}
export async function decisionContext(ctx:Context,s:Snapshot,purpose:string){
 const since=recordPeriodStart(purpose);
 const rows=await all<RunRow>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND status='completed' AND COALESCE(json_extract(payload,'$.purpose'),'analysis') NOT IN ('briefing','weekly','home') ORDER BY created_at DESC,rowid DESC LIMIT 60",ctx.businessId,s.dataNature,s.id);
 const chosen=new Map<string,RunRow>();
 for(const r of rows){const p=JSON.parse(r.payload);if(p.envelope?.scenarioRecommendationRef)continue;if(['briefing','weekly','home'].includes(p.purpose))continue;const key=purpose==='home'?`${p.mode}:${p.purpose??'analysis'}`:p.mode;if(!chosen.has(key))chosen.set(key,r);}
 const findings=[...chosen.values()].map(r=>{const p=JSON.parse(r.payload),v=JSON.parse(r.result!);return {id:r.id,mode:p.mode,createdAt:r.created_at,finding:v.finding,specialists:v.specialists};});
 const records=await all<{payload:string;kind:string;created_at:string}>(ctx.db,'SELECT payload,kind,created_at FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? ORDER BY created_at DESC,rowid DESC',ctx.businessId,s.dataNature,s.id);
 const inPeriod=records.filter(r=>purpose!=='weekly'||r.created_at>=since);
 const scenarios=inPeriod.filter(r=>r.kind==='scenario').map(r=>JSON.parse(r.payload));
 const decisions=await Promise.all(inPeriod.filter(r=>r.kind==='decision').map(r=>{const value=JSON.parse(r.payload);return readDecision(ctx,value,{businessId:ctx.businessId,dataNature:s.dataNature,snapshotId:s.id,ontologyRef:value.ontologyRef});}));
 const forecasts=records.filter(r=>r.kind==='forecast').map(r=>JSON.parse(r.payload));
 // Market rows inherit nature from the globally unique, validated snapshot ID.
 const sources=await all<{payload:string}>(ctx.db,'SELECT payload FROM neo_market_evidence WHERE business_id=? AND snapshot_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?',ctx.businessId,s.id,purpose==='home'?220:20);
 const marketReviews=findings.filter(r=>r.finding?.marketWorkbench);
 const selectedIds=new Set(marketReviews.flatMap(r=>r.finding.marketWorkbench.sources.filter((x:{selected:boolean})=>x.selected).map((x:{id:string})=>x.id)));
 const citedIds=new Set(findings.flatMap(r=>r.finding?.evidenceIds??[]));
 const marketSources=sources.map(r=>normalizeMarketEvidence(JSON.parse(r.payload)));
 const relevantSources=purpose==='home'&&marketReviews.length?marketSources.filter(r=>selectedIds.has(r.id)||citedIds.has(r.id)):marketSources;
 const inputHash=await hash(JSON.stringify({findings:findings.map(r=>r.id),scenarios:scenarios.map(r=>r.id),decisions:decisions.map(r=>r.id),forecasts:forecasts.map(r=>r.id),marketEvidence:sources.map(r=>r.payload)}));
 return {meta:{capturedAt:stamp(),asOf:s.asOf,recordPeriodStart:since,recordTimezone:'Asia/Shanghai',inputHash,purpose},findings,scenarios,decisions,forecasts,marketEvidence:relevantSources,...purpose==='home'?{marketSourceSelection:{method:marketReviews.length?'saved_ai_selection':'saved_sources_pending_selection',candidateCount:marketSources.length,selectedCount:relevantSources.length,reviewIds:marketReviews.map(r=>r.id)}}:{},limitations:['方案是条件推演；保存选择不是执行记录或实际收益。','周报的记录时间与经营快照时间分别表达。']};
}
async function mirrorPatrols(ctx:Context,s:Snapshot){
 if(!agentPolicy(ctx.runtime,ctx.businessId).automaticPatrolAllowed)return;
 try{
  const response=await service(ctx,`/patrols/${encodeURIComponent(s.id)}?businessId=${encodeURIComponent(ctx.businessId)}`);
  for(const job of (response.items??[]) as Array<{id:string;createdAt:string;payload:{businessId:string;snapshotId:string;dataNature:string;sessionId:string}}>){
   const p=job.payload;if(p.businessId!==ctx.businessId||p.snapshotId!==s.id||p.dataNature!==s.dataNature)continue;
   const existing=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE id=? AND business_id=?',job.id,ctx.businessId);if(existing){await sync(ctx,existing);continue;}
   await statement(ctx.db,'INSERT OR IGNORE INTO neo_sessions(id,business_id,data_nature,snapshot_id,actor_id,created_at) VALUES(?,?,?,?,?,?)',p.sessionId,ctx.businessId,s.dataNature,s.id,ctx.userId,job.createdAt).run();
   await statement(ctx.db,"INSERT OR IGNORE INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'queued','[]',?,?)",job.id,ctx.businessId,s.dataNature,s.id,p.sessionId,`automatic:${job.id}`,await hash(JSON.stringify(p)),JSON.stringify(p),job.createdAt,stamp()).run();
   await sync(ctx,await run(ctx,job.id));
  }
 }catch(e){if(!(e instanceof ApiError&&e.status===503))throw e;}
}

export async function queuePatrol(request:Request,ctx:Context,s:Snapshot){
 if(await first(ctx.db,'SELECT id FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=? AND enabled=1',ctx.businessId,s.dataNature))return {status:'managed_by_knowledge_monitor'};
 if(!agentPolicy(ctx.runtime,ctx.businessId).automaticPatrolAllowed)return {status:'disabled',notice:agentPolicy(ctx.runtime,ctx.businessId).notice};
 const url=new URL(request.url);url.pathname='/api/v1/agent-runs';url.search=new URLSearchParams({businessId:ctx.businessId,dataNature:s.dataNature,snapshotId:s.id}).toString();
 const queued=await handleAgents(new Request(url,{method:'POST',headers:request.headers,body:JSON.stringify({snapshotId:s.id,dataNature:s.dataNature,mode:'joint',purpose:'patrol',requestId:patrolRequestId(s.id),question:PATROL_QUESTION})}),ctx,['agent-runs']);
 return queued?await queued.json():null;
}
export async function handleAgents(request:Request,ctx:Context,segments:string[],ontologyEnvelope?:Record<string,unknown>,homeBasis?:HomeDecisionBasis,trustedReview=false,monitorReview?:Record<string,unknown>):Promise<Response|null>{
 const [resource,id,action]=segments;const url=new URL(request.url);
 if(resource==='scenario-recommendations')return handleScenarioRecommendations(request,ctx,segments);
 if(!['decision-workbench','home-sections','supply-overview','market-workbench','customer-journey','policy-briefing','growth-reviews','home-decision','agent-policy','agent-runs','agent-evidence','agent-sessions','forecasts','scenarios','decisions','briefings','reports','agent-domain','market-evidence'].includes(resource))return null;
 if(resource==='agent-evidence'){
  assert(request.method==='GET'&&id&&!action,405,'METHOD','只支持读取已保存回答的证据');
  const row=await run(ctx,id.split('~')[0]);checkRunScope(row,url);const saved=publicRun(row),a=saved.result?.businessAssessment;
  assert(a&&a.scope.businessId===row.business_id&&a.scope.dataNature===row.data_nature&&a.scope.inputId===row.snapshot_id,422,'RUN_EVIDENCE','已保存回答没有同范围的陈述证据');
  const claimIds=url.searchParams.getAll('claimId');assert(claimIds.every(key=>(a.claims??[]).some(c=>c.id===key)),404,'CLAIM_NOT_FOUND','已保存回答不存在该陈述');
  let envelope=JSON.parse(row.payload).envelope??{};
  if(envelope.envelopePacked)envelope=await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',...envelope.envelopePacked}));
  const period=envelope.conversation?.active?.period??envelope.operatingBasis?.period??(envelope.snapshot?.periodStart&&envelope.snapshot?.periodEnd?{start:envelope.snapshot.periodStart,end:envelope.snapshot.periodEnd}:null);
  const queryEvidence=(saved.result?.toolReads as Array<{queryEvidence?:Record<string,unknown>}>??[]).flatMap(r=>r.queryEvidence?[r.queryEvidence]:[]);
  const sourceEvidenceIds=[...new Set([saved.result?.finding,...Object.values(saved.result?.specialists??{})].flatMap(f=>f?.evidenceIds??[]))];
  return json({run:saved,claimIds,period,sourceEvidenceIds,queryEvidence});
 }
 if(resource==='market-workbench'){
  assert(['GET','POST'].includes(request.method)&&!id,405,'METHOD','只支持读取或更新渠道经营分析');
  const body=request.method==='POST'?await agentBody(request):null;
  const s=await snapshot(ctx,body?.snapshotId??url.searchParams.get('snapshotId'),body?.dataNature??url.searchParams.get('dataNature'));
  let saved=await savedMarketReview(ctx,s);
  if(body){
   requireWrite(request,ctx);requireAgentExecution(ctx.runtime,ctx.businessId,'review');assert(body.refresh===undefined||typeof body.refresh==='boolean',422,'REFRESH','更新标记须为布尔值');
   const suffix=body.refresh?string(body.requestId,'requestId',40):'auto';
   if(!saved.row||body.refresh){const target=new URL(request.url);target.pathname='/api/v1/agent-runs';
    const result=await handleAgents(new Request(target,{method:'POST',headers:request.headers,body:JSON.stringify({snapshotId:s.id,dataNature:s.dataNature,mode:'market',purpose:'review',requestId:`${MARKET_REVIEW_VERSION}:${(await hash(s.id)).slice(0,24)}:${suffix}`,question:'筛选相关行业与竞品原文，结合后台渠道和货盘的四周对比，输出完整marketWorkbench供渠道与竞品工作台使用。所有判断及原文筛选都由大模型完成。',budget:{maxModelCalls:null,maxTokens:null,maxToolCalls:null,maxMarketSearches:agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed?null:0,completionTokens:null,timeoutSeconds:600}})}),ctx,['agent-runs'],undefined,undefined,true);
    assert(result,503,'MARKET_UNAVAILABLE','市场智能体未返回任务');if(!result.ok)return result;saved=await savedMarketReview(ctx,s);
   }
  }
  const fixed=await envelope(ctx,s),candidates=(await marketCandidates(ctx,s,saved.review?.sources.filter(x=>x.selected).map(x=>x.id))).map(normalizeMarketEvidence);
  const base=marketWorkbench(s,fixed.facts,fixed.domain as MarketDomain,candidates);
  return json({...modelMarketPresentation(base,saved.review,candidates),run:saved.row?publicRun(saved.row as RunRow):null,model:saved.model,canGenerate:ctx.role!=='reader'&&agentPolicy(ctx.runtime,ctx.businessId).interactiveAllowed},body?202:200);
 }
 if(resource==='customer-journey'){
  assert(request.method==='GET'&&!id,405,'METHOD','只支持读取客户旅程');
  const s=await snapshot(ctx,url.searchParams.get('snapshotId'),url.searchParams.get('dataNature')),fixed=await envelope(ctx,s);
  return json({journey:s.data.customerJourney??customerJourney(s,fixed.facts as JourneyFact[]),review:await specialistReview(ctx,s,'conversion')});
 }
 if(resource==='supply-overview'){
  assert(request.method==='GET'&&!id,405,'METHOD','只支持读取供应链摘要');
  const s=await snapshot(ctx,url.searchParams.get('snapshotId'),url.searchParams.get('dataNature'));
  return json({...supplyOverview(s,await specialistReview(ctx,s,'supply')),canGenerate:ctx.role!=='reader'&&agentPolicy(ctx.runtime,ctx.businessId).interactiveAllowed});
 }
 if(resource==='home-sections'){
  assert(request.method==='GET'&&!id,405,'METHOD','只支持读取首页板块');
  const s=await snapshot(ctx,url.searchParams.get('snapshotId'),url.searchParams.get('dataNature'));
  const read=async(name:string)=>{const target=new URL(request.url);target.pathname='/api/v1/'+name;target.searchParams.set('snapshotId',s.id);target.searchParams.set('dataNature',s.dataNature);const response=await handleAgents(new Request(target,{headers:request.headers}),ctx,[name]);assert(response?.ok,503,'HOME_SECTION','经营板块暂未读取成功');return response!.json();};
  const [people,goods,market]=await Promise.all([read('customer-journey'),read('supply-overview'),read('market-workbench')]);
  return json(homeSections(s,people,goods,market));
 }
 if(resource==='decision-workbench'){
  assert(['GET','POST'].includes(request.method)&&!id,405,'METHOD','只支持读取或更新协同判断');
  const input=request.method==='POST'?await agentBody(request):null;
  if(input){requireWrite(request,ctx);assert(input.refresh==null||typeof input.refresh==='boolean',422,'INVALID_REFRESH','刷新参数必须为布尔值');}
  const s=await snapshot(ctx,input?.snapshotId??url.searchParams.get('snapshotId'),input?.dataNature??url.searchParams.get('dataNature'));
  const child=async(name:string,body?:Record<string,unknown>)=>{const target=new URL(request.url);target.pathname='/api/v1/'+name;target.searchParams.set('snapshotId',s.id);target.searchParams.set('dataNature',s.dataNature);const result=await handleAgents(new Request(target,{headers:request.headers,...body?{method:'POST',body:JSON.stringify(body)}:{}}),ctx,[name]);assert(result,503,'DECISION_UNAVAILABLE','协同资料尚未读取成功');return result;};
  if(input){const prepared=await child('home-decision',{snapshotId:s.id,dataNature:s.dataNature,...input.refresh===true?{refresh:true,requestId:input.requestId}:{}});if(!prepared.ok)return prepared;}
  const names=['home-sections','home-decision','forecasts','scenarios','decisions','agent-domain'];
  const reads=await Promise.all(names.map(name=>child(name)));for(const r of reads)if(!r.ok)return r;
  const [sections,home,forecasts,scenarios,decisions,domain]=await Promise.all(reads.map(r=>r.json()));
  return json(decisionWorkbench(s,sections,home,forecasts.items,scenarios.items,decisions.items,domain as DecisionDomain,url.searchParams.get('baselineId')),input?202:200);
 }
 if(resource==='policy-briefing')return handlePolicyBriefing(request,ctx,{snapshot,body:agentBody});
 if(resource==='growth-reviews')return handleGrowthReviews(request,ctx,{snapshot,publicRun:r=>publicRun(r as RunRow),body:agentBody,api:handleAgents});
 if(resource==='home-decision')return handleHomeDecision(request,ctx,{snapshot,context:decisionContext,publicRun:r=>publicRun(r as RunRow),body:agentBody,api:handleAgents});
 if(resource==='agent-policy'){
  assert(request.method==='GET',405,'METHOD','只支持读取');
  const s=await snapshot(ctx,url.searchParams.get('snapshotId'),url.searchParams.get('dataNature')),config=await activePlatformSettings(ctx,s.dataNature),policy=agentPolicy(ctx.runtime,ctx.businessId);
  const subscription=await first<{enabled:number}>(ctx.db,'SELECT enabled FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?',ctx.businessId,s.dataNature);
  const automaticMonitoringAllowed=automaticMonitorAllowed(ctx.runtime,ctx.businessId)&&subscription?.enabled===1;
  // The daily monitor owns automatic assessment. Do not enable the legacy
  // page-triggered patrol, which would submit a duplicate paid task.
  return json({...policy,automaticMonitoringAllowed,automaticAssessmentAllowed:automaticMonitoringAllowed,
   notice:automaticMonitoringAllowed?`${policy.isolated?'当前使用模拟经营资料；':''}后台监控与自动经营研判已开启，每日 09:00 检查，重要变化触发研判。${policy.interactiveAllowed?'可继续手动对话。':''}`:policy.notice,
   configurationId:config.id,disabledAgentRoles:Object.entries(config.settings.agents).filter(([,a])=>!a.enabled).map(([r])=>r)});
 }
 if(resource==='agent-domain'){
  if(request.method==='GET'){const s=await snapshot(ctx,url.searchParams.get('snapshotId'),url.searchParams.get('dataNature'));const fixed=await envelope(ctx,s);return json({...fixed.domain,facts:fixed.facts});}
  requireWrite(request,ctx);assert(request.method==='POST',405,'METHOD','只支持导入');const input=await agentBody(request);
  assert(input.dataNature==='demo',422,'DEMO_ONLY','此入口仅用于合成补充数据');
  const records=input.records;assert(Array.isArray(records)&&records.length<=200,422,'INVALID_RECORDS','最多200条领域记录');
  const statements=[];
  for(const r of records){assert(r&&['products','skus','roles','arrivals'].includes(r.kind),422,'INVALID_KIND','领域类型无效');const identifier=string(r.id,'id',160);assert(r.payload&&typeof r.payload==='object',422,'INVALID_PAYLOAD','领域数据无效');
   if(r.kind==='arrivals')assert(typeof r.payload.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.payload.date)&&Number.isInteger(r.payload.units)&&r.payload.units>=0&&r.payload.skuId&&r.payload.warehouseId,422,'INVALID_ARRIVAL','到货计划字段无效');
   const key=`${ctx.businessId}:demo:${r.kind}:${identifier}`;const payload=JSON.stringify({...r.payload,id:identifier,provenance:'SYNTHETIC_DEMO'});
   const previous=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_domain_records WHERE id=?',key);assert(!previous||previous.payload===payload,409,'DOMAIN_CONFLICT','领域记录已存在且内容不同，请使用新版本ID');
   statements.push(statement(ctx.db,'INSERT OR IGNORE INTO neo_domain_records VALUES(?,?,?,?,?,?)',key,ctx.businessId,'demo',r.kind,payload,stamp()));}
  if(statements.length)await ctx.db.batch(statements);return json({imported:records.length});
 }
 if(resource==='agent-runs'){
  if(!id&&request.method==='POST'){
   requireWrite(request,ctx);const input=await agentBody(request);const s=await snapshot(ctx,input.snapshotId,input.dataNature);const mode=string(input.mode,'mode',30);assert(modes.includes(mode),422,'MODE','智能体模式无效');
   const purpose=typeof input.purpose==='string'?input.purpose:'analysis';assert(['analysis','patrol','briefing','weekly','home','review'].includes(purpose),422,'PURPOSE','任务用途无效');assert(purpose==='analysis'||(purpose==='review'?['conversion','supply','market','joint'].includes(mode):purpose==='patrol'?mode==='joint':mode==='orchestrator'),422,'PURPOSE_MODE','整理或巡检任务模式无效');
   assert(purpose!=='review'||trustedReview,403,'REVIEW_ENDPOINT','专业审查须通过统一审查接口生成');
   assert(purpose!=='home'||homeBasis,403,'HOME_ENDPOINT','首页判断须通过统一首页接口生成');
   if(monitorReview)assert(automaticMonitorAllowed(ctx.runtime,ctx.businessId),403,'MONITOR_DISABLED','自动监控未获服务端授权');else requireAgentExecution(ctx.runtime,ctx.businessId,purpose);const requestedBudget=validatedBudget(input.budget);
   const policy=agentPolicy(ctx.runtime,ctx.businessId);
   // Only server policy can permit public research for an isolated business.
   // Browser budgets cannot restore a disabled provider.
   const taskType=recognizeTask(String(input.question??''),purpose),capped=taskBudget(taskType,requestedBudget);
   let budget=!policy.marketSearchAllowed?{...capped,maxMarketSearches:0}:capped;
   const question=string(input.question,'question'),requestId=purpose==='patrol'?patrolRequestId(s.id):string(input.requestId,'requestId',100);
   if(purpose==='patrol'){await mirrorPatrols(ctx,s);const daily=await first<RunRow>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND json_extract(payload,'$.purpose')='patrol' AND created_at>=? ORDER BY created_at DESC LIMIT 1",ctx.businessId,s.dataNature,s.id,recordPeriodStart('briefing'));if(daily)return json(publicRun(await sync(ctx,daily)));}assert(input.operatingPlanId===undefined||typeof input.operatingPlanId==='string'&&mode==='orchestrator'&&purpose==='analysis',422,'OPERATING_MODE','经营调度只用于行动编排对话');const operatingPlanning=input.operatingPlanId?await (await import('./operating-plans.ts')).operatingPlanForAgent(ctx,s.dataNature,input.operatingPlanId,s.id):null;const dialogueScope=validateDialogueScope(input.dialogueScope);const requestParts=[s.id,mode,question,input.sessionId??null,purpose,...(input.dialogueScope?[dialogueScope]:[]),...(operatingPlanning?[operatingPlanning.id]:[]),...(input.recoveryFrom?[input.recoveryFrom]:[])];const requestHash=await hash(JSON.stringify(budget?{request:requestParts,budget}:requestParts));
   const previous=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId);if(previous){assert(previous.request_hash===requestHash,409,'REQUEST_CONFLICT','请求ID已用于不同问题');return json(publicRun(await sync(ctx,previous)));}
   const sessionId=input.sessionId?string(input.sessionId,'sessionId',100):uid('session');
   if(input.sessionId)await assertSession(ctx,sessionId,s.dataNature,'snapshot');
   else await statement(ctx.db,'INSERT INTO neo_sessions(id,business_id,data_nature,snapshot_id,actor_id,created_at) VALUES(?,?,?,?,?,?)',sessionId,ctx.businessId,s.dataNature,s.id,ctx.userId,stamp()).run();
   const fixed:Record<string,unknown>={...await configuredAgentEnvelope(ctx,s.dataNature,mode,ontologyEnvelope??await envelope(ctx,s)),knowledge:await knowledgeContext(ctx,s.dataNature)};const latest=await first<{id:string}>(ctx.db,'SELECT id FROM operating_snapshots WHERE business_id=? AND data_nature=? ORDER BY generated_at DESC LIMIT 1',ctx.businessId,s.dataNature);
   const journey=!ontologyEnvelope?(s.data.customerJourney??customerJourney(s,fixed.facts as JourneyFact[])):null;
   const savedContext=await decisionContext(ctx,s,purpose);
   if(ontologyEnvelope){const ref=ontologyEnvelope.ontologyRef as {knownAt:string;buildId:string};for(const key of ['findings','scenarios','decisions','forecasts'] as const)savedContext[key]=savedContext[key].filter((r:{createdAt?:string;ontologyRef?:{buildId:string}})=>!!r.createdAt&&r.createdAt<=ref.knownAt&&(!r.ontologyRef||r.ontologyRef.buildId===ref.buildId));savedContext.marketEvidence=savedContext.marketEvidence.filter((e:{retrievedAt?:string})=>!!e.retrievedAt&&e.retrievedAt<=ref.knownAt);savedContext.meta.inputHash=await hash(JSON.stringify(savedContext));}
   const marketBasis=requestId.startsWith(MARKET_REVIEW_VERSION+':')&&mode==='market'&&purpose==='review'&&!ontologyEnvelope?marketModelBasis(marketWorkbench(s,fixed.facts as JourneyFact[],fixed.domain as MarketDomain,[]),(await marketCandidates(ctx,s)).map(normalizeMarketEvidence),s):null;
   const conversation=await freezeConversation(ctx,sessionId,s.dataNature,s.id,'snapshot',{...fixed,decisionContext:savedContext},dialogueScope,question),history=conversation.history;
   const selectedScenarios=conversation.active.scenarioIds?savedContext.scenarios.filter((r:{id:string})=>conversation.active.scenarioIds!.includes(r.id)):taskType==='DECIDE'?savedContext.scenarios:[];
   assert(!dialogueScope.scenarioIds||dialogueScope.scenarioIds.every(id=>selectedScenarios.some((r:{id:string})=>r.id===id)),404,'SCENARIO_SCOPE','方案不属于当前快照');
   const scenarioContext={snapshotId:s.id,results:selectedScenarios,scenarios:selectedScenarios.map((r:{id:string;title?:string;assumptions?:unknown})=>({id:r.id,name:r.title??r.id,parameters:r.assumptions}))};
   const finalCaps=taskBudget(taskType,requestedBudget,{scenarioCount:selectedScenarios.length});budget=!policy.marketSearchAllowed?{...finalCaps,maxMarketSearches:0}:finalCaps;
   const ident=uid('run');let payload:Record<string,unknown>={id:ident,businessId:ctx.businessId,dataNature:s.dataNature,snapshotId:s.id,sessionId,mode,purpose,taskType,autoRepeat:!monitorReview&&purpose==='patrol'&&agentPolicy(ctx.runtime,ctx.businessId).automaticPatrolAllowed&&latest?.id===s.id,question,envelope:await transportEnvelope({...fixed,...(operatingPlanning?{operatingPlanning}:{}),...(monitorReview?{monitorReview}:{}),conversation,scenarioContext,runtimeScope:{businessId:ctx.businessId,dataNature:s.dataNature,inputId:s.id,asOf:s.asOf,...researchTime(stamp())},...(marketBasis?{marketWorkbenchBasis:marketBasis}:{}),...(journey?{customerJourney:journey}:{}),decisionContext:savedContext,...(homeBasis?{homeDecisionContext:homeBasis}:{})}),history,budget};
   if(input.recoveryFrom){
    const parent=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE id=? AND business_id=? AND data_nature=? AND snapshot_id=?',string(input.recoveryFrom,'recoveryFrom',100),ctx.businessId,s.dataNature,s.id);
    assert(parent&&parent.status==='failed'&&purpose==='home',409,'RECOVERY_SCOPE','只能从当前企业、快照的失败首页任务保留完成检查点');
    const frozen=JSON.parse(parent.payload);assert(frozen.purpose==='home'&&frozen.question===question,409,'RECOVERY_SCOPE','恢复任务的问题或用途不同');
    // The server chooses the original immutable input, never client-provided
    // prose, receipts, model verdicts or a replacement business context.
    payload={...frozen,id:ident,sessionId,recoveryFrom:parent.id};
   }
   await statement(ctx.db,"INSERT OR IGNORE INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending_dispatch','[]',?,?,?)",ident,ctx.businessId,s.dataNature,s.id,sessionId,requestId,requestHash,JSON.stringify(payload),JSON.stringify(storedObservation(null,{gatewayDispatch:'not_sent',gatewayRevision:crypto.randomUUID()})),stamp(),stamp()).run();
   const saved=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId);assert(saved&&saved.request_hash===requestHash,409,'REQUEST_CONFLICT','请求ID已用于不同问题');return json(publicRun(await sync(ctx,saved)),202);
  }
  if(!id&&request.method==='GET'){const s=await snapshot(ctx,url.searchParams.get('snapshotId'),url.searchParams.get('dataNature'));await mirrorPatrols(ctx,s);const rows=await all<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND snapshot_id=? ORDER BY created_at DESC LIMIT 30',ctx.businessId,s.id);return json({items:await Promise.all(rows.map(async r=>publicRun(await sync(ctx,r)))),currentConfigurationId:(await activePlatformSettings(ctx,s.dataNature)).id,policy:agentPolicy(ctx.runtime,ctx.businessId)});}
  const r=await run(ctx,id);checkRunScope(r,url);
  if(request.method==='GET'&&action==='observability'){const value=publicRun(await sync(ctx,r));return json({id:r.id,snapshotId:r.snapshot_id,status:value.status,observability:value.observability??null,communicationError:value.communicationError??null});}
  if(request.method==='GET'&&!action)return json(publicRun(await sync(ctx,r)));
  if(request.method==='POST'&&['cancel','resume'].includes(action)){
   requireWrite(request,ctx);
   if(action==='resume')requireAgentExecution(ctx.runtime,ctx.businessId,JSON.parse(r.payload).purpose);
   return json(publicRun(action==='cancel'?await cancelRun(ctx,id):await resumeRun(ctx,id)));
  }
 }
 if(resource==='agent-sessions'&&id&&request.method==='GET'){
  const session=await first<{actor_id:string;data_nature:string}>(ctx.db,'SELECT * FROM neo_sessions WHERE id=? AND business_id=?',id,ctx.businessId);assert(session&&session.actor_id===ctx.userId&&(!url.searchParams.has('dataNature')||url.searchParams.get('dataNature')===session.data_nature),404,'NOT_FOUND','会话不存在');
  const cursor=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??30);assert(Number.isSafeInteger(cursor)&&cursor>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=100,422,'SESSION_PAGE','历史分页范围无效');
  const total=(await first<{n:number}>(ctx.db,'SELECT COUNT(*) n FROM neo_runs WHERE session_id=? AND business_id=?',id,ctx.businessId))?.n??0;
  return json({session,runs:(await all<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE session_id=? AND business_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?',id,ctx.businessId,limit,cursor)).map(publicRun),total,cursor,limit,hasMore:cursor+limit<total,nextCursor:cursor+limit<total?cursor+limit:null});
 }
 if(['forecasts','scenarios','decisions'].includes(resource)){
  const kind=resource==='forecasts'?'forecast':resource==='scenarios'?'scenario':'decision';
  if(id&&request.method==='GET'){const result=await artifact(ctx,id,kind);assert(!url.searchParams.get('snapshotId')||result.row.snapshot_id===url.searchParams.get('snapshotId'),404,'NOT_FOUND','结果不属于当前查看范围');assert(!url.searchParams.has('dataNature')||result.row.data_nature===url.searchParams.get('dataNature'),404,'NOT_FOUND','结果不属于当前资料来源');return json(kind==='decision'?await readDecision(ctx,result.value,{businessId:ctx.businessId,dataNature:result.row.data_nature,snapshotId:result.row.snapshot_id,ontologyRef:result.value.ontologyRef}):result.value);}
  if(!id&&request.method==='GET'){const s=await snapshot(ctx,url.searchParams.get('snapshotId'),url.searchParams.get('dataNature'));const values=(await all<{payload:string}>(ctx.db,'SELECT payload FROM neo_artifacts WHERE business_id=? AND snapshot_id=? AND data_nature=? AND kind=? ORDER BY created_at DESC LIMIT 60',ctx.businessId,s.id,s.dataNature,kind)).map(r=>JSON.parse(r.payload));return json({items:kind==='decision'?await Promise.all(values.map(v=>readDecision(ctx,v,{businessId:ctx.businessId,dataNature:s.dataNature,snapshotId:s.id,ontologyRef:v.ontologyRef}))):values});}
  if(!id&&request.method==='POST'){
   requireWrite(request,ctx);const input=await agentBody(request);const s=await snapshot(ctx,input.snapshotId,input.dataNature);const requestId=string(input.requestId,'requestId',100);const requestHash=await hash(JSON.stringify(input));
   const previous=await first<{payload:string;request_hash:string}>(ctx.db,'SELECT payload,request_hash FROM neo_artifacts WHERE business_id=? AND kind=? AND request_id=?',ctx.businessId,kind,requestId);
   if(previous){assert(previous.request_hash===requestHash,409,'REQUEST_CONFLICT','请求ID用于不同内容');return json(JSON.parse(previous.payload));}
   let result:Record<string,unknown>,parentId:string|null=null;let calculationParent:Record<string,unknown>|null=null;const frozen=await envelope(ctx,s);
   if(kind==='decision'){
    parentId=string(input.scenarioId,'scenarioId',100);const parent=await artifact(ctx,parentId,'scenario');assert(sameArtifactScope(parent.value,{businessId:ctx.businessId,dataNature:s.dataNature,snapshotId:s.id}),409,'SNAPSHOT_CONFLICT','选择与方案的经营范围或资料版本不同');
    const plan=decisionPlan(input.plan);
    result={scenarioId:parentId,reason:string(input.reason,'reason'),selectedScenario:parent.value,plan,status:'saved_decision',actualOutcome:null};
   }else{
    if(kind==='scenario'){parentId=string(input.baselineId,'baselineId',100);const parent=await artifact(ctx,parentId,'forecast');assert(sameArtifactScope(parent.value,{businessId:ctx.businessId,dataNature:s.dataNature,snapshotId:s.id}),409,'SNAPSHOT_CONFLICT','基线与当前经营范围或资料版本不同');calculationParent=parent.value;}
    if(kind==='scenario'&&input.assumptions){
     const spec=input.assumptions as Record<string,unknown>;const assumptions=[...[spec.adjustments,spec.arrivals,spec.transfers].flatMap(xs=>Array.isArray(xs)?xs.map(x=>x?.assumption):[]),spec.extraCostAssumption].filter(Boolean) as Array<{source:string;evidenceIds?:string[]}>;
     for(const a of assumptions){
      assert(a.source!=='synthetic'||s.dataNature==='demo',422,'SYNTHETIC_PARAMETER','合成参数仅可用于 demo 推演');
      if(['historical_estimate','external_reference'].includes(a.source)){
       assert(Array.isArray(a.evidenceIds)&&a.evidenceIds.length>0,422,'ASSUMPTION_EVIDENCE','历史估计或外部参考须提供证据');
       for(const eid of a.evidenceIds){const internal=Object.values(s.evidenceIds).includes(eid);const market=internal?null:await first(ctx.db,'SELECT id FROM neo_market_evidence WHERE id=? AND business_id=? AND snapshot_id=?',eid,ctx.businessId,s.id);assert(internal||market,422,'ASSUMPTION_EVIDENCE','假设证据不属于当前经营范围');}
      }
     }
    }
    result=await service(ctx,`/calculate/${kind}`,{envelope:frozen,assumptions:input.assumptions??{}});
    result={...result,backtestAvailability:forecastAvailability(frozen as Parameters<typeof forecastAvailability>[0])};
    if(calculationParent)assert(sameCalculation(result,calculationParent),409,'CALCULATION_CONFLICT','基线与方案的计算版本或输入资料不一致，或历史版本待核；请重新计算基线后再比较。');
   }
   const value={...result,id:uid(kind),kind,parentId,businessId:ctx.businessId,dataNature:s.dataNature,snapshotId:s.id,createdAt:stamp(),title:typeof input.title==='string'?input.title.slice(0,100):kind==='forecast'?'维持现状':kind==='scenario'?'经营方案':'已保存的经营选择'};
   await statement(ctx.db,'INSERT OR IGNORE INTO neo_artifacts VALUES(?,?,?,?,?,?,?,?,?,?)',value.id,ctx.businessId,s.dataNature,s.id,kind,requestId,requestHash,parentId,JSON.stringify(value),stamp()).run();const saved=await first<{payload:string;request_hash:string}>(ctx.db,'SELECT payload,request_hash FROM neo_artifacts WHERE business_id=? AND kind=? AND request_id=?',ctx.businessId,kind,requestId);assert(saved?.request_hash===requestHash,409,'REQUEST_CONFLICT','请求ID用于不同内容');return json(JSON.parse(saved.payload),201);
  }
 }
 if(resource==='market-evidence'&&id&&request.method==='GET'){
  const row=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_market_evidence WHERE id=? AND business_id=?',id,ctx.businessId);assert(row,404,'NOT_FOUND','市场证据不存在');return json(normalizeMarketEvidence(JSON.parse(row.payload)));
 }
 if((resource==='briefings'&&id==='today'||resource==='reports'&&id==='weekly')&&request.method==='GET'){
  const s=await snapshot(ctx,url.searchParams.get('snapshotId'),url.searchParams.get('dataNature'));
  await mirrorPatrols(ctx,s);const purpose=resource==='reports'?'weekly':'briefing';const since=recordPeriodStart(purpose);const organizationInputs=await decisionContext(ctx,s,purpose);
  const shared=await completeAssessmentRow(ctx,s);
  const organizationRows=await all<RunRow>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND snapshot_id=? AND data_nature=? ORDER BY created_at DESC LIMIT 60",ctx.businessId,s.id,s.dataNature);const retained=organizationRows.find(r=>JSON.parse(r.payload).purpose===purpose)??(resource==='briefings'?organizationRows.find(r=>JSON.parse(r.payload).purpose==='patrol'):undefined),history=retained?await run(ctx,retained.id):null;const organization=shared??(history?.configurationFreshness?.status==='current'&&history?.knowledgeFreshness?.status==='current'?history:null);
  const runs=await all<RunRow>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND snapshot_id=? AND data_nature=? AND status='completed' AND created_at>=? ORDER BY created_at DESC LIMIT 10",ctx.businessId,s.id,s.dataNature,since);
  const records=await all<{payload:string;kind:string}>(ctx.db,'SELECT payload,kind FROM neo_artifacts WHERE business_id=? AND snapshot_id=? AND data_nature=? AND created_at>=? ORDER BY created_at DESC LIMIT 30',ctx.businessId,s.id,s.dataNature,since);
  const decisions=await Promise.all(records.filter(r=>r.kind==='decision').map(r=>{const v=JSON.parse(r.payload);return readDecision(ctx,v,{businessId:ctx.businessId,dataNature:s.dataNature,snapshotId:s.id,ontologyRef:v.ontologyRef});}));
  return json({snapshotId:s.id,asOf:s.asOf,generatedAt:stamp(),recordPeriodStart:since,recordTimezone:'Asia/Shanghai',organization:organization?publicRun(organization):null,historicalOrganization:history&&history.id!==organization?.id?publicRun(history):null,organizationInputs,organizationStale:!!organization&&(JSON.parse(organization.payload).purpose==='patrol'?JSON.stringify([JSON.parse(organization.payload).envelope.decisionContext?.scenarios?.map((x:{id:string})=>x.id),JSON.parse(organization.payload).envelope.decisionContext?.decisions?.map((x:{id:string})=>x.id)])!==JSON.stringify([organizationInputs.scenarios.map(x=>x.id),organizationInputs.decisions.map(x=>x.id)]):JSON.parse(organization.payload).envelope.decisionContext?.meta.inputHash!==organizationInputs.meta.inputHash),findings:runs.map(publicRun),scenarios:records.filter(r=>r.kind==='scenario').map(r=>JSON.parse(r.payload)),decisions,limitations:['保存决策不代表行动已发生；没有实际收益记录。']});
 }
 return json({error:{code:'NOT_FOUND',message:'接口不存在'}},404);
}

// Explicit retries compare caller intent before rebuilding mutable source context.
// The first payload remains the execution source, including its saved directory.
export async function replayOperatingReview(ctx:Context,requestId:string,input:Record<string,unknown>,legacyId?:string,monitorReview?:Record<string,unknown>){
 if(monitorReview)assert(automaticMonitorAllowed(ctx.runtime,ctx.businessId),403,'MONITOR_DISABLED','自动监控未获授权');else requireAgentExecution(ctx.runtime,ctx.businessId,'review');
 const previous=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId)??(legacyId?await first<RunRow>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND substr(request_id,1,17)='operating-review:' AND substr(request_id,-?)=? ORDER BY created_at DESC,rowid DESC LIMIT 1",ctx.businessId,legacyId.length+1,':'+legacyId):null);
 if(!previous)return null;
 const payload=JSON.parse(previous.payload),original=payload.envelope;
 let expectedHash=previous.request_hash;
 if(!original.operatingRequest){
  const {runtimeScope,...fixed}=original,interaction=original.operatingBasis?.interaction;
  assert(!interaction?.priorQuestion&&previous.request_hash===await hash(JSON.stringify(fixed)),409,'REQUEST_CONFLICT','原冻结请求无法安全核对，须保留原任务并使用新请求ID');
  expectedHash=await hash(JSON.stringify({businessId:previous.business_id,dataNature:previous.data_nature,generationId:previous.snapshot_id,question:interaction?.question??null,role:interaction?.role??'joint',sessionId:null,budget:null}));
 }
 assert(input.businessId===ctx.businessId&&previous.data_nature===input.dataNature&&previous.snapshot_id===input.generationId&&expectedHash===await hash(JSON.stringify(input)),409,'REQUEST_CONFLICT','请求ID已用于不同经营问题或范围');
 return publicRun(await sync(ctx,previous));
}

// Canonical generations use the same durable dispatch/recovery/cancel protocol
// as legacy snapshot jobs, without accepting a browser-supplied frozen envelope.
export async function queueOperatingReview(ctx:Context,fixed:Record<string,unknown>,generationId:string,requestId:string,deriveScopedBasis?:(scope:DialogueScope)=>Record<string,unknown>){
 if(fixed.monitorReview)assert(automaticMonitorAllowed(ctx.runtime,ctx.businessId),403,'MONITOR_DISABLED','自动监控未获服务端授权');else requireAgentExecution(ctx.runtime,ctx.businessId,'review');
 fixed={...fixed,knowledge:fixed.knowledge??await knowledgeContext(ctx,(fixed.snapshot as {dataNature:string}).dataNature)};
 const snapshot=fixed.snapshot as {businessId:string;dataNature:string;id:string};assert(snapshot.businessId===ctx.businessId&&snapshot.id===generationId,409,'SCOPE','判断范围不一致');
 const explicitInput=fixed.operatingRequest as Record<string,unknown>|undefined;
 if(explicitInput)assert(explicitInput.businessId===ctx.businessId&&explicitInput.dataNature===snapshot.dataNature&&explicitInput.generationId===generationId,409,'SCOPE','显式请求范围不一致');
 const requestHash=await hash(JSON.stringify(explicitInput??{...fixed,knowledge:fixed.knowledge?{...(fixed.knowledge as Record<string,unknown>),capturedAt:null}:null}));
 const previous=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId);
 if(previous){assert(previous.request_hash===requestHash,409,'REQUEST_CONFLICT','判断输入已变化');return publicRun(await sync(ctx,previous));}
 const ident=uid('run'),sessionId=String((fixed.operatingBasis as {interaction?:{sessionId?:string}}).interaction?.sessionId??uid('session')),now=stamp(),policy=agentPolicy(ctx.runtime,ctx.businessId);
 const interaction=(fixed.operatingBasis as {interaction?:{question:string;role:string;sessionId?:string;dialogueScope?:unknown}}).interaction;
 const question=interaction?.question??'根据冻结经营指标与行业原文，输出三专业和联合研判。',taskType=recognizeTask(question,'operating',!!interaction);
 const requestedBudget=validatedBudget(explicitInput?.budget??fixed.requestedBudget);
 if(interaction?.sessionId)await assertSession(ctx,sessionId,snapshot.dataNature,'generation');
 else await statement(ctx.db,'INSERT INTO neo_sessions(id,business_id,data_nature,snapshot_id,actor_id,created_at,generation_id) VALUES(?,?,?,NULL,?,?,?)',sessionId,ctx.businessId,snapshot.dataNature,ctx.userId,now,generationId).run();
 const conversation=await freezeConversation(ctx,sessionId,snapshot.dataNature,generationId,'generation',fixed,validateDialogueScope(interaction?.dialogueScope),question);
 if(deriveScopedBasis){fixed={...fixed,operatingBasis:deriveScopedBasis(conversation.active)};conversation.versions.metric=await hash(JSON.stringify((fixed.operatingBasis as {metrics:unknown}).metrics));}

 const payload={id:ident,businessId:ctx.businessId,dataNature:snapshot.dataNature,snapshotId:generationId,sessionId,mode:interaction?.role??'joint',purpose:'operating',taskType,question,envelope:{...fixed,conversation,runtimeScope:{businessId:ctx.businessId,dataNature:snapshot.dataNature,inputId:generationId,asOf:(fixed.snapshot as {asOf:string}).asOf,...researchTime(now)}},history:conversation.history,autoRepeat:false,budget:taskBudget(taskType,{maxAttempts:3,maxToolCalls:null,timeoutSeconds:600,...requestedBudget,maxMarketSearches:policy.marketSearchAllowed?requestedBudget?.maxMarketSearches===0?0:null:0},{scenarioCount:((fixed.operatingBasis as {scenarioContext?:{results?:unknown[]}}).scenarioContext?.results??[]).length})};
 await ctx.db.batch([statement(ctx.db,"INSERT OR IGNORE INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending_dispatch','[]',?,?,?)",ident,ctx.businessId,snapshot.dataNature,generationId,sessionId,requestId,requestHash,JSON.stringify(payload),JSON.stringify(storedObservation(null,{gatewayDispatch:'not_sent',gatewayRevision:crypto.randomUUID()})),now,now)]);
 const saved=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId);assert(saved&&saved.request_hash===requestHash,409,'REQUEST_CONFLICT','判断被并发创建，请回读');return publicRun(await sync(ctx,saved));
}

// Existing panels may read a canonical-generation run without loading a legacy snapshot.
export async function readOperatingRun(ctx:Context,nature:string,generationId:string,id:string){
 const r=await run(ctx,id);assert(r.data_nature===nature&&r.snapshot_id===generationId,404,'RUN_SCOPE','任务不属于当前经营资料');return publicRun(r);
}
// Reconcile submitted jobs across both generations and archived snapshots.
// Canonical operating tasks and explicitly requested AI option jobs may be dispatched; legacy
// pending tasks retain their explicit submission/resume path.
export const BACKGROUND_AGENT_RUN_FILTER="(((json_extract(payload,'$.purpose')='operating' OR json_extract(payload,'$.envelope.scenarioRecommendationRef') IS NOT NULL) AND status='pending_dispatch') OR status IN ('queued','running','deferred') OR json_extract(result,'$.runtime.cancellationPending')=1 OR json_extract(result,'$.runtime.gatewayControl') IS NOT NULL)";
export async function synchronizeActiveAgentRun(ctx:Context,id:string){
 const row=await run(ctx,id);
 // Read back an existing execution only. A GET cannot dispatch a new model
 // task from pending_dispatch, or rewrite a completed historical result.
 return ['queued','running','deferred'].includes(row.status)?sync(ctx,row):row;
}
export async function synchronizeAgentRuns(ctx:Context,nature:string,limit=4){
 const rows=await all<RunRow>(ctx.db,`SELECT * FROM neo_runs WHERE business_id=? AND data_nature=? AND ${BACKGROUND_AGENT_RUN_FILTER} ORDER BY updated_at,id LIMIT ?`,ctx.businessId,nature,limit);
 for(const row of rows)await sync(ctx,row);
 return rows.length;
}

/** A canonical operating plan uses the durable run protocol and frozen facts. */
export async function queueOperatingBrain(ctx:Context,g:import('./business-generations.ts').OperatingGeneration,input:Record<string,unknown>){
 requireAgentExecution(ctx.runtime,ctx.businessId,'analysis');
 assert(input.mode==='orchestrator'&&input.purpose==='analysis'&&typeof input.operatingPlanId==='string',422,'OPERATING_MODE','经营调度须选择已保存任务');
 const question=string(input.question,'question'),requestId=string(input.requestId,'requestId',100),budget=validatedBudget(input.budget);
 const planning=await (await import('./operating-plans.ts')).operatingPlanForAgent(ctx,g.state.dataNature,input.operatingPlanId,g.id);
 const {generationSnapshot,generationDomain}=await import('./workbench-projection.ts'),snapshot=generationSnapshot(g),domain=generationDomain(g);
 const frozen=await configuredAgentEnvelope(ctx,snapshot.dataNature,'orchestrator',{snapshot,domain,facts:domain.facts,operatingPlanning:planning,decisionContext:await decisionContext(ctx,snapshot,'analysis')});
 const policy=agentPolicy(ctx.runtime,ctx.businessId),safeBudget={...budget,...(!policy.marketSearchAllowed?{maxMarketSearches:0}:{})},requestHash=await hash(JSON.stringify([g.id,planning.id,question,safeBudget]));
 const previous=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId);
 if(previous){assert(previous.request_hash===requestHash,409,'REQUEST_CONFLICT','请求ID已用于不同经营研判');return publicRun(await sync(ctx,previous));}
 const ident=uid('run'),sessionId=uid('session'),now=stamp(),payload={id:ident,businessId:ctx.businessId,dataNature:snapshot.dataNature,snapshotId:g.id,sessionId,mode:'orchestrator',purpose:'analysis',question,envelope:await transportEnvelope(frozen),history:[],autoRepeat:false,budget:safeBudget};
 await ctx.db.batch([statement(ctx.db,'INSERT INTO neo_sessions(id,business_id,data_nature,snapshot_id,actor_id,created_at,generation_id) VALUES(?,?,?,NULL,?,?,?)',sessionId,ctx.businessId,snapshot.dataNature,ctx.userId,now,g.id),statement(ctx.db,"INSERT OR IGNORE INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending_dispatch','[]',?,?,?)",ident,ctx.businessId,snapshot.dataNature,g.id,sessionId,requestId,requestHash,JSON.stringify(payload),JSON.stringify(storedObservation(null,{gatewayDispatch:'not_sent',gatewayRevision:crypto.randomUUID()})),now,now)]);
 const saved=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId);assert(saved&&saved.request_hash===requestHash,409,'REQUEST_CONFLICT','任务已被并发创建，请回读');return publicRun(await sync(ctx,saved));
}
export async function readOperatingBrains(ctx:Context,nature:string,generationId:string,planningId:string){
 const rows=await all<RunRow>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND json_extract(payload,'$.envelope.operatingPlanRef')=? ORDER BY created_at DESC,id DESC LIMIT 10",ctx.businessId,nature,generationId,planningId);
 return {items:await Promise.all(rows.map(async r=>publicRun(await sync(ctx,r)))),policy:agentPolicy(ctx.runtime,ctx.businessId)};
}

/** Explicit durable-owner reconciliation; read-only projections use readOperatingRun. */
export async function synchronizeOperatingRun(ctx:Context,nature:string,generationId:string,id:string){
 const r=await run(ctx,id);assert(r.data_nature===nature&&r.snapshot_id===generationId,404,'RUN_SCOPE','任务不属于当前经营资料');return publicRun(await sync(ctx,r));
}

/** AI options and their deterministic evaluations share one immutable baseline. */
async function handleScenarioRecommendations(request:Request,ctx:Context,segments:string[]):Promise<Response>{
 const [,id,action]=segments,url=new URL(request.url),input=request.method==='POST'?await agentBody(request):null;
 const nature=input?.dataNature??url.searchParams.get('dataNature'),snapshotId=input?.snapshotId??url.searchParams.get('snapshotId');
 assert(nature==='demo'||nature==='business',422,'NATURE','资料性质无效');assert(typeof snapshotId==='string',422,'SNAPSHOT','需要冻结资料版本');
 if(input){requireWrite(request,ctx);assert(!url.searchParams.has('dataNature')||url.searchParams.get('dataNature')===nature,409,'SCOPE','资料性质不一致');assert(!url.searchParams.has('snapshotId')||url.searchParams.get('snapshotId')===snapshotId,409,'SCOPE','资料版本不一致');}
 const child=async(resource:string,value?:Record<string,unknown>)=>{
  const target=new URL(request.url);target.pathname='/api/v1/'+resource;target.searchParams.set('snapshotId',snapshotId);target.searchParams.set('dataNature',nature);
  const req=new Request(target,{headers:request.headers,...value?{method:'POST',body:JSON.stringify(value)}:{}});
  const response=await (await import('./workbench-compat.ts')).handleWorkbenchCompat(req,ctx,resource.split('/'))??await handleAgents(req,ctx,resource.split('/'));
  assert(response,503,'SCENARIO_API','方案接口不可用');const valueOut=await response.json();assert(response.ok,response.status,'SCENARIO_API',valueOut.error?.message??'方案未计算完成');return valueOut;
 };
 const projection=async(row:RunRow|null)=>{
  if(!row)return json({run:null,recommendations:null,evaluation:null});
  assert(row.data_nature===nature&&row.snapshot_id===snapshotId,404,'RUN_SCOPE','建议不属于当前资料');
  const value=publicRun(await sync(ctx,row)),recommendations=value.status==='completed'?value.result?.scenarioRecommendations??null:null;
  const evaluated=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND snapshot_id=? AND kind='scenario_recommendation_evaluation' AND parent_id=?",ctx.businessId,nature,snapshotId,row.id);
  return json({run:value,recommendations,evaluation:evaluated?JSON.parse(evaluated.payload):null});
 };
 if(id){
  const row=await run(ctx,id);assert(row.data_nature===nature&&row.snapshot_id===snapshotId,404,'RUN_SCOPE','建议不属于当前资料');
  const payload=JSON.parse(row.payload);assert(payload.envelope?.scenarioRecommendationRef,404,'RUN_TYPE','该任务不是方案建议');
  if(request.method==='GET'&&!action)return projection(row);
  assert(input&&action==='evaluate',405,'METHOD','此操作不可用');
  const current=publicRun(await sync(ctx,row));assert(current.status==='completed'&&current.result?.scenarioRecommendations,409,'RUN_PENDING','三个建议尚未生成完成');
  const previous=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND kind='scenario_recommendation_evaluation' AND parent_id=?",ctx.businessId,nature,id);if(previous)return json(JSON.parse(previous.payload));
  const recommendations=current.result.scenarioRecommendations as import('./agent-contracts.ts').ScenarioRecommendations;
  assert(recommendations.baselineId===payload.envelope.scenarioRecommendationRef.baselineId&&recommendations.options.length===3&&new Set(recommendations.options.map(o=>o.id)).size===3,422,'OPTIONS','建议结构与冻结基线不一致');
  let frozen=payload.envelope;if(frozen.envelopePacked)frozen=await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',...frozen.envelopePacked}));
  const baseline=frozen.scenarioRecommendationBasis.baseline,items:import('./agent-contracts.ts').ScenarioOptionEvaluation[]=[];
  for(const option of recommendations.options){
   let scenario:import('./agent-contracts.ts').ScenarioResult|null=null,replay:import('./agent-contracts.ts').ScenarioReplay|null=null,error:string|null=null;
   try{
    const value={snapshotId,dataNature:nature,requestId:`ai-${id}-${option.id}`,baselineId:baseline.id,title:option.title,assumptions:option.assumptions};
    if(baseline.ontologyRef){const {runFunction}=await import('./ontology/operations.ts');const r=await runFunction(request,ctx,'scenario',{...value,buildId:baseline.ontologyRef.buildId});assert(r.status==='completed',422,'SCENARIO','原资料版本的方案未完成');scenario=r.result as import('./agent-contracts.ts').ScenarioResult;}
    else scenario=await child('scenarios',value);
   }catch(e){if(!(e instanceof ApiError)||e.status>=500)throw e;error=e.message;}
   try{replay=await service(ctx,'/calculate/scenario-replay',{envelope:await transportEnvelope(frozen),assumptions:option.assumptions}) as import('./agent-contracts.ts').ScenarioReplay;}catch(e){if(!(e instanceof ApiError)||e.status>=500)throw e;error=[error,e.message].filter(Boolean).join('；');}
   items.push({optionId:option.id,scenario,replay,error});
  }
  const value={id:uid('option-evaluation'),runId:id,baselineId:baseline.id,businessId:ctx.businessId,dataNature:nature,snapshotId,createdAt:stamp(),items,meaning:'AI建议的条件推演与事后需求假设历史重放；不证明策略收益'};
  const requestId=`option-evaluation:${id}`;
  await statement(ctx.db,"INSERT OR IGNORE INTO neo_artifacts VALUES(?,?,?,?,?,?,?,?,?,?)",value.id,ctx.businessId,nature,snapshotId,'scenario_recommendation_evaluation',requestId,await hash(requestId),id,JSON.stringify(value),value.createdAt).run();
  return json(JSON.parse((await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND kind='scenario_recommendation_evaluation' AND request_id=?",ctx.businessId,requestId))!.payload),201);
 }
 const baselineId=string(input?.baselineId??url.searchParams.get('baselineId'),'baselineId',200);
 if(request.method==='GET'){const row=await first<RunRow>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND json_extract(payload,'$.envelope.scenarioRecommendationRef.baselineId')=? ORDER BY created_at DESC,rowid DESC LIMIT 1",ctx.businessId,nature,snapshotId,baselineId);return projection(row);}
 assert(input&&request.method==='POST',405,'METHOD','此操作不可用');requireAgentExecution(ctx.runtime,ctx.businessId,'analysis');
 const requestId='scenario-options:'+string(input.requestId,'requestId',70),requestHash=await hash(JSON.stringify([snapshotId,nature,baselineId,'ai-scenario-options-v1']));
 const existing=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId);
 if(existing){assert(existing.request_hash===requestHash,409,'REQUEST_CONFLICT','请求标识已用于另一份方案');return projection(existing);}
 const forecasts=await child('forecasts'),baseline=forecasts.items.find((f:import('./agent-contracts.ts').ForecastResult)=>f.id===baselineId);assert(baseline,404,'BASELINE','基线不属于当前资料版本');
 let frozen:Record<string,unknown>,s:Snapshot;
 if(snapshotId.startsWith('generation-')){
  const stored=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',snapshotId,ctx.businessId,nature);assert(stored,404,'GENERATION','经营代次不存在');
  const g=await (await import('./generation-storage.ts')).loadGeneration(ctx,nature,stored.payload),{generationSnapshot,generationDomain}=await import('./workbench-projection.ts');s=generationSnapshot(g);const domain=generationDomain(g);
  const {operatingReviewBasis}=await import('./business-review-basis.ts');const factTime=new Map(g.state.inputs.map(r=>[r.id,r.knownAt]));
  frozen={snapshot:s,domain,facts:domain.facts.map(r=>({...r,availableAt:factTime.get(r.id)})),evaluationMetadata:{knownAt:g.state.knownAt},operatingBasis:operatingReviewBasis(g,'configured_model')};
 }else{s=await snapshot(ctx,snapshotId,nature);frozen=baseline.ontologyRef?await (await import('./ontology/store.ts')).envelopeForBuild(ctx,baseline.ontologyRef.buildId):await envelope(ctx,s);}
 const context=await decisionContext(ctx,s,'analysis'),cutoff=(frozen.ontologyRef as {knownAt?:string}|undefined)?.knownAt;
 const sources=context.marketEvidence.filter(e=>e.verificationStatus==='source_read'&&(!cutoff||e.retrievedAt&&e.retrievedAt<=cutoff)).slice(0,12).map(e=>({...e,content:e.content?.slice(0,4000)}));
 const externalNotice=sources.length?'采用本经营范围已保存并核验的外部原文，时效和适用性仍须核对。':'当前没有可用的已核验外部原文；外部环境待核，建议只依据经营资料及明确的条件假设。';
 const fixed=await configuredAgentEnvelope(ctx,nature,'orchestrator',{...frozen,knowledge:await knowledgeContext(ctx,nature),scenarioRecommendationBasis:{baselineId,baseline,generatedAt:stamp(),externalSources:sources,externalNotice,professionalFindings:context.findings.map(f=>({mode:f.mode,finding:f.finding}))},scenarioRecommendationRef:{baselineId}});
 const ident=uid('run'),sessionId=uid('session'),now=stamp(),payload={id:ident,businessId:ctx.businessId,dataNature:nature,snapshotId,sessionId,mode:'orchestrator',purpose:'analysis',taskType:'SIMULATE',question:'根据经营情况和已核验外部环境提出三个方案建议，并以同一基线检验条件。',history:[],autoRepeat:false,envelope:{...await transportEnvelope(fixed),scenarioRecommendationRef:{baselineId}},budget:{maxModelCalls:null,maxTokens:null,completionTokens:null,maxToolCalls:null,maxMarketSearches:0,timeoutSeconds:600}};
 await ctx.db.batch([statement(ctx.db,snapshotId.startsWith('generation-')?'INSERT INTO neo_sessions(id,business_id,data_nature,snapshot_id,actor_id,created_at,generation_id) VALUES(?,?,?,NULL,?,?,?)':'INSERT INTO neo_sessions(id,business_id,data_nature,snapshot_id,actor_id,created_at) VALUES(?,?,?,?,?,?)',sessionId,ctx.businessId,nature,...(snapshotId.startsWith('generation-')?[ctx.userId,now,snapshotId]:[snapshotId,ctx.userId,now])),statement(ctx.db,"INSERT OR IGNORE INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending_dispatch','[]',?,?,?)",ident,ctx.businessId,nature,snapshotId,sessionId,requestId,requestHash,JSON.stringify(payload),JSON.stringify(storedObservation(null,{gatewayDispatch:'not_sent',gatewayRevision:crypto.randomUUID()})),now,now)]);
 const saved=await first<RunRow>(ctx.db,'SELECT * FROM neo_runs WHERE business_id=? AND request_id=?',ctx.businessId,requestId);assert(saved?.request_hash===requestHash,409,'REQUEST_CONFLICT','请求标识已用于其他任务');return projection(saved);
}
