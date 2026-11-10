"use client";
import {useEffect,useRef,useState} from "react";
import type {Evidence} from "../../lib/neo-demo";
import {api} from "../business/use-workspace";
import {useFrozenDomain} from "./operating-context";
import {channelName,productName,investigationError,businessText,evidenceLimitations} from "../../lib/business-presentation";
import {savedEvidenceSummary,evidenceSourceText,savedEvidenceNote} from '../../lib/evidence-presentation';
import {displayMoney,displayNumber} from "../../lib/operating-demo-data";
type Reference={id:string;snapshotId:string;businessId:string;nature:string};
type ResponseData={evidence:{id:string;snapshotId:string;businessId:string;title:string;formula:string;value:unknown;unit:string;sourceCount:number;periodStart:string;periodEnd:string;asOf:string;limitations:string[];scopeLabel?:string};arrivals?:Array<{id:string;skuId:string;warehouseId:string;date:string;units:number}>;records:{id:string;row_number:number;payload:string;batch_id:string;source_name:string;filename:string}[];nextCursor:number|null};
function valueText(value:unknown,unit:string,products:Array<{id:string;name:string}>=[],channels:Array<{id:string;name:string}>=[]):string {
 if(value==null)return "待补数据";
 if(typeof value==='number')return unit==='人民币分'?displayMoney(value/100):`${displayNumber(value)} ${unit}`;
 if(typeof value==='object')return Object.entries(value).map(([key,v])=>`${({paidOrders:'支付订单（笔）',events:'行为（次）',netRevenueCents:'净成交额',spendCents:'投放费用',variableCostCents:'变动成本',contributionMarginCents:'贡献毛利',sellable_units:'可售（件）',in_transit_units:'在途（件）',inventory_cost_cents:'库存成本',safety_units:'已设定备货目标（件）',product_id:'商品',sku_id:'商品规格',warehouse_id:'仓库',business_date:'业务日期',occurred_at:'记录时间',channel:'渠道',quantity:'数量',order_id:'订单编号',entry_type:'支付或退款',amount_cents:'金额',variable_cost_cents:'变动成本',event_type:'行为类型',source_record_id:'来源记录编号',order_line_id:'订单商品行编号',contact_id:'客户身份编号'} as Record<string,string>)[key]||key}：${key==='channel'?(v==null?'各渠道共享 / 不适用':channelName(String(v),channels)):key==='product_id'?productName(String(v),products):key==='entry_type'?({paid:'支付',refund:'退款'}[String(v)]||String(v)):valueText(v,key.endsWith('Cents')||key.endsWith('_cents')?'人民币分':'',products,channels)}`).join('；');
 return String(value);
}
export function EvidenceDrawer({evidence,backend,onClose}:{evidence:Evidence|null;backend?:Reference|null;onClose:()=>void}) {
 const domain=useFrozenDomain(),products=domain?.products??[],channels=domain?.channels??[];
 const dialog=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 const [result,setResult]=useState<{key:string;data:ResponseData}|null>(null),[error,setError]=useState<{key:string;message:string}|null>(null),[loading,setLoading]=useState(false);
 const key=backend?`${backend.businessId}/${backend.nature}/${backend.snapshotId}/${backend.id}`:'';
 const reference=useRef(backend);
 useEffect(()=>{reference.current=backend;},[backend]);
 const data=result?.key===key?result.data:null;
 const message=error?.key===key?error.message:'';
 const params=(ref:Reference)=>new URLSearchParams({businessId:ref.businessId,dataNature:ref.nature,snapshotId:ref.snapshotId});
 useEffect(()=>{
  const ref=reference.current;if(!ref)return;
  const controller=new AbortController();
  api<ResponseData>(`/api/v1/evidence/${encodeURIComponent(ref.id)}?${params(ref)}`,{signal:controller.signal}).then(d=>{
   if(d.evidence.snapshotId!==ref.snapshotId||d.evidence.businessId!==ref.businessId)throw new Error('证据与当前快照不一致');
   if(!controller.signal.aborted)setResult({key,data:d});
  }).catch(e=>{if(!controller.signal.aborted)setError({key,message:e.message});});
  return()=>controller.abort();
 },[key]);
 async function more(){
  if(!backend||!data||data.nextCursor==null||loading)return;
  const selectedKey=key;setLoading(true);
  try{const next=await api<ResponseData>(`/api/v1/evidence/${encodeURIComponent(backend.id)}?${params(backend)}&cursor=${data.nextCursor}`);if(reference.current?.id!==backend.id||reference.current?.snapshotId!==backend.snapshotId)return;setResult({key:selectedKey,data:{...next,records:[...data.records,...next.records]}});}catch(e){setError({key:selectedKey,message:(e as Error).message});}finally{setLoading(false);}
 }
 const opened=!!evidence||!!backend;
 useEffect(()=>{
  if(!opened)return;closeButton.current?.focus();
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){onClose();return;}if(event.key!=='Tab'||!dialog.current)return;const controls=dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
 },[opened,onClose]);
 if(!opened)return null;
 const shown:Evidence=backend?{id:backend.id,kind:backend.nature==='demo'?'已保存验收样例':'业务导入 · 待核实',title:data?.evidence.title|| (message?'证据缺失或读取失败':'正在读取来源'),value:data?(savedEvidenceSummary(data.evidence.id,data.evidence.value)||valueText(data.evidence.value,data.evidence.unit,products,channels)):investigationError(message)||'加载中',scope:data?data.evidence.scopeLabel||`${data.evidence.periodStart} 至 ${data.evidence.periodEnd}`:'正在核对查看范围',source:data?`已提交导入记录 · ${data.evidence.sourceCount} 条`:'服务端证据',date:data?.evidence.asOf||'',note:data?(savedEvidenceNote(data.evidence.id,data.evidence.value)||[businessText(data.evidence.formula),...evidenceLimitations(data.evidence.id,data.evidence.limitations)].join('；')):message||'正在读取当前指标的来源'}:evidence!;
 return <div className="neo-drawer-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><aside ref={dialog} className="neo-drawer" role="dialog" aria-modal="true" aria-labelledby="evidence-title"><button ref={closeButton} className="neo-drawer-close" onClick={onClose} aria-label="关闭证据详情">×</button><span className="neo-overline">证据详情 · {shown.kind}</span><h2 id="evidence-title">{shown.title}</h2><div className="neo-evidence-value">{shown.value}</div><dl className="neo-definition"><dt>统计范围</dt><dd>{shown.scope}</dd><dt>来源</dt><dd>{shown.source}{backend&&data?.records.map(r=><p key={r.id}>{r.source_name} · {r.filename} · 第 {r.row_number} 条 CSV 记录<br/>{evidenceSourceText(JSON.parse(r.payload),products,channels)}<details><summary>查看本条来源的原始字段与关联编号</summary><pre>{r.payload}</pre></details><a href={`/api/v1/ingestion-batches/${r.batch_id}/file?${params(backend)}`}>下载原文件</a></p>)}{data?.nextCursor!=null&&<button type="button" disabled={loading} onClick={()=>void more()}>加载更多来源</button>}</dd><dt>数据时间</dt><dd>{shown.date}</dd>{data?.arrivals?.length?<><dt>到货计划</dt><dd>{data.arrivals.map(a=><p key={a.id}>{a.skuId} · {a.warehouseId} · {a.date} 到货 {a.units} 件；到货前不计为可售。</p>)}</dd></>:null}{backend&&<><dt>资料版本</dt><dd><details><summary>查看追溯编号</summary>{backend.snapshotId}<br/>{backend.id}</details></dd></>}<dt>说明</dt><dd>{shown.note}{backend&&data&&<details><summary>原始计算说明与全部范围限制</summary><p>{data.evidence.formula}</p><pre>{JSON.stringify(data.evidence.value,null,2)}</pre><ul>{data.evidence.limitations.map((note,i)=><li key={i}>{note}</li>)}</ul></details>}</dd></dl><p className="neo-disclosure">{backend?'来源是已保存的导入记录；覆盖范围与业务真实性需另行核实。CSV 行号按逻辑记录计数。':'模拟证据只用于演示交互，不代表已连接平台或已核实的客户事实。'}</p></aside></div>;
}
