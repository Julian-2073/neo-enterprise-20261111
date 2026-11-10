"use client";

import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChartSeries = { id: string; name: string; color: string; values: (number|null)[]; actualValues?: (number|null)[]; actualFormat?: (value: number) => string };
type ChartProps = {
  title: string; note?: string; labels: string[]; series: ChartSeries[]; min?: number; max?: number;
  anomaly?: boolean; forecastStart?: number; forecastOrigin?:string; band?: { lower: number[]; upper: number[] };
  format?: (value: number) => string; onPoint?: (series: ChartSeries, index: number) => void;
  showValueToggle?: boolean; toggleLabels?: { relative: string; actual: string };
  compact?: boolean; height?: number; reference?: number; hideXAxis?: boolean; valueLabels?: boolean;
};

export function LineChart({ title, note, labels, series, min = 60, max = 160, anomaly = false, forecastStart, forecastOrigin, band, format = v => `${Math.round(v)}`, onPoint, showValueToggle = true, toggleLabels = { relative: "相对走势", actual: "实际人数" }, compact = false, height, reference, hideXAxis = false, valueLabels = false }: ChartProps) {
  const [showValues, setShowValues] = useState(false);
  const hasValues=series.some(s=>s.values.some(v=>v!=null&&Number.isFinite(v)));
  const data = labels.map((label, index) => {
    const item: Record<string, unknown> = { label, index };
    series.forEach(s => {
      item[s.id] = s.values[index];
      if (forecastStart !== undefined) {
        item[`${s.id}-history`] = index < forecastStart ? s.values[index] : null;
        item[`${s.id}-forecast`] = index >= forecastStart - 1 ? s.values[index] : null;
      }
    });
    if (forecastStart !== undefined && band && index >= forecastStart) item.band = [band.lower[index - forecastStart], band.upper[index - forecastStart]];
    return item;
  });
  const ticks = Array.from({ length: 6 }, (_, i) => min + (max - min) * i / 5).map(v => Math.round(v));
  const axisTicks = max === 80 && min === 0 ? [0, 20, 40, 60, 80] : max === 100 && min === 60 ? [60, 80, 100] : ticks;
  const chartHeight = height ?? (compact ? 152 : 300);
  const tooltipContent = ({ active, payload }: { active?: boolean; payload?: readonly { payload?: Record<string, unknown> }[] }) => {
    if (!active || !payload?.length) return null;
    const index = Number(payload[0].payload?.index);
    return <div className="neo-chart-tooltip"><b>{labels[index]}</b>{series.map(s => <div key={s.id} style={{ color: s.color }}>{s.name}：{s.values[index] == null ? "待补数据" : s.actualValues?.[index] != null ? `${s.actualFormat?.(s.actualValues[index])??`${s.actualValues[index].toLocaleString("zh-CN")} 人`} · 指数 ${Math.round(s.values[index])}` : format(s.values[index])}</div>)}{onPoint && <button type="button" onClick={() => onPoint(series[0], index)}>查看证据</button>}</div>;
  };
  return <section className={`neo-chart ${compact ? "is-compact" : ""} ${hideXAxis ? "no-x-axis" : ""}`} aria-label={title}>
    <div className="neo-chart-heading"><div><h3>{title}</h3>{note && <p>{note}</p>}</div><div className="neo-chart-controls"><div className="neo-chart-legend">{series.map(s => <span key={s.id}><i style={{ background: s.color }}/>{s.name}</span>)}</div>{showValueToggle && <div className="neo-chart-toggle"><button type="button" aria-pressed={!showValues} className={!showValues ? "active" : ""} onClick={() => setShowValues(false)}>{toggleLabels.relative}</button><button type="button" aria-pressed={showValues} className={showValues ? "active" : ""} onClick={() => setShowValues(true)}>{toggleLabels.actual}</button></div>}</div></div>
    {!hasValues?<div className="neo-chart-empty" role="status"><strong>当前资料不足，暂不能画出走势</strong><p>{note||"补齐同一范围的历史资料后再核查；缺项不等于零。"}</p></div>:showValues ? <div className="neo-actual-charts">{series.map(s => {
      const values = s.actualValues ?? s.values;
      const actualData = labels.map((label, index) => ({ label, index, value: values[index] }));
      return <div key={s.id} className="neo-actual-row"><span style={{ color: s.color }}>{s.name}</span><ResponsiveContainer width="100%" height={100}><ComposedChart data={actualData} margin={{ top: 12, right: 18, bottom: 0, left: 0 }} accessibilityLayer onClick={event=>{const index=Number(event?.activeTooltipIndex);if(Number.isInteger(index)&&index>=0&&index<labels.length)onPoint?.(s,index);}}><CartesianGrid vertical={false} stroke="#edf3ff"/><XAxis dataKey="index" type="number" domain={[-.5, labels.length - .5]} ticks={labels.map((_, i) => i)} tickFormatter={i => labels[i]} tick={{ fill: "#6078b2", fontSize: 12 }} axisLine={false} tickLine={false}/><YAxis width={42} tick={{ fill: "#6078b2", fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip formatter={v => (s.actualFormat ?? format)(Number(v))} labelFormatter={i => labels[Number(i)]}/><Line dataKey="value" name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 3, fill: s.color, strokeWidth: 0 }} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div>;
    })}</div> : <div className="neo-chart-canvas" style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 22, right: 22, bottom: 4, left: 0 }} accessibilityLayer onClick={event => {
        const index = Number(event?.activeTooltipIndex);
        if (Number.isInteger(index) && index >= 0 && index < labels.length) onPoint?.(series[0], index);
      }}>
        <CartesianGrid vertical stroke="#e9f0ff" strokeDasharray="3 3"/>
        <XAxis dataKey="index" type="number" domain={[-.5, labels.length - .5]} ticks={labels.map((_, i) => i)} tickFormatter={i => forecastStart !== undefined ? labels[i]?.split("–")[0] : labels[i]} tick={{ fill: "#6078b2", fontSize: compact ? 11 : 12 }} axisLine={{ stroke: "#d3dff7" }} tickLine={false} hide={hideXAxis} height={32} interval="preserveStartEnd" minTickGap={8}/>
        <YAxis domain={[min, max]} ticks={axisTicks} tickFormatter={v => format(1).endsWith("%") ? `${v}%` : `${v}`} tick={{ fill: "#6078b2", fontSize: 12 }} width={40} axisLine={{ stroke: "#d3dff7" }} tickLine={false}/>
        {anomaly && <ReferenceArea x1={5.5} x2={7.5} fill="#fff0f4" fillOpacity={1} ifOverflow="extendDomain" label={{ value: "连续两周 · 待核查", position: "insideTopRight", fill: "#ee4267", fontSize: 12 }}/>} 
        {reference !== undefined && <ReferenceLine y={reference} stroke="#a9c4fb" strokeDasharray="5 4"/>}
        {forecastStart !== undefined && <ReferenceArea x1={forecastStart - .45} x2={labels.length - 1} fill="#f3f8ff" fillOpacity={1}/>}
        {forecastStart !== undefined && <ReferenceLine x={forecastStart - .45} stroke="#5a9cff" strokeDasharray="5 4" label={{ value: `预测起点 ${forecastOrigin||"09.24"}`, fill: "#006bff", fontSize: 12, position: "insideTopLeft" }}/>} 
        {band && <Area dataKey="band" fill="#d8eaff" stroke="none" fillOpacity={.8} isAnimationActive={false} tooltipType="none"/>}
        <Tooltip content={tooltipContent}/>
        {series.map(s => forecastStart === undefined ? <Line key={s.id} dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: compact ? 3 : 4, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 6 }} isAnimationActive={false}/> : <Line key={`${s.id}-history`} dataKey={`${s.id}-history`} name={s.name} stroke={s.color} strokeWidth={2.2} dot={{ r: 4, fill: s.color, strokeWidth: 0 }} isAnimationActive={false} label={valueLabels ? { position: "top", fill: s.color, fontSize: 12 } : false}/>)}
        {forecastStart !== undefined && series.map(s => <Line key={`${s.id}-forecast`} dataKey={`${s.id}-forecast`} name="预测中值" stroke={s.color} strokeWidth={2.2} strokeDasharray="5 5" dot={{ r: 4, fill: s.color, strokeWidth: 0 }} isAnimationActive={false} label={valueLabels ? { position: "top", fill: s.color, fontSize: 12 } : false}/>)}
        {anomaly && <Line dataKey={d => Number(d.index) >= 6 ? d[series.find(s => s.id === "A4" || s.id === "core")?.id ?? series[0].id] : null} stroke="#f04468" strokeWidth={2.2} dot={{ r: 4, fill: "#f04468", strokeWidth: 0 }} isAnimationActive={false} tooltipType="none"/>}
      </ComposedChart></ResponsiveContainer>
    </div>}
    {onPoint&&hasValues&&<details className="neo-chart-evidence"><summary>按周核查依据</summary><div className="neo-live-evidence">{series.flatMap(s=>labels.map((label,index)=>s.values[index]!=null?<button key={`${s.id}/${index}`} type="button" onClick={()=>onPoint(s,index)}>{label} · {s.name}</button>:null))}</div></details>}
  </section>;
}

