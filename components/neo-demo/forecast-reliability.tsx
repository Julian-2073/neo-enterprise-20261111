'use client';
import {useEffect,useRef,useState} from 'react';
import type {SalesForecast} from '../../lib/business-forecast';
import type {ForecastResult} from '../../server/agent-contracts';
import {backtestNote} from './forecast-presentation';
import {api} from '../business/use-workspace';

const percent=(n:number|null|undefined)=>n==null?'不可计算':`${(n*100).toFixed(1)}%`;
const names={four_week_mean:'四周均值',last_week:'上周重复',weekday_mean_4:'四周同星期均值'};
export function ForecastReliability({forecast,value,historical=false,onEvaluate}:{forecast:SalesForecast|null|undefined;value:ForecastResult|null;historical?:boolean;onEvaluate?:()=>void}){
 const [opened,setOpened]=useState(false),dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(opened)dialog.current?.showModal();else dialog.current?.close();},[opened]);
 const e=forecast?.evaluation,score=e?.metrics[forecast!.method],demo=value?.dataNature==='demo';
 const title=historical?'正在查看旧资料版本':forecast?.status==='insufficient'?'销量资料待补齐':e?.status==='no_paid_series'?'历史时点不可验证':e?.folds.length?demo?'模拟资料已做历史检验':'已完成部分历史检验':'尚未完成历史检验';
 const close=()=>{setOpened(false);opener.current?.focus();};
 return <section className="neo-forecast-reliability" aria-label="预测可靠程度">
  <div className="neo-reliability-heading"><div><small>预测可靠程度</small><h3>{title}</h3></div><button type="button" ref={opener} className="neo-text-button" onClick={()=>setOpened(true)}>查看检验与资料</button></div>
  <div className="neo-reliability-facts"><span>有效窗口 <b>{e?.folds.length??'—'}</b></span><span>销量误差 WAPE <b>{percent(score?.wape)}</b></span><span>预测偏差 <b>{percent(score?.bias)}</b></span><span>区间 <b>尚未校准</b></span></div>
  {forecast&&<p>资料起点 {forecast.forecastOrigin} · 实际生成 {forecast.issuedAt.slice(0,16).replace('T',' ')}（UTC） · {forecast.runNature==='forward'?'发布后的预测':'按历史资料重建，不能当作当时已发布的预测'}</p>}
  <p>{forecast?e?.status==='no_paid_series'?'历史资料是在预测起点之后录入，不能证明当时可做出同样预测。':forecast.status==='insufficient'?forecast.audit.gaps.join('；'):'当前采用预先确定的基线。历史对照不能替代真实发布后的验证，也不证明方案收益。':value?backtestNote(value):'从保存的资料生成基线后查看；资料不足保持未知。'}</p>
  {forecast?.status==='ready'&&<p>口径：已支付件数，退款另计金额影响。历史缺货与上架状态未识别，结果不能解释为全部潜在需求。</p>}
  <dialog className="neo-forecast-dialog" ref={dialog} onCancel={e=>{e.preventDefault();close();}} aria-labelledby="neo-forecast-test-title">
   <div className="neo-live-heading"><h2 id="neo-forecast-test-title">预测检验与资料</h2><button type="button" className="neo-button" onClick={close}>关闭</button></div>
   {forecast?<><dl className="neo-draft-details"><dt>预测目标</dt><dd>SKU×渠道已支付件数；点值为均值</dd><dt>预测期限</dt><dd>{forecast.horizonDays} 天 · 起点 {forecast.forecastOrigin}</dd><dt>使用资料</dt><dd>{forecast.trainingStart} 至 {forecast.trainingEnd}；得知截止 {forecast.dataCutoff}</dd><dt>实际生成</dt><dd>{forecast.issuedAt}</dd><dt>可用范围</dt><dd>{forecast.audit.series} 条序列；{forecast.unestimatedEntityIds.length} 个商品含未估计范围</dd><dt>标签截止</dt><dd>{e?.labelKnownAt}</dd></dl>
   <h3>相同窗口的基线对照</h3><div className="neo-forecast-table-wrap"><table className="neo-table"><thead><tr><th>方法</th><th>叶子样本</th><th>WAPE</th><th>偏差</th><th>MAE（件）</th></tr></thead><tbody>{Object.entries(e!.metrics).map(([method,m])=><tr key={method}><td>{names[method as keyof typeof names]}</td><td>{m.cells}</td><td>{percent(m.wape)}</td><td>{percent(m.bias)}</td><td>{m.mae?.toFixed(2)??'不可计算'}</td></tr>)}</tbody></table></div>
   <p>{e?.promotion.reason}</p><p>{e?.interval.reason}</p>
   <details><summary>各窗口与跳过原因</summary>{e?.folds.map(f=><p key={f.trainEnd}>{f.start}–{f.end} · 四周均值误差 {percent(f.metrics.four_week_mean.wape)} · 新序列单元 {f.coldStartCells} · 短历史未估计单元 {f.unestimatedCells??0}</p>)}{e?.skipped.map(f=><p key={f.trainEnd}>{f.trainEnd} · {f.reason}</p>)}{!e?.folds.length&&!e?.skipped.length&&<p>可见历史尚不足以形成完整训练与测试窗。</p>}</details>
   <details><summary>资料缺口与解释边界</summary>{[...forecast.audit.gaps,...forecast.limitations].map((text,i)=><p key={i}>{text}</p>)}</details>
   {onEvaluate&&<button type="button" className="neo-button" onClick={()=>{close();onEvaluate();}}>对照后续实际资料</button>}
   </>:<p>{value?backtestNote(value):'当前尚无已保存的预测检验记录。'}</p>}
  </dialog>
 </section>;
}

