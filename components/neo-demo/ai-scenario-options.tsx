'use client';
import {useEffect,useRef,useState} from 'react';
import {api} from '../business/use-workspace';
import {BusinessText,ScenarioConditions} from './business-text';
import {canResumeRun,runBusinessStatus,runNeedsRefresh} from './agent-presentation';
import type {ForecastResult,ScenarioOption,ScenarioOptionEvaluation,ScenarioRecommendationsResponse,ScenarioResult} from '../../server/agent-contracts';
const percent=(v:number|null|undefined)=>v==null?'待核':`${(v*100).toFixed(1)}%`;
const money=(v:number|null|undefined)=>v==null?'待补数据':`¥${(v/100).toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
export function AIScenarioOptions({baseline,businessId,dataNature,snapshotId,canWrite,chosen,onSelect,onResults,onEvidence}:{baseline:ForecastResult|null;businessId:string;dataNature:string;snapshotId:string;canWrite:boolean;chosen:string;onSelect:(option:ScenarioOption,result:ScenarioResult|null)=>void;onResults:(items:ScenarioResult[])=>void;onEvidence:(id:string)=>void}){
 const baselineId=baseline?.id;
 const query=new URLSearchParams({businessId,dataNature,snapshotId,baselineId:baseline?.id??''}).toString(),token=query;
 const [stored,setStored]=useState<{token:string;value:ScenarioRecommendationsResponse}|null>(null),[error,setError]=useState(''),[sending,setSending]=useState(false),[calculating,setCalculating]=useState(false),[revision,setRevision]=useState(0);
 const epoch=useRef(token),callbacks=useRef({onResults,onSelect});useEffect(()=>{callbacks.current={onResults,onSelect};},[onResults,onSelect]);
 const evaluationAttempt=useRef(''),generationRequest=useRef<{token:string;requestId:string}|null>(null);
 const data=stored?.token===token?stored.value:null;
 useEffect(()=>{epoch.current=token;queueMicrotask(()=>{setSending(false);setCalculating(false);setError('');});return()=>{epoch.current='';};},[token]);
 useEffect(()=>{
  if(!baselineId)return;let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const load=async()=>{
   try{
    const value=await api<ScenarioRecommendationsResponse>(`/api/v1/scenario-recommendations?${query}`);if(disposed)return;
    setStored({token,value});setError('');
    const attemptKey=`${token}/${value.run?.id}`;
    if(value.run?.status==='completed'&&value.recommendations&&!value.evaluation&&canWrite&&evaluationAttempt.current!==attemptKey){
     evaluationAttempt.current=attemptKey;
     setCalculating(true);
     try{value.evaluation=await api(`/api/v1/scenario-recommendations/${encodeURIComponent(value.run.id)}/evaluate?${query}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotId,dataNature})});}
     catch(e){if(!disposed)setError(`建议已保存，计算与检验未完成：${(e as Error).message}`);return;}
     finally{if(!disposed)setCalculating(false);}
     if(disposed)return;
    }
    setStored({token,value});setError('');
    if(value.evaluation)callbacks.current.onResults(value.evaluation.items.flatMap(x=>x.scenario?[x.scenario]:[]));
    if(runNeedsRefresh(value.run)||value.run?.status==='deferred')timer=setTimeout(()=>void load(),3000);
   }catch(e){if(!disposed){setError((e as Error).message);timer=setTimeout(()=>void load(),10000);}}
  };
  void load();return()=>{disposed=true;if(timer)clearTimeout(timer);};
 },[query,token,revision,baselineId,canWrite,snapshotId,dataNature]);
 const generate=async()=>{
  if(!baseline||sending)return;const expected=token;setSending(true);setError('');
  if(generationRequest.current?.token!==token)generationRequest.current={token,requestId:crypto.randomUUID()};
  try{const value=await api<ScenarioRecommendationsResponse>(`/api/v1/scenario-recommendations?${query}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotId,dataNature,baselineId:baseline.id,requestId:generationRequest.current.requestId})});if(epoch.current===expected){generationRequest.current=null;setStored({token,value});setRevision(v=>v+1);}}
  catch(e){if(epoch.current===expected)setError((e as Error).message);}finally{if(epoch.current===expected)setSending(false);}
 };
 const control=async(action:'cancel'|'resume')=>{
  if(!data?.run||sending||!canWrite)return;const expected=token;setSending(true);setError('');
  try{await api(`/api/v1/agent-runs/${encodeURIComponent(data.run.id)}/${action}?${query}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(epoch.current===expected)setRevision(v=>v+1);}
  catch(e){if(epoch.current===expected){setError((e as Error).message);setRevision(v=>v+1);}}finally{if(epoch.current===expected)setSending(false);}
 };
 const pending=sending||calculating||runNeedsRefresh(data?.run)||data?.run?.status==='deferred';
 const options=data?.recommendations?.options??[];
 const externalIds=new Set(options.flatMap(option=>option.externalEvidenceIds)),externalSources=data?.recommendations?.externalSources?.filter(source=>externalIds.has(source.id))??[];
 return <>
  <div className="neo-live-actions"><button type="button" className="neo-text-button" disabled={!baseline||!canWrite||pending} onClick={()=>void generate()}>{pending?calculating?'正在推演并检验三个建议…':data?.run?.observability?.cancellationPending?'正在停止建议生成…':'AI 正在生成三个建议…':options.length?'重新生成三个 AI 建议':'生成三个 AI 建议并检验'}</button><small>{baseline?'固定当前基线，结合经营资料与已读取外部原文':'先计算或选择一份预测基线'}</small>
   {canWrite&&data?.run&&(['pending_dispatch','queued','running','deferred'].includes(data.run.status)||data.run.observability?.resumePending===true)&&!data.run.observability?.cancellationPending&&<button type="button" className="neo-text-button" disabled={sending} onClick={()=>void control('cancel')}>取消建议生成</button>}
   {canWrite&&canResumeRun(data?.run)&&<button type="button" className="neo-text-button" disabled={sending} onClick={()=>void control('resume')}>继续生成建议</button>}
   {canWrite&&options.length>0&&!data?.evaluation&&data?.run?.status==='completed'&&<button type="button" className="neo-text-button" disabled={pending} onClick={()=>{evaluationAttempt.current='';setRevision(v=>v+1);}}>重新计算与检验</button>}
  </div>
  {data?.run&&<p role="status">{runBusinessStatus(data.run)}{options.length>0&&!data.evaluation?'；建议已保存，计算与检验尚未完成。':''}</p>}
  {error&&<p className="neo-live-error" role="alert">{error}</p>}
  {data?.run&&['failed','cancelled'].includes(data.run.status)&&<p role="alert">{data.run.error??'建议生成未完成，请重新生成。'}</p>}
  {data?.recommendations?.externalNotice&&<p className="neo-local-note">{data.recommendations.externalNotice}</p>}
  <div className="neo-scenario-grid">{options.length?options.map(option=>{
   const evaluated=data?.evaluation?.items.find(x=>x.optionId===option.id),result=evaluated?.scenario??null,active=!!result&&result.id===chosen;
   return <button type="button" key={option.id} className={`neo-scenario ${active?'chosen':''}`} aria-pressed={active} onClick={()=>callbacks.current.onSelect(option,result)}>
    <div className="neo-scenario-title"><span>{option.id}</span><h3>{option.title}</h3></div><p><BusinessText text={option.summary}/></p><strong>{result?`${result.totals.units.toLocaleString('zh-CN',{maximumFractionDigits:1})} ${result.unit}`:data?.evaluation?'条件资料不足':'等待计算'}</strong><small style={{display:'block',fontSize:12,lineHeight:1.5,marginTop:4}}>{result?`条件贡献毛利 ${money(result.totals.contributionMarginCents)}`:'尚无可比较数值'}</small><small style={{display:'block',fontSize:12,lineHeight:1.5,marginTop:4}}>{result?`较基线 ${money(result.delta.contributionMarginCents)}`:evaluated?.error??'AI 作用参数仍待验证'}</small><small style={{display:'block',fontSize:12,lineHeight:1.5,marginTop:4}}>{evaluated?.replay?.status==='replayed'?`需求重放 WAPE ${percent(evaluated.replay.scenarioMetrics?.wape)}`:'历史检验：暂不能回测'}</small>
   </button>;
  }):['A','B','C'].map(id=><div key={id} className="neo-scenario"><div className="neo-scenario-title"><span>{id}</span><h3>等待 AI 建议</h3></div><p>生成后展示具体建议、成立条件和检验结果</p></div>)}</div>
  {externalSources.length?<details><summary>引用的外部原文（{externalSources.length} 项）</summary><div className="neo-joint-evidence">{externalSources.map(source=><a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} · 发布 {source.publishedAt?.slice(0,10)??'待核'} / 读取 {source.retrievedAt.slice(0,10)}</a>)}</div></details>:null}
  {options.length>0&&<details><summary>查看建议依据、参数与历史检验</summary>{options.map(option=><OptionDetails key={option.id} onEvidence={onEvidence} option={option} evaluation={data?.evaluation?.items.find(x=>x.optionId===option.id)}/>)}</details>}
  <p className="neo-local-note">AI 建议的作用参数是待验证假设。历史检验仅重放需求响应；未来到货、调拨和投入不视为历史已执行，贡献毛利差额不代表已验证收益。</p>
 </>;
}
function OptionDetails({option,evaluation,onEvidence}:{option:ScenarioOption;evaluation?:ScenarioOptionEvaluation;onEvidence:(id:string)=>void}){
 const replay=evaluation?.replay;
 return <section className="neo-live-proposal"><h3>{option.id} · {option.title}</h3><p>{option.rationale}</p><p>成立条件：{option.conditions.join('；')}</p><ScenarioConditions value={option.assumptions}/><p>经营依据 {option.evidenceIds.map((id,i)=><button type="button" className="neo-text-button" key={id} onClick={()=>onEvidence(id)}>依据 {i+1}</button>)} · 外部原文 {option.externalEvidenceIds.length} 项</p>{replay?.status==='replayed'?<p>同窗需求重放（{replay.foldCount} 个窗口）：基线 WAPE {percent(replay.baselineMetrics?.wape)} → 建议需求假设 WAPE {percent(replay.scenarioMetrics?.wape)}。建议在历史结束后生成，不能据此认定策略有效。</p>:<p>{replay?.notice??'历史检验尚未完成。'}</p>}{evaluation?.error&&<p>{evaluation.error}</p>}</section>;
}
