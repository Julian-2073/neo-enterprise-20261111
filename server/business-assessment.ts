import type {Context} from './auth.ts';
import type {Snapshot} from './contracts.ts';
import type {AgentRun,AgentResult,AgentMode} from './agent-contracts.ts';
import {all} from './store.ts';
import {assessmentConfigurationIsCurrent} from '../lib/assessment-presentation.ts';
import {knowledgeFreshness} from './knowledge.ts';
import {readStoredResult} from './agent-state.ts';
import {decodeInput} from './input-storage.ts';
import {activePlatformSettings} from './platform-settings.ts';

/** One published-configuration fence for assessment and historical schema readers. */
export async function rowConfigurationFreshness(ctx:Context,n:string,row:{payload:string;result:string|null}){
 const active=await activePlatformSettings(ctx,n),assessment=readStoredResult(row.result).result?.businessAssessment;
 let version:unknown=assessment?.scope.configurationVersion;
 if(!assessment){let env=JSON.parse(row.payload).envelope??{};if(env.envelopePacked)env=await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',...env.envelopePacked}));const config=env.operatingBasis?.configuration??env.platformConfiguration??{};version='legacy:'+String(config.id??config.version??'legacy-unversioned');}
 return {status:assessmentConfigurationIsCurrent(version,active.id)?'current' as const:'stale' as const,currentConfigurationId:active.id};
}

// Reads never execute a model. Small interactive assessments cannot displace a
// complete business review, nor may a review cross a published configuration.
export async function completeAssessmentRow(ctx:Context,s:Pick<Snapshot,'id'|'dataNature'>){
 const configuration=await activePlatformSettings(ctx,s.dataNature);
 const rows=await all<{id:string;payload:string;result:string|null;status:string;session_id:string;created_at:string;updated_at:string;business_id:string;data_nature:string;snapshot_id:string;request_hash:string;steps:string;error:string|null;configurationFreshness?:AgentRun['configurationFreshness'];knowledgeFreshness?:AgentRun['knowledgeFreshness']}>(ctx.db,"SELECT * FROM neo_runs WHERE business_id=? AND data_nature=? AND snapshot_id=? AND status='completed' AND json_extract(result,'$.businessAssessment.version')='business-assessment-v1' AND json_extract(result,'$.businessAssessment.context.completeReview')=1 AND json_extract(result,'$.businessAssessment.context.semanticValidation.status')='verified' ORDER BY created_at DESC,rowid DESC",ctx.businessId,s.dataNature,s.id);
 for(const row of rows){const a=readStoredResult(row.result).result?.businessAssessment;if(!assessmentConfigurationIsCurrent(a?.scope.configurationVersion,configuration.id))continue;row.knowledgeFreshness=await knowledgeFreshness(ctx,s.dataNature,row.id);if(row.knowledgeFreshness.status==='current'){row.configurationFreshness={status:'current',currentConfigurationId:configuration.id};return row;}}
 return null;
}
export function assessmentResult(result:AgentResult|null,role:AgentMode):AgentResult|null{
 if(!result?.businessAssessment)return result;
 const a=result.businessAssessment,p=a.projections;
 const specialist=p.specialists?.[role];
 if(role==='joint'||role==='orchestrator')return {...result,...p};
 if(!specialist)return null;
 return {...result,...p,finding:{...specialist,businessReview:p.professional?.[role]??specialist.businessReview??null}};
}
export function assessmentRun(run:AgentRun,role:AgentMode):AgentRun{
 if(run.mode==='joint'&&!run.result?.businessAssessment&&role!=='joint'&&role!=='orchestrator'){
  const checkpoint=run.result?.specialists?.[role];
  return {...run,mode:role,result:checkpoint?{...run.result!,finding:checkpoint}:null};
 }
 return {...run,mode:role,result:assessmentResult(run.result,role)};
}
export function rowAssessment(row:Awaited<ReturnType<typeof completeAssessmentRow>>){return row?readStoredResult(row.result).result:null;}
