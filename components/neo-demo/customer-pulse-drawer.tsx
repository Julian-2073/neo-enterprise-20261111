'use client';
import {useEffect,useRef,useState} from 'react';
import {OperatingEvidenceDrawer} from './operating-evidence-drawer';
import {api} from '../business/use-workspace';
import {useFrozenDomain} from './operating-context';
import {evidenceSourceText} from '../../lib/evidence-presentation';
import {investigationError} from '../../lib/business-presentation';
import type {CustomerPulse} from '../../server/customer-pulse';
import './customer-pulse-drawer.css';

export type PulseReference={id:string;snapshotId:string;businessId:string;nature:string};
type Source={kind:string;batch_id:string;filename:string;source_name:string;recordCount:number};
type RecordRow={id:string;kind:string;row_number:number;payload:string;batch_id:string;source_name:string;filename:string};
export type PulseResponse={evidence:{id:string;snapshotId:string;businessId:string;dataNature:string;title:string;value:CustomerPulse;sourceCount:number;scopeLabel:string;asOf:string};sources:Source[];records:RecordRow[];nextCursor:number|null};
const quantity=(n:number|null)=>n==null?'资料不足':n.toLocaleString('zh-CN');
const rate=(n:number|null)=>n==null?'资料不足':`${(n*100).toFixed(1)}%`;
const sourceKinds:Record<string,string>={events:'客户行为',orders:'支付记录',customers:'客户资料',customer_identities:'客户身份关联'};
const names={A1:'了解',A2:'互动',A3:'意向',A4:'购买'};
const query=(ref:PulseReference)=>new URLSearchParams({businessId:ref.businessId,dataNature:ref.nature,snapshotId:ref.snapshotId});

// Presentation reads the server diagnostic verbatim; it never recreates
// customer counts, change judgments, or conversion denominators in the UI.
export function CustomerPulseContent({data,reference,products=[],channels=[],onMore,loading=false,error=''}:{data:PulseResponse;reference:PulseReference;products?:Array<{id:string;name:string}>;channels?:Array<{id:string;name:string}>;onMore?:()=>void;loading?:boolean;error?:string}){
 const p=data.evidence.value;
 const kinds=[...new Set(data.sources.map(x=>x.kind))];
 return <>
  <span className="neo-overline">证据详情 · {reference.nature==='demo'?'模拟经营资料':'已保存经营资料'}</span>
  <h2 id="customer-pulse-title">{data.evidence.title}</h2>
  <div className="neo-pulse-judgment"><strong>{p.judgment.title}</strong><p>{p.judgment.summary}</p></div>
  <dl className="neo-definition neo-pulse-definition"><dt>统计范围</dt><dd>{data.evidence.scopeLabel}</dd><dt>对照期间</dt><dd>{p.previousWeek?`${p.previousWeek.start} 至 ${p.previousWeek.end}（上周）`:'缺少紧邻的完整上周'}</dd></dl>
  <section aria-label="本周客户变化"><h3>这一周发生了什么</h3><table className="neo-pulse-table"><thead><tr><th>阶段</th><th>本周客户</th><th>较上周</th><th>相对指数</th></tr></thead><tbody>{p.stages.map(x=><tr key={x.stage} className={p.focus===x.stage?'is-focused':''}><th>{x.stage} {x.name}</th><td>{quantity(x.customers)}</td><td>{x.difference==null?'资料不足':x.difference===0?'持平':`${x.difference>0?'+':'−'}${quantity(Math.abs(x.difference))} 人`}</td><td>{x.index==null?'—':x.index.toFixed(0)}</td></tr>)}</tbody></table><p className="neo-pulse-note">人数按客户身份去重；相对指数以统计期前四周平均为 100。</p></section>
  <section aria-label="客户承接分析"><h3>转化是否同步</h3>{p.observations.map((text,i)=><p key={i}>{text}</p>)}{p.conversion&&<details><summary>查看三个环节的成熟转化</summary><p className="neo-pulse-note">{p.conversion.start} 至 {p.conversion.end}；{p.conversion.previousStart?`对照 ${p.conversion.previousStart} 至 ${p.conversion.previousEnd}`:'没有再前四周的完整对照'}。</p><table className="neo-pulse-table"><thead><tr><th>环节</th><th>本期转化</th><th>前期转化</th><th>完成观察</th></tr></thead><tbody>{p.conversion.transitions.map(t=><tr key={t.from}><th>{names[t.from]} → {names[t.to]}</th><td>{rate(t.rate)}</td><td>{rate(t.previousRate)}</td><td>{t.matureCustomers} 人</td></tr>)}</tbody></table>{p.conversion.transitions.filter(t=>t.reason).map(t=><p className="neo-pulse-note" key={t.from}>{names[t.from]} → {names[t.to]}：{t.reason}</p>)}</details>}</section>
  <section className="neo-pulse-action" aria-label="下一步核查"><h3>建议先核查</h3><p>{p.judgment.nextStep}</p></section>
  <dl className="neo-definition neo-pulse-definition"><dt>来源摘要</dt><dd>{kinds.map(kind=><p className="neo-pulse-source" key={kind}>{sourceKinds[kind]??'关联资料'} · {data.sources.filter(x=>x.kind===kind).reduce((n,x)=>n+x.recordCount,0)} 条记录</p>)}<p className="neo-pulse-note">仅引用支持本周、对照期和图表基准的已保存资料。记录条数不等于客户人数。</p></dd><dt>资料截至</dt><dd>{data.evidence.asOf}</dd></dl>
  <details className="neo-pulse-trace"><summary>查看来源文件与原始记录</summary><ul>{[...new Map(data.sources.map(x=>[x.batch_id,x])).values()].map(x=><li key={x.batch_id}>{x.source_name} · {x.filename} <a href={`/api/v1/ingestion-batches/${x.batch_id}/file?${query(reference)}`}>下载原文件</a></li>)}</ul>{data.records.map(r=><details key={r.id}><summary>{sourceKinds[r.kind]??'关联资料'} · {r.filename} · 第 {r.row_number} 条</summary><p>{evidenceSourceText(JSON.parse(r.payload),products,channels)}</p></details>)}{data.nextCursor!=null&&onMore&&<button type="button" className="neo-text-button" disabled={loading} onClick={onMore}>{loading?'正在读取…':'查看更多原始记录'}</button>}{error&&<p role="alert">{error}</p>}</details>
  <details className="neo-pulse-trace"><summary>查看统计规则与资料版本</summary><p>观察窗口：{p.rule?`${p.rule.days} 天，${p.rule.channelPolicy==='same_channel'?'同一渠道':'允许跨渠道'}`:'尚未配置'}。</p>{p.limitations.map((text,i)=><p key={i}>{text}</p>)}<p className="neo-pulse-note">资料版本：{reference.snapshotId}<br/>分析版本：{p.version}<br/>证据编号：{reference.id}</p></details>
  <p className="neo-disclosure">{reference.nature==='demo'?'当前为模拟经营资料，分析只验证方法；尚未核验实际经营效果。':'结论基于已保存经营资料，来源完整性与业务真实性仍需核实。'}</p>
 </>;
}