export function MoneyBar({ title, total, items, onItem }: {onItem?:(index:number)=>void; title: string; total: string; items: Array<{ label: string; value: number|null; amount: string; color: string }> }) {
  return <section className="neo-card neo-money-bar"><div className="neo-money-heading"><h2>{title}</h2><strong>{total}</strong></div><div className="neo-stack">{items.map(item => <i key={item.label} title={`${item.label} ${item.amount}`} style={{ width: `${item.value == null ? 0 : Math.max(0,item.value)*100}%`, background: item.color }}/>)}</div><div className="neo-stack-labels">{items.map((item,index) => <div key={item.label} role={onItem?"button":undefined} tabIndex={onItem?0:undefined} onClick={onItem?()=>onItem(index):undefined} onKeyDown={onItem?e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onItem(index);}}:undefined}><span><i style={{ background: item.color }}/>{item.label}</span><b>{item.amount} · {item.value == null ? "待补数据" : `${(item.value*100).toFixed(1)}%`}</b></div>)}</div></section>;
}

export function SectionTitle({ eyebrow, title, note, action }: { eyebrow?: string; title: string; note?: string; action?: React.ReactNode }) {
  return <div className="neo-section-title"><div>{eyebrow && <span className="neo-overline">{eyebrow}</span>}<h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</div>;
}
