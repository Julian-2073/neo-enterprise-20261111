'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../business/use-workspace';
import {useOperating} from './operating-context';
import type {PolicyBriefing} from '../../server/policy-briefing';
import {NeoIcon} from './icons';
type Response={briefing:PolicyBriefing|null;canRefresh?:boolean};
export function PolicyBriefingView({briefing,busy,error,canRefresh,onRefresh,example=false}:{briefing:PolicyBriefing|null;busy:boolean;error:string;canRefresh:boolean;onRefresh:()=>void;example?:boolean}){
 return <article className="neo-brief-policy" aria-busy={busy}>
  <div className="neo-brief-section-head"><h3><NeoIcon name="evidence" size={19}/>行业政策</h3><div><span>{briefing?.items.length?'政府原文已核验':'政府原文'}</span>{canRefresh&&<button type="button" onClick={onRefresh} disabled={busy}>{busy?'正在核验…':'更新政策'}</button>}</div></div>
  {busy&&<p className="neo-brief-notice" role="status">正在读取政府原文，核对政策范围和发布时间…</p>}
  {error&&<p className="neo-brief-notice" role="alert">政策原文暂未更新，请稍后重试。{briefing?.items.length?'下方为上次保存的资料。':''}</p>}
  {!!briefing?.items.length&&<div className="neo-brief-policy-grid">{briefing.items.map(item=><section key={item.id} className="neo-brief-policy-item">
   <div className="neo-brief-policy-meta"><span>{item.source.issuer}</span><time dateTime={item.source.publishedAt??undefined}>发布 {item.source.publishedAt??'日期待核'}</time></div>
   <h4>{item.label}</h4><p>{item.summary}</p><div className="neo-brief-policy-impact"><b>对你的生意</b><p>{item.relevance}</p></div>
   <details><summary>适用范围与来源</summary><p>{item.applicability}</p><p>{item.source.documentNumber} · 原文核验 {item.source.retrievedAt.slice(0,10)}</p><a href={item.source.url} target="_blank" rel="noreferrer">{item.source.title} ↗</a></details>
  </section>)}</div>}
  {!briefing?.items.length&&!busy&&!error&&<p className="neo-brief-notice">{example?'原型演示未接入实时政策；不把模拟信息作为政策依据。':briefing?.gaps[0]??(canRefresh?'政策资料待核验。':'暂无已保存的政策原文。')}</p>}
  {briefing&&<div className="neo-brief-policy-foot"><small>{briefing.stale?'资料尚未完成今日核验 · ':''}核验 {briefing.checkedAt.slice(0,10)} · 当前政策观察，不能直接解释历史成交。</small><details><summary>检索覆盖与缺口</summary><p>{briefing.coverage}</p>{briefing.gaps.map(gap=><p key={gap}>{gap}</p>)}</details></div>}
 </article>;
}
export function PolicyBriefingPanel(){
 const operating=useOperating(),s=operating?.snapshot,scope=s?`${s.businessId}/${s.dataNature}/${s.id}`:'';
 const currentScope=useRef(scope);
 useEffect(()=>{currentScope.current=scope;},[scope]);
 const [state,setState]=useState<{scope:string;data:Response|null;busy:boolean;error:string}>({scope:'',data:null,busy:false,error:''});
 const load=useCallback(async(refresh=false)=>{
  if(!s)return;const query=new URLSearchParams({businessId:s.businessId,snapshotId:s.id,dataNature:s.dataNature});
  const input={snapshotId:s.id,dataNature:s.dataNature,...(refresh?{refresh:true,requestId:crypto.randomUUID()}:{} )};
  return api<Response>(`/api/v1/policy-briefing?${query}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 },[s]);
 useEffect(()=>{
  let disposed=false;if(!s)return;
  const query=new URLSearchParams({businessId:s.businessId,snapshotId:s.id,dataNature:s.dataNature});
  void api<Response>(`/api/v1/policy-briefing?${query}`).then(async data=>{
   if(disposed)return;setState({scope,data,busy:false,error:''});
   if(data.canRefresh&&(!data.briefing||data.briefing.stale)){
    setState({scope,data,busy:true,error:''});const updated=await load();if(!disposed)setState({scope,data:updated??data,busy:false,error:''});
   }
  }).catch(()=>{if(!disposed)setState(previous=>({...previous,scope,busy:false,error:'政策资料读取失败'}));});
  return()=>{disposed=true;};
 },[scope,s,load]);
 const current=state.scope===scope?state:null;
 const refresh=async()=>{
  if(!s||current?.busy)return;setState({scope,data:current?.data??null,busy:true,error:''});
  try{const data=await load(true);setState(previous=>currentScope.current===scope?{scope,data:data??null,busy:false,error:''}:previous);}catch{setState(previous=>currentScope.current===scope?{...previous,busy:false,error:'政策资料读取失败'}:previous);}
 };
 return <PolicyBriefingView briefing={current?.data?.briefing??null} busy={current?.busy??!!s} error={current?.error??''} canRefresh={current?.data?.canRefresh??current?.data?.briefing?.canRefresh??false} onRefresh={()=>void refresh()} example={!operating}/>;
}
