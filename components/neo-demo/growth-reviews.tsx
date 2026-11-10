"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {api,automaticAnalysisAllowed} from '../business/use-workspace';
import {useOperating} from './operating-context';
import {runNeedsRefresh} from './agent-presentation';
import {NeoIcon} from './icons';
import {BusinessText} from './business-text';
import {GROWTH_REVIEW_MODES,type GrowthReviewMode} from '../../lib/growth-review-missions';
import type {AgentRun} from '../../server/agent-contracts';

type Reviews={reviews:Partial<Record<GrowthReviewMode,AgentRun>>;sourceKey:string;canGenerate:boolean;marketSearchAllowed:boolean;notice:string|null};
type State={data:Reviews|null;busy:boolean;error:string;update:()=>Promise<void>};
const Context=createContext<State>({data:null,busy:false,error:'',update:async()=>{}});
const labels={conversion:'客户转化',supply:'供需核查',market:'市场观察'};
const pages={conversion:'people',supply:'goods',market:'market'};
const waiting={conversion:'审查 4A 客户旅程的变化',supply:'审查库存、在途与供给承接',market:'筛选与本生意有关的行业信息'};

export function GrowthReviewProvider({enabled,children}:{enabled:boolean;children:ReactNode}){
 const w=useOperating(),s=w?.snapshot,business=w?.business,nature=w?.nature,scope=`${business}/${nature}/${s?.id}`;
 const [stored,setStored]=useState<{scope:string;data:Reviews|null;busy:boolean;error:string}>({scope:'',data:null,busy:false,error:''});
 const update=useRef<()=>Promise<void>>(async()=>{}),announced=useRef('');
 useEffect(()=>{
  if(!enabled||!s||!business||!nature)return;
  let disposed=false,fetching=false;let timer:ReturnType<typeof setTimeout>|undefined;
  const q=new URLSearchParams({businessId:business,dataNature:nature,snapshotId:s.id}),endpoint=`/api/v1/growth-reviews?${q}`;
  const load=async(refresh=false)=>{
   if(disposed||fetching)return;fetching=true;if(timer)clearTimeout(timer);
   setStored(v=>({scope,data:v.scope===scope?v.data:null,busy:true,error:''}));
   try{
    let data=await api<Reviews>(endpoint);if(disposed)return;
    if(data.canGenerate&&(refresh||(!s.id.startsWith('generation-')&&GROWTH_REVIEW_MODES.some(mode=>!data.reviews[mode])&&await automaticAnalysisAllowed(q)))){
     data=await api<Reviews>(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotId:s.id,dataNature:nature,...refresh?{refresh:true,requestId:crypto.randomUUID()}:{}})});if(disposed)return;
    }
    const running=Object.values(data.reviews).filter(runNeedsRefresh);
    if(running.length){await Promise.all(running.map(r=>api<AgentRun>(`/api/v1/agent-runs/${r.id}?${q}`)));if(disposed)return;data=await api<Reviews>(endpoint);if(disposed)return;}
    const busy=Object.values(data.reviews).some(runNeedsRefresh);setStored({scope,data,busy,error:''});
    if(busy)timer=setTimeout(()=>void load(),2500);
    else if(GROWTH_REVIEW_MODES.every(mode=>data.reviews[mode])){
     const batch=scope+GROWTH_REVIEW_MODES.map(mode=>data.reviews[mode]!.id+data.reviews[mode]!.status).join('/');
     if(announced.current!==batch){announced.current=batch;window.dispatchEvent(new Event('neo:results'));}
    }
   }catch(e){if(!disposed)setStored(v=>({...v,scope,busy:false,error:(e as Error).message}));}
   finally{fetching=false;}
  };
  update.current=()=>load(true);void load();
  return()=>{disposed=true;if(timer)clearTimeout(timer);update.current=async()=>{};};
 },[scope,enabled,s,business,nature]);
 const current=stored.scope===scope?stored:{data:null,busy:enabled&&!!s,error:''};
 return <Context.Provider value={{...current,update:()=>update.current()}}>{children}</Context.Provider>;
}

export function GrowthReviewLinks({reviews,href}:{reviews:Reviews['reviews'];href:(path:string)=>string}){
 return <div className="neo-decision-evidence-items">{GROWTH_REVIEW_MODES.map(mode=>{
  const run=reviews[mode],review=run?.result?.finding?.businessReview;
  const title=review?.title||(runNeedsRefresh(run)?waiting[mode]+'…':run&&run.status!=='completed'?'审查未完成，进入查看':waiting[mode]);
  return <a key={mode} href={href(`/demo?page=${pages[mode]}${run?`&reviewRunId=${encodeURIComponent(run.id)}`:''}`)} aria-label={`${labels[mode]}：${title}`} title={review?.summary}><b>{labels[mode]}</b><span><BusinessText text={title}/></span></a>;
 })}</div>;
}

export function GrowthReviewCards(){
 const w=useOperating(),state=useContext(Context);if(!w)return null;
 return <><div className="neo-decision-evidence"><div className="neo-decision-evidence-title"><NeoIcon name="robot" size={19}/><strong>增长智能体</strong><button className="neo-text-button" type="button" disabled={state.busy||!state.data?.canGenerate} onClick={()=>void state.update()}>{state.busy?'正在审查…':'更新审查'}</button></div><GrowthReviewLinks reviews={state.data?.reviews??{}} href={w.href}/></div>{state.error&&<p className="neo-local-note" role="alert">专业审查暂未完成，可进入对应页面查看或重试。</p>}</>;
}
