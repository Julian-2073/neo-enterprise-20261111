import type {AgentRun,AgentFinding} from '../server/agent-contracts.ts';
import {replyClaims} from './agent-reply-quality.ts';
// Navigation reference, never a source/metric evidence identifier.
const prefix='run-evidence:';
export function runEvidenceReference(runId:string,claimIds:string[]=[]){return prefix+encodeURIComponent(JSON.stringify({runId:runId.split('~')[0],claimIds}));}
export function parseRunEvidenceReference(value:string):{runId:string;claimIds:string[]}|null{
 if(!value.startsWith(prefix))return null;
 try{const v=JSON.parse(decodeURIComponent(value.slice(prefix.length)));return typeof v.runId==='string'&&v.runId&&Array.isArray(v.claimIds)&&v.claimIds.every((id:unknown)=>typeof id==='string')?v:null;}catch{return null;}
}
export function replyEvidenceReference(run:AgentRun,finding:AgentFinding){
 const a=run.result?.businessAssessment;if(!a)return finding.evidenceIds[0]??null;
 const claims=replyClaims(run,finding);
 // An assessment without a matching saved claim must show the gap, not a coarse source metric.
 return runEvidenceReference(run.id,claims.map(c=>String(c.id)));
}
