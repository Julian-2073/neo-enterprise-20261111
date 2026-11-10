'use client';
import {useRef,useState,type ComponentProps} from 'react';
import {LineChart as OriginalChart,MoneyBar as OriginalMoneyBar} from './charts.tsx';
import {useOperating} from './operating-context';
import {chartEvidenceId,type ChartForecasts} from '../../lib/chart-evidence';
import {OperatingEvidenceDrawer} from './operating-evidence-drawer';
import {CustomerPulseDrawer,type PulseReference} from './customer-pulse-drawer';
export {SectionTitle} from './charts.tsx';
export type {ChartSeries} from './charts.tsx';
export function LineChart({evidenceForecasts,...props}:ComponentProps<typeof OriginalChart>&{evidenceForecasts?:ChartForecasts}){
 const w=useOperating(),s=w?.snapshot,[reference,setReference]=useState<PulseReference|null>(null),returnFocus=useRef<HTMLElement|null>(null);
 const close=()=>{setReference(null);returnFocus.current?.focus();};
 if(!w)return <OriginalChart {...props}/>;
 const custom=props.title.includes('供给')||props.title==='4A 相对走势'||props.title.includes('历史支付出库');
 const j=s?.data.customerJourney;
 const chart=props.title==='4A 相对走势'&&j?{...props,note:'客户按周去重 · 前四周平均为 100',labels:j.weekly.map(x=>`${x.start.slice(5)}–${x.end.slice(5)}`),series:props.series.map(series=>{const stage=series.id as 'A1',values=j.weekly.map(x=>x.counts[stage]??null),base=values.slice(0,4),mean=base.length===4&&base.every(x=>x!=null)?base.reduce((n,x)=>n+x!,0)/4:null;return {...series,name:({A1:'了解客户',A2:'互动客户',A3:'意向客户',A4:'购买客户'} as Record<string,string>)[series.id]??series.name,values:values.map(x=>x==null||!mean?null:x/mean*100),actualValues:values,actualFormat:(n:number)=>`${n} 人`};})}:props;
 return <><OriginalChart {...chart} max={props.title==='4A 相对走势'&&j?Math.max(160,...chart.series.flatMap(x=>x.values).filter((x):x is number=>x!=null))*1.1:props.max} onPoint={custom?(series,index)=>{if(!s)return;const id=chartEvidenceId(s,props.title,series.id,index,props.forecastStart,evidenceForecasts);if(!id)return;returnFocus.current=document.activeElement as HTMLElement|null;setReference({id,businessId:s.businessId,nature:s.dataNature,snapshotId:s.id});}:props.onPoint}/>{reference?.snapshotId===s?.id&&(reference?.id.includes(':view:customer-pulse:')?<CustomerPulseDrawer reference={reference} onClose={close}/>:<OperatingEvidenceDrawer reference={reference} onClose={close}/>)}</>;
}
export function MoneyBar(props:ComponentProps<typeof OriginalMoneyBar>){
 const w=useOperating(),s=w?.snapshot,[reference,setReference]=useState<PulseReference|null>(null),returnFocus=useRef<HTMLElement|null>(null);
 const close=()=>{setReference(null);returnFocus.current?.focus();};
 if(!w)return <OriginalMoneyBar {...props}/>;
 const financial=props.title.includes('净成交额组成');
 return <><OriginalMoneyBar {...props} onItem={props.onItem??(financial?index=>{const key=['variableCostCents','spendCents','contributionMarginCents'][index],id=s?.evidenceIds[key];if(!s||!id)return;returnFocus.current=document.activeElement as HTMLElement|null;setReference({id,businessId:s.businessId,nature:s.dataNature,snapshotId:s.id});}:undefined)}/>{reference?.snapshotId===s?.id&&<OperatingEvidenceDrawer reference={reference} onClose={close}/>}</>;
}
