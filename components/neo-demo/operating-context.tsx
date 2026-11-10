"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {PATROL_QUESTION,patrolDay,patrolRequestId} from '../../lib/agent-missions';
import {enrichSavedDomain,type FrozenDomain} from '../../lib/operating-domain-data';
import {runNeedsRefresh,canResumeRun} from './agent-presentation';
import {currentAssessmentRun} from '../../lib/assessment-presentation';
import type {AgentPolicy} from '../../server/agent-policy';
import type {AgentRun} from '../../server/agent-contracts';
import {useWorkspace,api} from '../business/use-workspace';
import {demo as example,money as exampleMoney} from '../../lib/neo-demo';
import {savedNeoData,neoCalculations,displayMoney,displayPercent} from '../../lib/operating-demo-data';
export type OperatingWorkspace=ReturnType<typeof useWorkspace>;
const Context=createContext<OperatingWorkspace|null>(null);
export const useOperating=()=>useContext(Context);
type Insights={runs:AgentRun[];patrol:AgentRun|null;assessmentRun:AgentRun|null;error:string};
const DomainContext=createContext<FrozenDomain|null>(null);
export const useFrozenDomain=()=>useContext(DomainContext);
const InsightsContext=createContext<Insights&{resumePatrol:()=>Promise<void>}>({runs:[],patrol:null,assessmentRun:null,error:'',resumePatrol:async()=>{}});
export const useAgentInsights=()=>useContext(InsightsContext);
const businessDay=patrolDay;
export function OperatingProvider({children}:{children:ReactNode}) {
 const w=useWorkspace();
const [domain,setDomain]=useState<FrozenDomain|null>(null);const [insights,setInsights]=useState<Insights>({runs:[],patrol:null,assessmentRun:null,error:''}),[day,setDay]=useState('');const scope=`${w.business}/${w.nature}/${w.snapshot?.id}`;const currentScope=useRef(scope);currentScope.current=scope;
 const resumePatrol=async()=>{if(!canResumeRun(insights.patrol))return;const id=insights.patrol!.id;const q=new URLSearchParams({businessId:w.business,dataNature:w.nature});try{await api(`/api/v1/agent-runs/${id}/resume?${q}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(currentScope.current===scope)window.dispatchEvent(new Event('neo:results'));}catch(e){if(currentScope.current===scope)setInsights(v=>({...v,error:(e as Error).message}));}};
 useEffect(()=>{let disposed=false;setDomain(null);if(w.snapshot){const q=new URLSearchParams({businessId:w.business,dataNature:w.nature,snapshotId:w.snapshot.id});void api<FrozenDomain>(`/api/v1/agent-domain?${q}`).then(d=>{if(!disposed)setDomain(d);}).catch(()=>{});}return()=>{disposed=true;};},[scope,w.business,w.nature,w.snapshot]);
 useEffect(()=>{setDay(businessDay());const timer=setInterval(()=>setDay(businessDay()),60000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  let disposed=false;let timer:ReturnType<typeof setTimeout>|undefined;const s=w.snapshot;setInsights({runs:[],patrol:null,assessmentRun:null,error:''});if(!s||!day)return;
  const q=new URLSearchParams({businessId:w.business,dataNature:w.nature,snapshotId:s.id});
  const refresh=async()=>{try{const data=await api<{items:AgentRun[];currentConfigurationId:string|null}>(`/api/v1/agent-runs?${q}`);if(disposed)return;const patrol=data.items.find(r=>r.purpose==='patrol')??null;setInsights({runs:data.items,patrol,assessmentRun:currentAssessmentRun(data.items,s,data.currentConfigurationId??null),error:''});const working=data.items.some(runNeedsRefresh);timer=setTimeout(()=>void refresh(),working?2000:30000);}catch(e){if(!disposed){setInsights(v=>({...v,error:(e as Error).message}));timer=setTimeout(()=>void refresh(),30000);}}};
  const start=async()=>{try{const policy=await api<AgentPolicy>(`/api/v1/agent-policy?${q}`);if(disposed)return;if(policy.automaticPatrolAllowed&&w.member?.role!=='reader')await api(`/api/v1/agent-runs?${q}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotId:s.id,dataNature:s.dataNature,mode:'joint',purpose:'patrol',requestId:patrolRequestId(s.id,day),question:PATROL_QUESTION})});}catch(e){if(!disposed)setInsights(v=>({...v,error:(e as Error).message}));}if(!disposed)void refresh();};
  const changed=()=>{if(timer)clearTimeout(timer);void refresh();};window.addEventListener('neo:results',changed);void start();
  return()=>{disposed=true;if(timer)clearTimeout(timer);window.removeEventListener('neo:results',changed);};
 },[scope,day,w.member?.role,w.business,w.nature,w.snapshot]);
 return <Context.Provider value={w}><DomainContext.Provider value={domain}><InsightsContext.Provider value={{...insights,resumePatrol}}>{children}</InsightsContext.Provider></DomainContext.Provider></Context.Provider>;
}

export function useNeoData(){
 const operating=useOperating();
 const demo=operating?savedNeoData(operating.snapshot,operating.member?.name,operating.error):example;
 const domain=useFrozenDomain();if(operating?.snapshot&&domain)enrichSavedDomain(demo,operating.snapshot,domain);
 const {assessmentRun:chosen}=useAgentInsights();const organization=chosen?.result?.businessAssessment?.projections.finding?.organization;
 if(operating&&organization){demo.issue.title=organization.headline;demo.opportunities=organization.priorities.map((p,i)=>({id:`priority-${i}`,title:p.title,reason:p.reason,kind:"巡检议题",status:p.urgency,source:"智能体研判 · 见原始证据",date:chosen?.createdAt||"",linkedPage:"overview"}));}
 const calculations=neoCalculations(demo,!!operating,operating?.snapshot);
 const href=(path:string)=>{if(operating){if(!operating.snapshot||operating.snapshot.operating)return operating.href(path);const u=new URL(path,"http://neo.local"),s=operating.snapshot;u.searchParams.set("businessId",s.businessId);u.searchParams.set("dataNature",s.dataNature);u.searchParams.set("snapshotId",s.id);return `${u.pathname}${u.search}${u.hash}`;}const u=new URL(path,"http://neo.local");u.searchParams.set("mode","example");return `${u.pathname}${u.search}${u.hash}`;};
 return {demo,operating,href,insights:chosen?.result,...calculations,money:operating?displayMoney:(n:number|null)=>n==null?"待补数据":exampleMoney(n),percent:displayPercent,pp:(n:number|null)=>n==null?'待接入':`${(n*100).toFixed(1)} 个百分点`};
}
