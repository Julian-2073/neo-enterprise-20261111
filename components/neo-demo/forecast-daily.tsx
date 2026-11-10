'use client';
import {useEffect,useState} from 'react';
import {Area,CartesianGrid,ComposedChart,Line,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {api} from '../business/use-workspace';
type Point={date:string;value:number;lower:number|null;upper:number|null};
type Detail={jobId:string;entityId:string;channelId:string;points:Point[];nominalCoverage:number;stale:boolean};
export function ForecastDaily({businessId,nature,jobId,series}:{businessId:string;nature:string;jobId:string;series:Array<{entityId:string;channelId:string}>}){
 const [selection,setSelection]=useState(''),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState('');
 const leaf=series.find(s=>JSON.stringify([s.entityId,s.channelId])===selection)??series[0],entity=leaf?.entityId,channel=leaf?.channelId;
 useEffect(()=>{if(!entity||!channel)return;let active=true;const q=new URLSearchParams({businessId,dataNature:nature,entityId:entity,channelId:channel});void api<Detail>(`/api/v1/business-forecast-jobs/${jobId}/points?${q}`).then(v=>{if(active){setDetail(v);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[businessId,nature,jobId,entity,channel]);
 const current=detail?.jobId===jobId&&detail.entityId===entity&&detail.channelId===channel?detail:null;
 const rows=current?.points.map(p=>({...p,band:p.lower!==null&&p.upper!==null?[p.lower,p.upper]:null}));
 return <details className="neo-enterprise-daily"><summary>查看SKU每日预测与区间</summary><label className="neo-live-field">商品与渠道<select value={JSON.stringify([entity,channel])} onChange={e=>setSelection(e.target.value)}>{series.map(s=><option key={JSON.stringify([s.entityId,s.channelId])} value={JSON.stringify([s.entityId,s.channelId])}>{s.entityId} · {s.channelId}</option>)}</select></label>
 <p>蓝线为预计支付件数均值，色带为该SKU每日名义{Math.round((current?.nominalCoverage??.8)*100)}%区间；不能累加成整店或整期概率区间。没有校准时只显示点值。</p>
 {current?.stale&&<p>旧资料结果，仅供回看。</p>}{error&&<p role="status">{error}</p>}
 {rows?<><div className="neo-enterprise-daily-chart" role="img" aria-label={`${entity} ${channel} 每日支付销量与叶子区间`}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{top:10,right:14,bottom:4,left:0}}><CartesianGrid stroke="#e5edf7" strokeDasharray="3 3"/><XAxis dataKey="date" tickFormatter={v=>String(v).slice(5)} minTickGap={22}/><YAxis width={42} domain={[0,'auto']}/><Tooltip/><Area type="linear" dataKey="band" name="每日叶子区间" stroke="none" fill="#008bff" fillOpacity={.14} isAnimationActive={false}/><Line type="linear" dataKey="value" name="支付件数均值" stroke="#007aff" dot={false} strokeWidth={2} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div><details><summary>回读逐日数值</summary><table className="neo-table"><thead><tr><th>日期</th><th>均值点值</th><th>区间下界</th><th>区间上界</th></tr></thead><tbody>{rows.map(p=><tr key={p.date}><td>{p.date}</td><td>{p.value.toFixed(1)}</td><td>{p.lower?.toFixed(1)??'未知'}</td><td>{p.upper?.toFixed(1)??'未知'}</td></tr>)}</tbody></table></details></>:<p>读取已保存明细中。</p>}
 </details>;
}
