import {knowledgeContext,knowledgeFreshness} from './knowledge.ts';
import {recognizeTask} from './neo-task-plan.ts';
import {frozenSavedRecordRegistry} from './agent-saved-records.ts';
export {frozenSavedRecordRegistry} from './agent-saved-records.ts';
import {previousDialogueEnvelope,validateDialogueScope,type DialogueScope} from './agent-conversation.ts';
import {calculateScenario,validateScenario,recommendScenario,type ScenarioSpec,type ScenarioResult} from '../lib/business-scenarios.ts';
import {operatingReviewBasis,scopedOperatingReviewBasis} from './business-review-basis.ts';
import {activeControl} from './control-plane.ts';
import {loadGeneration} from './generation-storage.ts';
import type {Context} from './auth.ts';
import {all,first} from './store.ts';
import {loadBusinessArtifact} from './business-artifact-storage.ts';
import {savedRecordQuery} from './neo-task-plan.ts';
import {assert} from './errors.ts';
import {hash} from './csv.ts';
import {queueOperatingReview,replayOperatingReview,service} from './agents.ts';
import {agentPolicy} from './agent-policy.ts';
import {validatedBudget,readStoredResult} from './agent-state.ts';
import {completeAssessmentRow,rowConfigurationFreshness} from './business-assessment.ts';
export const OPERATING_REVIEW_VERSION='operating-review-v1.9';
export async function operatingReviews(ctx:Context,nature:string,generationId:string,generate=false,refreshId?:string,interaction?:{question:string;role:string;sessionId?:string;dialogueScope?:DialogueScope;scenarios?:unknown[]},requestedBudget?:unknown,monitorReview?:Record<string,unknown>){
 const budget=validatedBudget(requestedBudget);
 if(interaction)assert(interaction.question.trim().length>0&&interaction.question.length<=1000&&['conversion','supply','market','joint','orchestrator'].includes(interaction.role),422,'QUESTION','经营提问无效');
 const explicitInput=refreshId?{businessId:ctx.businessId,dataNature:nature,generationId,question:interaction?.question??null,role:interaction?.role??'joint',sessionId:interaction?.sessionId??null,budget:budget??null,...(interaction?.dialogueScope?{dialogueScope:validateDialogueScope(interaction.dialogueScope)}:{}),...(interaction?.scenarios?{scenarios:interaction.scenarios}:{})}:null;
 const stableRequestId=refreshId?'operating-request:'+refreshId:null;
 if(generate&&stableRequestId&&explicitInput){const previous=await replayOperatingReview(ctx,stableRequestId,explicitInput,refreshId,monitorReview);if(previous)return previous;}
 const stored=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',generationId,ctx.businessId,nature);assert(stored,404,'GENERATION','经营代次不存在');
 if(!generate){
  const current=await first<{id:string;status:string;result:string|null;payload:string;error:string|null;created_at:string}>(ctx.db,"SELECT id,status,result,payload,error,created_at FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND json_extract(payload,'$.purpose')='operating' AND json_extract(payload,'$.envelope.operatingBasis.interaction') IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1",ctx.businessId,nature,generationId);
  const shared=await completeAssessmentRow(ctx,{id:generationId,dataNature:nature as 'demo'|'business'});
  const row=current&&(!shared||current.id===shared.id||current.status!=='completed'&&current.created_at>=shared.created_at)?current:shared;
  const historicalResult=row?readStoredResult(row.result).result:null,configuration=row?await rowConfigurationFreshness(ctx,nature,row):null,freshness=row?await knowledgeFreshness(ctx,nature,row.id):null;
  const configurationCurrent=configuration?.status!=='stale',eligible=configurationCurrent&&freshness?.status!=='stale'&&freshness?.status!=='conflict';
  const result=eligible?historicalResult:null,completeResult=shared?readStoredResult(shared.result).result:null;
  const display=shared&&row?.id!==shared.id&&row?.status!=='completed'&&completeResult?{...completeResult,displayOnly:true,displaySourceRunId:shared.id}:result;
  return {configurationFreshness:configuration,historicalResult:eligible?null:historicalResult,knowledgeFreshness:freshness,generationId,runId:row?.id??null,status:row?.status??'not_generated',error:row?.error??null,result:display,checkpointResult:result,completeRunId:shared?.id??null,completeResult,policy:agentPolicy(ctx.runtime,ctx.businessId)};
 }
 const g=await loadGeneration(ctx,nature,stored.payload);
 const modelProfile=await activeControl(ctx,nature,'model'),modelIdentity=modelProfile?JSON.parse(modelProfile.payload).model:null;
 const health=await service(ctx,'/health');assert(health.modelConfigured===true||!!modelProfile,503,'MODEL_NOT_CONFIGURED','正式模型未配置；离线计算不冒充 AI 研判');
 const basis=operatingReviewBasis(g,String(modelIdentity??health.model));
 const previous=interaction?.sessionId?await previousDialogueEnvelope(ctx,interaction.sessionId,nature):null;
 const inheritedScenario=previous?.operatingBasis?.scenarioContext;
 const inheritedIds=previous?.operatingBasis?previous.conversation?.active?.scenarioIds:undefined;
 const selectedIds:string[]|undefined=interaction?.dialogueScope?.scenarioIds??inheritedIds;
 if(interaction)Object.assign(basis,{interaction:{...interaction,dialogueScope:validateDialogueScope(interaction.dialogueScope)}});
 if(interaction&&(savedRecordQuery(interaction.question)||/方案|选择|决策|复盘|执行/.test(interaction.question)||selectedIds?.length||interaction.sessionId))Object.assign(basis,{savedRecords:await frozenSavedRecordRegistry(ctx,nature,g.id)});
 const scenarioParameters=interaction?.scenarios??(interaction&&!selectedIds?.length?inheritedScenario?.scenarios:undefined);
 if(scenarioParameters){
  assert(Array.isArray(scenarioParameters)&&scenarioParameters.length>0&&scenarioParameters.length<=10,422,'SCENARIOS','需要1至10个明确参数的方案');
  let scenarios:ReturnType<typeof validateScenario>[]=[];try{scenarios=scenarioParameters.map(validateScenario);}catch(e){assert(false,422,'SCENARIOS',String(e));}
  assert(new Set(scenarios.map(s=>s.id)).size===scenarios.length,422,'SCENARIOS','方案标识须唯一');
  const results=scenarios.map(s=>calculateScenario(g.state,s,g.id,g.salesForecast));
  Object.assign(basis,{scenarioContext:{generationId:g.id,scenarios,results,recommendation:recommendScenario(results),source:interaction?.scenarios?'confirmed_typed_parameters':'continued_parameters_recalculated'}});
 }else if(interaction&&(selectedIds?.length||recognizeTask(interaction.question,'operating',true)==='DECIDE')){
  const registry=(basis as typeof basis&{savedRecords?:Awaited<ReturnType<typeof frozenSavedRecordRegistry>>}).savedRecords;
  const full=registry?.fullRecords??[],selected=selectedIds??full.flatMap(v=>v.kind==='business_decision'?[v.scenario?.id]:(v.scenarios??[]).map(r=>r.id)).filter(Boolean);
  const pairs=full.flatMap(v=>v.kind==='business_decision'?[{spec:v.scenario,result:v.forecast,recordId:v.id}]:(v.scenarios??[]).map(spec=>({spec,result:v.results?.find(r=>r.id===spec.id),recordId:v.id}))).filter((p):p is {spec:ScenarioSpec;result:ScenarioResult|undefined;recordId:string}=>!!p.spec&&selected.includes(p.spec.id));
  assert(!interaction.dialogueScope?.scenarioIds||selected.every(id=>pairs.some(p=>p.spec.id===id&&p.result)),404,'SCENARIO_SCOPE','方案不属于本轮冻结代次');
  const unique=[...new Map(pairs.filter((p):p is {spec:ScenarioSpec;result:ScenarioResult;recordId:string}=>!!p.result).map(p=>[p.spec.id,p])).values()];
  assert(unique.every(p=>p.result.inputGeneration===g.id),409,'SCENARIO_SCOPE','计算结果输入代次不一致');
  Object.assign(basis,{scenarioContext:{generationId:g.id,scenarios:unique.map(p=>p.spec),results:unique.map(p=>p.result),recordIds:unique.map(p=>p.recordId),recommendation:recommendScenario(unique.map(p=>p.result)),source:'saved_typed_results'}});
 }
 const scenario=(basis as typeof basis&{scenarioContext?:{results:Array<{id:string;version:string;status:string;totals:Record<string,number|null>}>}}).scenarioContext;
 for(const result of scenario?.results??[])for(const [key,value] of Object.entries(result.totals))basis.metrics['scenario:'+result.id+':'+key]={value,knownValue:value,unit:key.endsWith('Cents')?'人民币分':g.baseline.unit,status:result.status==='calculated'?'complete':'missing',reason:result.status==='calculated'?null:'情景计算资料不足',evidenceIds:['scenario:'+result.id]};
 const experiences=await all<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND kind='business_experience' ORDER BY created_at DESC",ctx.businessId,nature);
 const confirmedExperience=[];
 for(const row of experiences){const v=await loadBusinessArtifact(ctx,nature,'business_experience',row.payload) as {id:string;status:string;supportStatus:string;confirmedBy?:string;scope?:{entities?:string[]};decisionId:string;statement:string;dependencyHash:string;confirmedAt:string;attribution:unknown};if(v.status==='active'&&v.supportStatus==='supported'&&v.confirmedBy&&v.scope?.entities?.every((id:string)=>g.state.inputs.some(r=>r.entityId===id)))confirmedExperience.push({id:v.id,decisionId:v.decisionId,statement:v.statement,scope:v.scope,dependencyHash:v.dependencyHash,confirmedAt:v.confirmedAt,attribution:v.attribution,factUse:'historical_observation_only'});}
 Object.assign(basis,{confirmedExperience});
 const knowledge=await knowledgeContext(ctx,nature);
 const envelope={...(modelProfile?{modelProfileRef:{id:modelProfile.id,businessId:ctx.businessId,dataNature:nature}}:{}),knowledge,...(monitorReview?{monitorReview}:{}),...(explicitInput?{operatingRequest:explicitInput}:budget?{requestedBudget:budget}:{}),snapshot:{id:g.id,businessId:ctx.businessId,dataNature:nature,asOf:g.state.asOf},operatingBasis:basis};
 const sourceKey=await hash(JSON.stringify([OPERATING_REVIEW_VERSION,g.sourceKey,await hash(JSON.stringify({...knowledge,capturedAt:null})),confirmedExperience.map(x=>[x.id,x.dependencyHash]),modelProfile?.id??modelProfile?.id??health.model,agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed]));
 return queueOperatingReview(ctx,envelope,g.id,stableRequestId??'operating-review:'+sourceKey,scope=>{
  const scoped=scopedOperatingReviewBasis(g,String(modelIdentity??health.model),scope);
  return {...basis,...scoped,metrics:{...scoped.metrics,...Object.fromEntries(Object.entries(basis.metrics).filter(([key])=>key.startsWith('scenario:')))}};
 });
}
