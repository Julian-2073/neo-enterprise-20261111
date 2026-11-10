'use client';
import {CurrentAssessmentSummary} from './assessment-details';
import {useEffect,useRef,useState} from 'react';
import type {ModelMarketWorkbench} from '../../server/market-review';
import type {AgentRun} from '../../server/agent-contracts';
import {api,automaticAnalysisAllowed} from '../business/use-workspace';
import {useOperating} from './operating-context';
import {DemoShell} from './shell';
import {MoneyBar} from './charts';
import {EvidenceDrawer} from './evidence-entry';
import {LiveAgentPanel} from './live-agents';
import {NeoIcon,type IconName} from './icons';
import {BusinessText} from './business-text';
import {runNeedsRefresh} from './agent-presentation';
import './live-market.css';
type Result=ModelMarketWorkbench&{run:AgentRun|null;model:string|null;canGenerate:boolean};
const money=(v:number|null|undefined)=>v==null?'资料不足':`¥${(v/100).toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
export function LiveMarketPage(){
 const w=useOperating(),s=w?.snapshot,scope=s?`${s.businessId}/${s.dataNature}/${s.id}`:'',active=useRef(scope);active.current=scope;
 const [stored,setStored]=useState<{scope:string;data:Result|null;error:string;busy:boolean}>({scope:'',data:null,error:'',busy:false});
 const [backend,setBackend]=useState<{id:string;snapshotId:string;businessId:string;nature:string}|null>(null),[expanded,setExpanded]=useState(false);
 const update=useRef<(refresh?:boolean)=>Promise<void>>(async()=>{}),focus=useRef<HTMLElement|null>(null);
 useEffect(()=>{
  if(!s)return;let disposed=false,fetching=false;let timer:ReturnType<typeof setTimeout>|undefined;
  const q=new URLSearchParams({businessId:s.businessId,dataNature:s.dataNature,snapshotId:s.id}),endpoint=`/api/v1/market-workbench?${q}`;
  const load=async(refresh=false)=>{if(disposed||fetching)return;fetching=true;if(timer)clearTimeout(timer);setStored(v=>({scope,data:v.scope===scope?v.data:null,error:'',busy:true}));
   try{let data=await api<Result>(endpoint);if(disposed)return;
    if(data.canGenerate&&(refresh||(!s.id.startsWith('generation-')&&!data.run&&await automaticAnalysisAllowed(q))))data=await api<Result>(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotId:s.id,dataNature:s.dataNature,...refresh?{refresh:true,requestId:crypto.randomUUID()}:{}})});
    if(disposed)return;if(runNeedsRefresh(data.run)){await api(`/api/v1/agent-runs/${data.run!.id}?${q}`);data=await api<Result>(endpoint);}if(disposed)return;
    if(data.snapshotId!==s.id||data.businessId!==s.businessId||data.dataNature!==s.dataNature)throw Error('市场分析与当前资料版本不一致');
    const busy=runNeedsRefresh(data.run);setStored({scope,data,busy,error:''});if(busy)timer=setTimeout(()=>void load(),3000);
   }catch(e){if(!disposed)setStored(v=>({...v,scope,busy:false,error:(e as Error).message}));}finally{fetching=false;}
  };update.current=load;void load();const changed=()=>void load();window.addEventListener('neo:results',changed);
  return()=>{disposed=true;if(timer)clearTimeout(timer);window.removeEventListener('neo:results',changed);update.current=async()=>{};};
 },[scope,s]);
 const state=stored.scope===scope?stored:null,data=state?.data;
 const open=(id?:string|null)=>{if(!s||!id)return;focus.current=document.activeElement as HTMLElement;const source=data?.sources.find(x=>x.id===id);setBackend({id:source?.evidenceId??id,snapshotId:s.id,businessId:s.businessId,nature:s.dataNature});};
 const close=()=>{setBackend(null);requestAnimationFrame(()=>focus.current?.focus());};
 const sources=data?.sources??[],visible=expanded?sources:sources.slice(0,3),historical=sources.filter(x=>x.timing==='historical');
 const failed=data?.run&&['failed','cancelled'].includes(data.run.status);
 const href=(path:string)=>{if(!s)return w?.href(path)??path;const url=new URL(path,'http://neo.local');url.searchParams.set('businessId',s.businessId);url.searchParams.set('dataNature',s.dataNature);url.searchParams.set('snapshotId',s.id);return url.pathname+url.search;};
 return <div className="neo-live-market-host"><DemoShell active="market"><CurrentAssessmentSummary/>
  <div className="neo-page-heading neo-market-heading"><div><h1><BusinessText text={data?.modelReview?data.judgment.title:failed?'市场分析尚未完成':s?.operating&&!state?.busy?'市场判断尚未生成':'正在分析渠道与竞品'}/></h1><p><BusinessText text={data?.modelReview?data.judgment.summary:'根据经营对比和行业原文，由大模型筛选、分析并给出判断。'}/></p></div><button className="neo-text-button" type="button" disabled={!!state?.busy||!data?.canGenerate} onClick={()=>void update.current(true)}>{state?.busy?'AI 正在分析…':failed?'重新分析':'更新市场判断'}</button></div>
  {(state?.error||failed)&&<p role="alert" className="neo-local-note">{state?.error||data?.run?.error||'本次分析未完成，已保存经营数字仍可查看。'}</p>}
  <div className="neo-page-content"><div className="neo-page-body"><div className="neo-columns"><div className="neo-primary-column">
   <div className="neo-signal-grid">{(data?.signals??['demand','competition','efficiency'].map(id=>({id,name:{demand:'需求场景',competition:'竞品态势',efficiency:'渠道效率'}[id],title:'等待 AI 分析',summary:'正在读取经营资料。',value:'—',delta:null,evidenceId:null}))).map(signal=><button type="button" key={signal.id} className="neo-card neo-signal neo-market-signal" onClick={()=>open(s?`${s.id}:view:market-${signal.id}`:null)} disabled={!signal.evidenceId&&!data?.modelReview}><div className="neo-signal-title"><span className="neo-icon-circle"><NeoIcon name={({demand:'chart',competition:'target',efficiency:'market'} as Record<string,IconName>)[signal.id]}/></span><div><h3>{signal.name}</h3><p><BusinessText text={signal.title}/></p></div></div><b className="neo-market-signal-value">{signal.value}</b><span className="neo-market-metric-label">{{demand:'意向较前四周',competition:'相关竞品来源',efficiency:'每单投放较前四周'}[signal.id as 'demand']}</span><small className="neo-market-signal-hint">查看分析与依据 <NeoIcon name="arrow" size={13}/></small></button>)}</div>
   <section className="neo-card neo-market-matrix-card"><h2>渠道 × 商品角色 · 经营态势</h2><p className="neo-market-note">{data?.periods.current.start} 至 {data?.periods.current.end} · {data?.periods.previous?'对照前四周':'前期对照不足'} · 点击查看证据</p>
    {data?.roles.length?<div className="neo-matrix" style={{gridTemplateColumns:`minmax(96px,.48fr) repeat(${data.roles.length},minmax(205px,1fr))`}}><div className="matrix-head"/>{data.roles.map(r=><div className="matrix-head" key={r.id}>{r.name}</div>)}{data.channels.map(channel=><div className="neo-matrix-row" key={channel.channel}><div className="matrix-channel"><NeoIcon name="market"/>{channel.name}</div>{data.roles.map(role=>{const c=data.cells.find(x=>x.channel===channel.channel&&x.role===role.id);return <button type="button" className={`matrix-cell ${c?.status==='needs_check'?'needs-check':''}`} key={role.id} onClick={()=>open(c?.evidenceId)}><div className="neo-market-cell-heading"><b><BusinessText text={c?.headline??'等待分析'}/></b>{c?.status==='needs_check'&&<em>需核查</em>}</div><div className="neo-market-cell-metrics">{c?.displayMetrics.slice(0,2).map(m=><div key={m.id}><span className="neo-market-cell-label">{m.label}</span><div className="neo-market-cell-number"><strong>{m.value}</strong><small>{m.unit}</small></div><span className={`neo-market-change ${m.direction}`}>{m.change}</span></div>)}</div><div className="neo-market-cell-foot">{c?.displayMetrics.slice(2).map(m=><span key={m.id}>{m.label} <b>{m.value}</b><small>{m.unit}</small></span>)}</div></button>;})}</div>)}</div>:<p>商品角色资料不足；补齐商品与规格归属后自动计算。</p>}
    <p className="neo-helper">变化对照前四周 · 未归属货盘的费用不分摊</p>
   </section>
   <section className="neo-card"><div className="neo-market-section-title"><h2>市场变化与机会</h2><small>{data?.modelReview?`AI 从 ${data.sourceSelections.length} 条候选中选出 ${sources.length} 条`:s?.operating&&!state?.busy?'等待市场智能体筛选':'AI 正在筛选相关原文'}</small></div>
    <p className="neo-market-note">近期市场观察，与历史经营分别判断</p><div className="neo-events neo-market-events">{visible.map(e=><button type="button" key={e.id} onClick={()=>open(e.evidenceId)}><b>{(e.publishedAt??e.retrievedAt).slice(0,10)}{!e.publishedAt&&' · 读取'}</b><strong><BusinessText text={e.summary}/></strong><span><BusinessText text={e.relevance}/></span><small>{e.publisher} · {({competition:'产品与竞品',demand:'需求场景',channel:'渠道规则',policy:'行业政策'})[e.category]} →</small></button>)}</div>
    {!sources.length&&<p>{data?.modelReview?'本次没有筛选出足够相关且可核验的原文。可向市场智能体继续补充行业、竞品或渠道线索。':'原文筛选完成后，将在这里展示与当前生意有关的变化和机会。'}</p>}
    {sources.length>3&&<button className="neo-text-button" onClick={()=>setExpanded(!expanded)}>{expanded?'收起':'查看其他相关观察'}</button>}
    {!!historical.length&&<p className="neo-market-note">其中 {historical.length} 条在经营时点已可读取；同期出现也不证明因果。</p>}
    {!!data?.sourceSelections.length&&<details className="neo-market-selection"><summary>查看 AI 筛选理由</summary>{data.sourceSelections.map(x=><p key={x.id}><b>{x.selected?'保留':'排除'}</b> · <BusinessText text={x.reason}/></p>)}</details>}
   </section>
   <MoneyBar title="统计期渠道投入结构" total={money(data?.spendTotalCents)} items={(data?.spends??[]).map((c,i)=>({label:c.name,value:c.amountCents!=null&&data?.spendTotalCents?c.amountCents/data.spendTotalCents:null,amount:money(c.amountCents),color:['#2678e8','#60a8ee','#9270e6'][i%3]}))} onItem={i=>open(data?.spends[i]?.evidenceId)}/>
   {!!data?.unallocatedSpendCents&&<p className="neo-local-note">未归属渠道的投放 {money(data.unallocatedSpendCents)}，不分摊给其他渠道。</p>}
   {data?.modelReview&&<p className="neo-local-note">建议先核查：<BusinessText text={data.modelReview.nextStep}/></p>}
  </div><LiveAgentPanel mode="market" compact onEvidence={open}/></div></div></div>
  <div className="neo-return-link"><a href={href('/demo?page=overview')}>查看联动证据 →</a></div><EvidenceDrawer evidence={null} backend={backend?.snapshotId===s?.id?backend:null} onClose={close}/>
 </DemoShell></div>;
}
