'use client';
import {useEffect,useRef,useState} from 'react';
import type {HomeSections,SupplyOverview} from '../../server/home-sections';
import {LiveAgentPanel} from './live-agents';
import type {Fact} from '../../server/contracts';
import type {AgentRun} from '../../server/agent-contracts';
import {api,automaticAnalysisAllowed} from '../business/use-workspace';
import {useOperating} from './operating-context';
import {runNeedsRefresh} from './agent-presentation';
import {LineChart} from './charts.tsx';
import {NeoIcon,type IconName} from './icons';
import {BusinessText} from './business-text';
import {OperatingEvidenceDrawer} from './operating-evidence-drawer';
import {CustomerPulseDrawer,type PulseReference} from './customer-pulse-drawer';
import './live-home-sections.css';
const number=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN');
const percent=(n:number|null|undefined)=>n==null?'资料不足':`${(n*100).toFixed(1)}%`;
function useHomeSections(){
 const w=useOperating(),s=w?.snapshot,scope=s?`${s.businessId}/${s.dataNature}/${s.id}`:'';
 const [stored,setStored]=useState<{scope:string;data:HomeSections|null;error:string}>({scope:'',data:null,error:''});
 useEffect(()=>{
  if(!s)return;let disposed=false,fetching=false;let timer:ReturnType<typeof setTimeout>|undefined;
  const q=new URLSearchParams({businessId:s.businessId,dataNature:s.dataNature,snapshotId:s.id}),endpoint=`/api/v1/home-sections?${q}`;
  const load=async()=>{if(disposed||fetching)return;fetching=true;if(timer)clearTimeout(timer);
   try{let data=await api<HomeSections>(endpoint);if(disposed)return;
    if(data.market.canGenerate&&!s.id.startsWith('generation-')&&!data.market.run&&await automaticAnalysisAllowed(q)){await api(`/api/v1/market-workbench?${q}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotId:s.id,dataNature:s.dataNature})});if(disposed)return;data=await api<HomeSections>(endpoint);}
    if(runNeedsRefresh(data.market.run)){await api(`/api/v1/agent-runs/${data.market.run!.id}?${q}`);if(disposed)return;data=await api<HomeSections>(endpoint);}
    if(disposed)return;if(data.snapshotId!==s.id||data.businessId!==s.businessId||data.dataNature!==s.dataNature)throw Error('首页摘要与当前资料版本不一致');
    setStored({scope,data,error:''});timer=setTimeout(()=>void load(),runNeedsRefresh(data.market.run)||!data.people.review||!data.goods.review?3000:30000);
   }catch(e){if(!disposed){setStored(v=>({...v,scope,data:v.scope===scope?v.data:null,error:(e as Error).message}));timer=setTimeout(()=>void load(),30000);}}
   finally{fetching=false;}
  };void load();window.addEventListener('neo:results',load);
  return()=>{disposed=true;if(timer)clearTimeout(timer);window.removeEventListener('neo:results',load);};
 },[s,scope]);
 return stored.scope===scope?stored:{data:null,error:''};
}
function Title({topic,title,icon}:{topic:string;title:string;icon:IconName}){return <div className="neo-summary-title"><span className={`neo-icon-circle topic-${topic}`}><NeoIcon name={icon}/></span><h2>{topic}<span/> {title}</h2></div>;}
export function HomeSectionsContent({data,href,open}:{data:HomeSections|null;href:(path:string)=>string;open:(id?:string|null)=>void}){
 const p=data?.people,g=data?.goods,m=data?.market;
 const series=p?.series.map(s=>({...s,actualFormat:(n:number)=>`${n.toLocaleString('zh-CN')} 人`}))??[];
 const bounds=series.flatMap(x=>x.values).filter((x):x is number=>x!=null);
 return <div className="neo-live-home-sections">
  <section className="neo-card neo-teaser" aria-label="人 · 我的客户">
   <div className="neo-teaser-copy"><Title topic="人" title="客户转化" icon="people"/><h3><BusinessText text={p?.review?.title??'正在分析客户旅程'}/></h3><p><BusinessText text={p?.review?.summary??'客户人数和各阶段承接已计算，等待转化纠察智能体完成判断。'}/></p>
    <button type="button" className="neo-summary-stat" disabled={!p?.evidenceId} onClick={()=>open(p?.evidenceId)}><span>{p?.period.comparable?'近四周购买客户':'统计期购买客户'}<strong>{number(p?.metrics.purchasingCustomers)} <small>人</small></strong></span><span>A3 → A4 转化率<strong>{percent(p?.metrics.conversionRate)}</strong><small>前期 {percent(p?.metrics.previousConversionRate)}</small></span></button>
    {p&&<small className="neo-home-period">{p.period.start} 至 {p.period.end} · 按客户去重</small>}
   </div><LineChart title="4A 经营脉搏" note="客户按周去重 · 前四周平均为 100" labels={p?.labels??[]} series={series} min={Math.min(60,...bounds)} max={Math.max(160,...bounds)} reference={100} anomaly={false} compact showValueToggle={false} format={n=>`${Math.round(n)}`} onPoint={(_s,index)=>open(p?.weeks[index]?.evidenceId)}/>
   <a href={href(`/demo?page=people${p?.review?`&reviewRunId=${p.review.runId}`:''}`)} className="neo-inline-link">进入人的分析<NeoIcon name="arrow" size={18}/></a>
  </section>
  <section className="neo-card neo-teaser" aria-label="货 · 供应链与库存">
   <div className="neo-teaser-copy"><Title topic="货" title="供应链与库存" icon="cube"/><h3><BusinessText text={g?.review?.title??'正在核查库存与供给'}/></h3><p><BusinessText text={g?.review?.summary??'按当前库存、在途和备货规则核查，等待供需纠察智能体完成判断。'}/></p>
    <button type="button" className="neo-summary-stat" disabled={!g?.evidenceId} onClick={()=>open(g?.evidenceId)}><span>{g?.display?.metricLabel??'当前可售'}<strong>{number(g?.metrics.sellableUnits)} <small>{g?.display?.unit??'件'}</small></strong></span><span>{g?.display?.secondaryLabel??'在途'}<strong>{number(g?.display?g.display.secondaryValue:g?.metrics.inTransitUnits)} <small>{g?.display?.unit??'件'}</small></strong></span></button>
    <small className="neo-home-period">库存截至 {g?.asOf??'—'} · {g?.note}</small>
   </div><LineChart title={g?.display?.title??'三类货盘 · 供给脉搏'} labels={g?.labels??[]} series={g?.series??[]} min={0} max={g?.display?.max??100} format={n=>g?.display?`${number(n)} ${g.display.unit}`:`${n.toFixed(1)}%`} compact showValueToggle={false} anomaly={false} onPoint={(_s,index)=>open(g?.weeks[index]?.evidenceId)}/>
   <a href={href(`/demo?page=goods${g?.review?`&reviewRunId=${g.review.runId}`:''}`)} className="neo-inline-link">进入货的分析<NeoIcon name="arrow" size={18}/></a>
  </section>
  <section className="neo-card neo-teaser" aria-label="场 · 渠道与竞品">
   <div className="neo-teaser-copy"><Title topic="场" title="渠道与竞品" icon="chart"/><h3><BusinessText text={m?.judgment?.title??(m?.run&&['failed','cancelled'].includes(m.run.status)?'市场分析尚未完成':'正在分析渠道与竞品')}/></h3><p><BusinessText text={m?.judgment?.summary??'经营数字已计算，由市场智能体筛选行业原文并分析渠道变化。'}/></p>{m&&<small className="neo-home-period">{m.periods.current.start} 至 {m.periods.current.end} · {m.periods.previous?'对照前四周':'前期对照不足'}</small>}</div>
   {m?.roles.length?<div className="neo-mini-matrix" style={{gridTemplateColumns:`minmax(80px,.5fr) repeat(${m.roles.length},minmax(110px,1fr))`}}><span/>{m.roles.map(r=><b key={r.id}>{r.name}</b>)}{m.channels.map(c=><div className="neo-mini-matrix-row" key={c.channel}><b>{c.name}</b>{m.roles.map(r=>{const cell=m.cells.find(x=>x.channel===c.channel&&x.role===r.id);return <button type="button" key={r.id} className={cell?.status==='needs_check'?'matrix-alert':''} disabled={!cell?.evidenceId} onClick={()=>open(cell?.evidenceId)}><b><BusinessText text={cell?.headline??'资料不足'}/></b><span>订单 <strong>{cell?.metrics[0]?.value??'—'}</strong> 笔 <small>{cell?.metrics[0]?.change}</small></span><span>净成交 <strong>{cell?.metrics[1]?.change??'—'}</strong></span></button>;})}</div>)}</div>:<div className="neo-home-empty">商品角色资料不足，补齐后自动计算。</div>}
   <a href={href(`/demo?page=market${m?.run?`&reviewRunId=${m.run.id}`:''}`)} className="neo-inline-link">进入场的分析<NeoIcon name="arrow" size={18}/></a>
  </section>
 </div>;
}
export function LiveHomeSections(){
 const w=useOperating(),s=w?.snapshot,{data,error}=useHomeSections(),[reference,setReference]=useState<PulseReference|null>(null),focus=useRef<HTMLElement|null>(null);
 const open=(id?:string|null)=>{if(!id||!s)return;focus.current=document.activeElement as HTMLElement;setReference({id,snapshotId:s.id,businessId:s.businessId,nature:s.dataNature});};
 const close=()=>{setReference(null);requestAnimationFrame(()=>focus.current?.focus());};
 const href=(path:string)=>{if(!s||s.operating)return w?.href(path)??path;const url=new URL(path,'http://neo.local');for(const [k,v] of Object.entries({businessId:s.businessId,dataNature:s.dataNature,snapshotId:s.id}))url.searchParams.set(k,v);return url.pathname+url.search;};
 return <>{error&&<p role="alert" className="neo-local-note">首页板块暂未更新：{error}</p>}<HomeSectionsContent data={data} href={href} open={open}/>{reference&&reference.snapshotId===s?.id&&(reference.id.includes(':view:customer-pulse:')?<CustomerPulseDrawer reference={reference} onClose={close}/>:<OperatingEvidenceDrawer reference={reference} onClose={close}/>)}</>;
}
export function SupplyPageHeading(){
 const w=useOperating(),s=w?.snapshot,scope=s?`${s.businessId}/${s.dataNature}/${s.id}`:'',
  [stored,setStored]=useState<{scope:string;data:SupplyOverview|null;error:string}>({scope:'',data:null,error:''});
 useEffect(()=>{
  if(!s)return;let disposed=false,fetching=false;let timer:ReturnType<typeof setTimeout>|undefined;
  const q=new URLSearchParams({businessId:s.businessId,dataNature:s.dataNature,snapshotId:s.id});
  const load=async()=>{if(disposed||fetching)return;fetching=true;if(timer)clearTimeout(timer);
   try{let data=await api<SupplyOverview&{canGenerate:boolean}>(`/api/v1/supply-overview?${q}`);if(disposed)return;
    if(!data.review&&data.canGenerate&&await automaticAnalysisAllowed(q)){const reviews=await api<{reviews:{supply?:AgentRun}}>(`/api/v1/growth-reviews?${q}&mode=supply`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotId:s.id,dataNature:s.dataNature})});if(disposed)return;if(runNeedsRefresh(reviews.reviews.supply))await api(`/api/v1/agent-runs/${reviews.reviews.supply!.id}?${q}`);if(disposed)return;data=await api(`/api/v1/supply-overview?${q}`);}
    if(disposed)return;if(data.snapshotId!==s.id||data.businessId!==s.businessId||data.dataNature!==s.dataNature)throw Error('供应链摘要与当前资料版本不一致');
    setStored({scope,data,error:''});timer=setTimeout(()=>void load(),!data.review?3000:30000);
   }catch(e){if(!disposed){setStored({scope,data:null,error:(e as Error).message});timer=setTimeout(()=>void load(),30000);}}finally{fetching=false;}
  };void load();window.addEventListener('neo:results',load);return()=>{disposed=true;if(timer)clearTimeout(timer);window.removeEventListener('neo:results',load);};
 },[s,scope]);
 const data=stored.scope===scope?stored.data:null;
 return <div className="neo-page-heading"><h1><BusinessText text={data?.review?.title??(s?.operating?'供给判断尚未生成':'正在核查库存与供给')}/></h1><p><BusinessText text={data?.review?.summary??'根据当前库存、在途到货与已保存备货规则，汇总供应链与库存判断。'}/></p>{stored.scope===scope&&stored.error&&<small role="alert">供应链摘要暂未更新：{stored.error}</small>}</div>;
}

// Industry supply is rendered inside the existing goods page and agent column.
export function SupplyOperatingContent({onEvidence}:{onEvidence:(id:string)=>void}){
 const w=useOperating(),s=w?.snapshot,{data}=useHomeSections(),g=data?.goods;
 const [capacity,setCapacity]=useState<Array<{id:string;entityId:string;businessDate:string;quantity:number}>>([]);
 useEffect(()=>{if(!s?.operating)return;let active=true;const q=new URLSearchParams({businessId:s.businessId,dataNature:s.dataNature,snapshotId:s.id});void api<{capacity:typeof capacity}>(`/api/v1/supply-overview?${q}`).then(d=>{if(active)setCapacity(d.capacity);}).catch(()=>{if(active)setCapacity([]);});return()=>{active=false;};},[s]);
 if(!s?.operating)return null;const hotel=s.operating.industry==='hotel',unit=s.operating.unit;
 const metric=(r:Fact,key:keyof Fact)=>r[key]==null?'—':number(r[key] as number);
 return <div className="neo-columns"><div className="neo-primary-column">
 <section className="neo-card"><div className="neo-live-heading"><h2>{hotel?'房型与日期供给':'关键商品 · 仓库供给'}</h2><button type="button" className="neo-text-button" onClick={()=>onEvidence(`${s.id}:view:supply`)}>查看供给依据 →</button></div>
 <table><thead><tr><th>{hotel?'房型':'商品规格'}</th><th>{hotel?'日期':'仓库'}</th><th>{hotel?'已登记能力（房晚）':'可售（件）'}</th>{!hotel&&<th>库存成本</th>}</tr></thead><tbody>{hotel?capacity.map(r=><tr key={r.id}><td>{r.entityId}</td><td>{r.businessDate}</td><td>{number(r.quantity)}</td></tr>):s.data.inventory.map(r=><tr key={r.factId}><td><button type="button" className="neo-text-button" onClick={()=>onEvidence(r.evidenceId)}>{r.sku_id}</button></td><td>{r.warehouse_id}</td><td>{metric(r,'sellable_units')}</td><td>{r.inventory_cost_cents==null?'—':`¥${number(r.inventory_cost_cents/100)}`}</td></tr>)}</tbody></table>
 {hotel&&!capacity.length&&<p>预测期房晚能力尚未接入，不能按零房晚计算。</p>}<p className="neo-local-note">{g?.note}</p></section>
 <LineChart title={g?.display?.title??'供给脉搏'} labels={g?.labels??[]} series={g?.series??[]} min={0} max={g?.display?.max??100} format={n=>`${number(n)} ${unit}`} showValueToggle={false} onPoint={(_row,i)=>g?.weeks[i]&&onEvidence(g.weeks[i].evidenceId)}/>
 <section className="neo-card"><h2>供给条件与经营约束</h2><p>{s.operating.industry==='manufacturing'?'生产同时约束物料、工作中心产能、交期与现金；计划不作为已完工库存。':hotel?'房晚按日计算，已预订量占用当日能力，空余不能结转。':'仓库实际可售与渠道履约规则共同限制可承接订单。'}</p><button type="button" className="neo-text-button" onClick={()=>onEvidence(`${s.id}:view:forecast`)}>查看约束预测依据 →</button><a className="neo-inline-link" href={w!.href('/demo?page=overview&view=forecast')}>比较供给方案 →</a></section>
 </div><LiveAgentPanel mode="supply" onEvidence={onEvidence}/></div>;
}
