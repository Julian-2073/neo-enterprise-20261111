'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {customerJourneyChart} from '../../lib/customer-journey-chart';
import type {CustomerJourney,JourneyTransition} from '../../server/customer-journey';
import {api} from '../business/use-workspace';
import {useOperating,useNeoData} from './operating-context';
import {DemoShell} from './shell';
import {LineChart,MoneyBar} from './charts';
import {LiveAgentPanel} from './live-agents';
import {EvidenceDrawer} from './evidence-drawer';
import {CustomerPulseDrawer,type PulseReference} from './customer-pulse-drawer';
import {NeoIcon,type IconName} from './icons';
import {BusinessText} from './business-text';
import './live-people.css';

type Result={journey:CustomerJourney;review:{title:string;summary:string;runId:string}|null};
const stages=['A1','A2','A3','A4'] as const;
const names=['了解','互动','意向','购买'];
const percent=(n:number|null|undefined)=>n==null?'资料不足':`${(n*100).toFixed(1)}%`;
function delta(current:JourneyTransition|undefined,previous:JourneyTransition|undefined){
 if(current?.rate==null||previous?.rate==null)return '历史对照不足';
 const d=(current.rate-previous.rate)*100;
 return Math.abs(d)<0.05?'较前期持平':`较前期${d>0?'上升':'下降'} ${Math.abs(d).toFixed(1)} 个百分点`;
}
export function JourneyFunnel({journey,onEvidence}:{journey:CustomerJourney|null;onEvidence:()=>void}){
 const current=journey?.recent??journey?.period,previous=journey?.recent?journey.previous:null;
 return <section className="neo-card neo-live-journey" aria-label="4A 客户旅程">
  <div className="neo-live-journey-period">{journey?.recent?'近四周客户旅程':'统计期客户旅程'}{current&&<small>{current.start.slice(5)} 至 {current.end.slice(5)}</small>}</div>
  <div className="neo-funnel">{stages.map((stage,i)=>{const transition=current?.transitions[i],prior=previous?.transitions[i],declined=transition?.rate!=null&&prior?.rate!=null&&transition.rate<prior.rate;return <div className="neo-funnel-stage" key={stage}>
   <button type="button" onClick={onEvidence} aria-label={`查看 ${stage} ${names[i]}客户依据`}><span className="neo-stage-name"><NeoIcon name={(['eye','heart','people','cart'] as IconName[])[i]} size={24}/>{stage} {names[i]}</span><b>{current?.counts[stage]?.toLocaleString('zh-CN')??'—'}</b><small>客户</small></button>
   {i<3&&<div className={declined?'is-alert':''} title={transition?.reason??`按完成 ${journey?.rule?.days??'已设定'} 天观察的客户计算`}><span>{journey?percent(transition?.rate):'正在读取'}</span><i>→</i><small>{journey?delta(transition,prior):'正在比较'}</small></div>}
  </div>;})}</div>
  <details className="neo-live-journey-basis"><summary>查看转化口径和证据 →</summary>
   <p>按已关联客户去重；转化率看客户进入上一阶段后，是否在 {journey?.rule?.days??'已设定'} 天内进入下一阶段。{journey?.rule?.channelPolicy==='same_channel'?'只比较同一渠道。':'按已设定渠道规则比较。'}期末还没观察完的客户暂不计入。</p>
   {previous&&current&&<p>当前：{current.start} 至 {current.end}；前期：{previous.start} 至 {previous.end}。客户人数可在多个阶段出现，因此转化率由客户旅程逐一计算。</p>}
   {current?.transitions.map(t=><p key={t.from}>{t.from} → {t.to}：完成观察 {t.matureCustomers} 人，进入下一阶段 {t.convertedCustomers??'待核'} 人；尚在观察 {t.immatureCustomers} 人。{t.reason}</p>)}
   <p>购买指支付客户，退款另查；行为次数、订单笔数仍保留在原始记录中。</p><button type="button" className="neo-text-button" onClick={onEvidence}>查看客户与原始记录</button>
  </details>
 </section>;
}
export function LivePeoplePage(){
 const w=useOperating(),s=w?.snapshot,{demo,money,contributionShares}=useNeoData();
 const scope=s?`${s.businessId}/${s.dataNature}/${s.id}`:'',returnFocus=useRef<HTMLElement|null>(null);
 const [stored,setStored]=useState<{scope:string;result:Result|null;error:string}>({scope:'',result:null,error:''});
 const [backend,setBackend]=useState<{id:string;snapshotId:string;businessId:string;nature:string}|null>(null);
 const [pulseEvidence,setPulseEvidence]=useState<PulseReference|null>(null);
 useEffect(()=>{
  if(!s)return;let disposed=false,loading=false;const q=new URLSearchParams({businessId:s.businessId,dataNature:s.dataNature,snapshotId:s.id});
  const load=async()=>{if(loading)return;loading=true;try{const result=await api<Result>(`/api/v1/customer-journey?${q}`);if(result.journey.snapshotId!==s.id||result.journey.businessId!==s.businessId||result.journey.dataNature!==s.dataNature)throw Error('客户旅程与当前资料版本不一致');if(!disposed)setStored({scope,result,error:''});}catch(e){if(!disposed)setStored({scope,result:null,error:(e as Error).message});}finally{loading=false;}};
  void load();const timer=setInterval(()=>void load(),30000);window.addEventListener('neo:results',load);
  return()=>{disposed=true;clearInterval(timer);window.removeEventListener('neo:results',load);};
 },[s,scope]);
 const data=stored.scope===scope?stored.result:null,j=data?.journey,series=j?customerJourneyChart(j).map(s=>({...s,actualFormat:(n:number)=>`${n.toLocaleString('zh-CN')} 人`})):[];
 const openEvidence=useCallback((id?:string)=>{if(!s)return;returnFocus.current=document.activeElement as HTMLElement|null;setPulseEvidence(null);setBackend({id:id??s.evidenceIds.customerAnalysis??s.evidenceIds.operatingPulse,snapshotId:s.id,businessId:s.businessId,nature:s.dataNature});},[s]);
 const openPulse=(start:string|undefined)=>{if(!s||!start)return;returnFocus.current=document.activeElement as HTMLElement|null;setBackend(null);setPulseEvidence({id:`${s.id}:view:customer-pulse:${start}`,snapshotId:s.id,businessId:s.businessId,nature:s.dataNature});};
 const closeEvidence=()=>{setBackend(null);setPulseEvidence(null);requestAnimationFrame(()=>returnFocus.current?.focus());};
 const href=(path:string)=>{if(!s)return w?.href(path)??path;const url=new URL(path,'http://neo.local');url.searchParams.set('businessId',s.businessId);url.searchParams.set('dataNature',s.dataNature);url.searchParams.set('snapshotId',s.id);return url.pathname+url.search;};
 const fallbackTitle=j?.recent?'客户旅程已更新，先看各阶段承接':s?'正在汇总客户旅程':'正在读取经营资料';
 const fallbackSummary=j?.recent?`近四周，了解 ${j.recent.counts.A1??'待核'} 人、意向 ${j.recent.counts.A3??'待核'} 人、购买 ${j.recent.counts.A4??'待核'} 人；下方查看各环节转化与前期变化。`:'根据已保存的客户旅程和转化纠察结果，汇总当前变化。';
 return <div className="neo-live-people-host"><DemoShell active="people">
  <div className="neo-page-heading"><h1><BusinessText text={data?.review?.title??fallbackTitle}/></h1><p><BusinessText text={data?.review?.summary??fallbackSummary}/></p></div>
  {stored.scope===scope&&stored.error&&<p role="alert" className="neo-local-note">客户旅程暂未读取成功：{stored.error}</p>}{w?.error&&<p role="alert">{w.error}</p>}
  <div className="neo-page-content"><div className="neo-page-body"><div className="neo-columns"><div className="neo-primary-column">
   <JourneyFunnel journey={j??null} onEvidence={()=>openEvidence(j?.evidenceId??undefined)}/>
   <LineChart title="4A 经营脉搏" note="客户按周去重 · 前四周平均为 100" labels={j?.weekly.map(x=>`${x.start.slice(5)}–${x.end.slice(5)}`)??[]} series={series} min={Math.min(60,...series.flatMap(x=>x.values).filter((x):x is number=>x!=null))} max={Math.max(160,...series.flatMap(x=>x.values).filter((x):x is number=>x!=null))} reference={100} anomaly={false} toggleLabels={{relative:'相对走势',actual:'阶段人数'}} format={n=>`${Math.round(n)} 人`} onPoint={(_series,index)=>openPulse(j?.weekly[index]?.start)}/>
   <MoneyBar title="统计期净成交额组成" total={money(demo.financial.netRevenue)} items={[{label:'商品 / 平台 / 履约成本',value:contributionShares[0],amount:money(demo.financial.variableCost),color:'#c2d0e1'},{label:'投放费用',value:contributionShares[1],amount:money(demo.financial.advertisingSpend),color:'#67a6ee'},{label:'贡献毛利',value:contributionShares[2],amount:money(demo.financial.contributionMargin),color:'#2778e8'}]}/>
  </div><LiveAgentPanel mode="conversion" onEvidence={id=>openEvidence(id==='conversion-gap'?s?.evidenceIds.operatingPulse:id)}/></div></div></div>
  <div className="neo-return-link"><a href={href('/demo?page=overview')}>查看联动证据 →</a></div>
  <EvidenceDrawer evidence={null} backend={backend?.snapshotId===s?.id?backend:null} onClose={closeEvidence}/>
  <CustomerPulseDrawer reference={pulseEvidence?.snapshotId===s?.id?pulseEvidence:null} onClose={closeEvidence}/>
 </DemoShell></div>;
}
