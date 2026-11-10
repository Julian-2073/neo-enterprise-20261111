import {useEffect} from 'react';
import type {AgentRun,ScenarioInput} from '../../server/agent-contracts';
import {replyQuality} from '../../lib/agent-reply-quality';
import {api} from '../business/use-workspace';

/** Every entry reads the saved run; browser events cannot attest its quality. */
export function useAgentProposal(
 businessId:string,dataNature:string,snapshotId:string|undefined,
 setProposal:(value:ScenarioInput|null)=>void,setNotice:(value:string)=>void,
 setError:(value:string)=>void,setView:(value:'evidence'|'forecast'|'action')=>void,
){
 useEffect(()=>{
  if(!snapshotId)return;
  let disposed=false,sequence=0;
  const query=new URLSearchParams({businessId,dataNature,snapshotId});
  const accept=async(id:string,activate:boolean)=>{
   const request=++sequence;
   try{
    const run=await api<AgentRun>(`/api/v1/agent-runs/${encodeURIComponent(id)}?${query}`);
    if(disposed||request!==sequence)return;
    const finding=run.result?.finding;
    const quality=finding?replyQuality(run,finding,{businessId,dataNature,inputId:snapshotId}):null;
    if(!finding?.proposedAssumptions||!quality?.canPreview){
     setProposal(null);setNotice(quality?.previewNotice||'这条保存回答尚无可核验的方案条件。');return;
    }
    setProposal(finding.proposedAssumptions);setError('');
    setNotice('已回读并核验智能体条件；请核对后点击重新推演。');
    if(activate)setView('forecast');
   }catch(error){
    if(!disposed&&request===sequence){setProposal(null);setError((error as Error).message);}
   }
  };
  const changed=(event:Event)=>{
   const detail=(event as CustomEvent<{snapshotId?:string;runId?:string}>).detail;
   if(detail?.snapshotId!==snapshotId)return;
   if(typeof detail.runId!=='string'||!detail.runId){setNotice('请从已保存的回答回读条件并核验后再推演。');return;}
   void accept(detail.runId,true);
  };
  window.addEventListener('neo:proposal',changed);
  const id=new URLSearchParams(window.location.search).get('proposalRunId');
  if(id)void accept(id,false);
  return()=>{disposed=true;window.removeEventListener('neo:proposal',changed);};
 },[businessId,dataNature,snapshotId,setProposal,setNotice,setError,setView]);
}