export function ForecastSkuTable({forecast}:{forecast:SalesForecast}){
 const [channel,setChannel]=useState(''),channels=[...new Set(forecast.series.map(s=>s.channelId))];
 const rows=forecast.series.filter(s=>!channel||s.channelId===channel);
 return <section className="neo-forecast-skus" aria-label="SKU与渠道预测"><div className="neo-live-heading"><h3>基线 · SKU×渠道销量信号</h3><label>渠道 <select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">全部已显示渠道</option>{channels.map(c=><option key={c}>{c}</option>)}</select></label></div><div className="neo-forecast-table-wrap"><table className="neo-table"><thead><tr><th>商品规格</th><th>渠道</th><th>未来{forecast.horizonDays}天支付件数</th><th>状态</th></tr></thead><tbody>{rows.slice(0,30).map(r=><tr key={JSON.stringify([r.entityId,r.channelId])}><td>{r.entityId}</td><td>{r.channelId}</td><td>{r.status==='estimated'?r.units.toLocaleString('zh-CN',{maximumFractionDigits:1}):'未知'}</td><td>{r.status==='estimated'?'基线估计':'历史不足'}</td></tr>)}</tbody></table></div><p className="neo-local-note">显示 {Math.min(rows.length,30)} 条；资料摘要最多提供100条，共 {forecast.audit.series} 条已知序列。筛选不改变预测总量。未估计商品：{forecast.unestimatedEntityIds.join('、')||'无'}。销量信号尚未施加未来供货约束。</p></section>;
}

type SavedEvaluation={id:string;createdAt:string;evaluation:{status:string;domain?:string;start:string;end:string;metrics:{wape:number|null;bias:number|null;cells:number}|null;reason:string}};
export function ForecastActuals({generationId,businessId,nature,canWrite}:{generationId:string;businessId:string;nature:string;canWrite:boolean}){
 const [results,setResults]=useState<SavedEvaluation[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const query=new URLSearchParams({businessId,dataNature:nature,generationId}).toString();
 useEffect(()=>{let active=true;void api<{evaluations:SavedEvaluation[]}>(`/api/v1/business-forecast-evaluations?${query}`).then(r=>{if(active)setResults(r.evaluations);}).catch(e=>{if(active)setMessage(e.message);});return()=>{active=false;};},[query]);
 const evaluate=async()=>{setBusy(true);try{const latest=await api<{generations:Array<{id:string}>}>(`/api/v1/business-generations?${query}`),actualGenerationId=latest.generations[0]?.id;if(!actualGenerationId)throw Error('尚无后续实际资料');const result=await api<SavedEvaluation>(`/api/v1/business-forecast-evaluations?${query}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataNature:nature,generationId,actualGenerationId})});setResults(v=>[result,...v.filter(x=>x.id!==result.id)]);setMessage(result.evaluation.reason);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 return <details className="neo-overview-basis"><summary>原基线与后续实际</summary><p>只对照已保存的原基线，不将方案假设当作模型预测，也不覆盖历史结果。</p>{results.map(r=><p key={r.id}>{r.evaluation.start}–{r.evaluation.end} · {r.evaluation.status==='evaluated'?r.evaluation.domain==='forward'?'发布后的销量检验':'回顾性销量对照':'等待成熟实际资料'} · WAPE {percent(r.evaluation.metrics?.wape)} · 偏差 {percent(r.evaluation.metrics?.bias)}</p>)}<button type="button" className="neo-button" disabled={busy||!canWrite} onClick={()=>void evaluate()}>{busy?'正在对照…':'用最新资料对照原基线'}</button>{message&&<p role="status">{message}</p>}</details>;
}