function LegacyCustomerPulseDrawer({reference,onClose}:{reference:PulseReference|null;onClose:()=>void}){
 const domain=useFrozenDomain(),dialog=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null),active=useRef(reference);
 const key=reference?`${reference.businessId}/${reference.nature}/${reference.snapshotId}/${reference.id}`:'';
 const [stored,setStored]=useState<{key:string;data:PulseResponse}|null>(null),[failure,setFailure]=useState<{key:string;message:string}|null>(null),[loading,setLoading]=useState(false);
 const data=stored?.key===key?stored.data:null,error=failure?.key===key?failure.message:'';
 useEffect(()=>{active.current=reference;},[reference]);
 useEffect(()=>{
  const ref=active.current;if(!ref)return;const controller=new AbortController();
  api<PulseResponse>(`/api/v1/evidence/${encodeURIComponent(ref.id)}?${query(ref)}&limit=20`,{signal:controller.signal}).then(data=>{if(data.evidence.id!==ref.id||data.evidence.snapshotId!==ref.snapshotId||data.evidence.businessId!==ref.businessId||data.evidence.dataNature!==ref.nature||data.evidence.value.version!=='customer-pulse-v1')throw Error('分析与所选经营资料不一致');if(!controller.signal.aborted)setStored({key,data});}).catch(e=>{if(!controller.signal.aborted)setFailure({key,message:investigationError(e.message)});});
  return()=>controller.abort();
 },[key]);
 useEffect(()=>{
  if(!reference)return;close.current?.focus();
  const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onClose();return;}if(e.key!=='Tab'||!dialog.current)return;const controls=[...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],summary,[tabindex="0"]')].filter(x=>x.getClientRects().length>0),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
 },[reference,onClose]);
 async function more(){
  if(!reference||!data||data.nextCursor==null||loading)return;const selected=key;setLoading(true);
  try{const next=await api<PulseResponse>(`/api/v1/evidence/${encodeURIComponent(reference.id)}?${query(reference)}&cursor=${data.nextCursor}&limit=20`);const ref=active.current;if(!ref||`${ref.businessId}/${ref.nature}/${ref.snapshotId}/${ref.id}`!==selected)return;if(next.evidence.id!==reference.id||next.evidence.snapshotId!==reference.snapshotId||next.evidence.businessId!==reference.businessId||next.evidence.dataNature!==reference.nature)throw Error('原始记录与当前资料不一致');setStored({key:selected,data:{...next,records:[...data.records,...next.records]}});}catch(e){setFailure({key:selected,message:investigationError((e as Error).message)});}finally{setLoading(false);}
 }
 if(!reference)return null;
 return <div className="neo-drawer-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><aside ref={dialog} className="neo-drawer neo-pulse-drawer" role="dialog" aria-modal="true" aria-labelledby="customer-pulse-title"><button ref={close} className="neo-drawer-close" onClick={onClose} aria-label="关闭客户旅程分析">×</button>{data?<CustomerPulseContent data={data} reference={reference} products={domain?.products??[]} channels={domain?.channels??[]} onMore={()=>void more()} loading={loading} error={error}/>:<><h2 id="customer-pulse-title">{error?'暂未读取到客户旅程分析':'正在分析这一周的客户旅程'}</h2><p role={error?'alert':'status'}>{error||'正在核对客户人数、上周变化与成熟转化依据。'}</p></>}</aside></div>;
}

export function CustomerPulseDrawer(props:{reference:PulseReference|null;onClose:()=>void}){return !props.reference?null:props.reference.snapshotId.startsWith('generation-')?<OperatingEvidenceDrawer reference={props.reference} onClose={props.onClose}/>:<LegacyCustomerPulseDrawer {...props}/>;}
