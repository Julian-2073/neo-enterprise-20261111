/** Canonical operating metrics. This module has no UI or database dependency. */
export const METRIC_VERSION = 'business-metrics-v1.2';
export type MetricStatus = 'complete' | 'partial' | 'missing';
export type Metric = {value:number|null;knownValue:number|null;unit:string;status:MetricStatus;reason:string|null;evidenceIds:string[]};
export const METRIC_REGISTRY = {
 netRevenueCents:{unit:'人民币分',definition:'已发生收入减已发生退款'},
 variableCostCents:{unit:'人民币分',definition:'已确认履约成本减已确认成本冲回'},
 spendCents:{unit:'人民币分',definition:'同统计期已发生经营投入'},
 contributionMarginCents:{unit:'人民币分',definition:'净收入减可变成本及经营投入；要求收入和费用完整覆盖'},
 paidOrders:{unit:'笔',definition:'按来源与订单号去重的支付订单；不等于客户人数'},
 units:{unit:'件',definition:'已发生履约数量；经营单位由行业适配确定'},
} as const;
export type Coverage = {kind:string;sourceId:string;start:string;end:string};
export const plusDays=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function completeCoverage(spans:Coverage[],kind:string,start:string,end:string,expectedSources:string[]=[]){
 const sourceIds=[...new Set([...expectedSources,...spans.filter(x=>x.kind===kind).map(x=>x.sourceId)])];
 return sourceIds.length>0&&sourceIds.every(id=>{let next=start;for(const s of spans.filter(x=>x.kind===kind&&x.sourceId===id).sort((a,b)=>a.start.localeCompare(b.start)))if(s.start<=next&&s.end>=next)next=plusDays(s.end,1);return next>end;});
}
export function integerSum(values:number[]){
 if(values.some(x=>!Number.isSafeInteger(x)))throw Error('指标包含非法整数');
 const sum=values.reduce((n,x)=>n+BigInt(x),BigInt(0));
 if(sum>BigInt(Number.MAX_SAFE_INTEGER)||sum<BigInt(Number.MIN_SAFE_INTEGER))throw Error('指标汇总超出安全整数');
 return Number(sum);
}
export function metric(values:Array<number|null|undefined>,unit:string,covered:boolean,evidenceIds:string[]=[],emptyIsZero=true):Metric{
 const known=values.filter((x):x is number=>x!=null),knownValue=known.length?integerSum(known):covered&&emptyIsZero?0:null;
 const complete=covered&&known.length===values.length&&(values.length>0||emptyIsZero);
 return {value:complete?knownValue:null,knownValue,unit,status:complete?'complete':knownValue==null?'missing':'partial',reason:complete?null:!covered?'资料未完整覆盖统计期':'存在未确认数值',evidenceIds};
}
export function financialMetrics(rows:Array<{kind:string;sourceId:string;id:string;fact:{entry_type?:string;order_id?:string;amount_cents?:number;variable_cost_cents?:number|null}}>,spans:Coverage[],start:string,end:string){
 const orders=rows.filter(x=>x.kind==='orders'),expenses=rows.filter(x=>x.kind==='expenses');
 const orderCovered=completeCoverage(spans,'orders',start,end),expenseCovered=completeCoverage(spans,'expenses',start,end);
 const sign=(x:typeof rows[number])=>x.fact.entry_type==='refund'?-1:1;
 const cents=(x:number|null|undefined,m:number)=>x==null?null:x*m;
 const revenue=metric(orders.map(x=>cents(x.fact.amount_cents,sign(x))),'人民币分',orderCovered,orders.map(x=>x.id));
 const cost=metric(orders.map(x=>cents(x.fact.variable_cost_cents,sign(x))),'人民币分',orderCovered,orders.map(x=>x.id));
 const spend=metric(expenses.map(x=>x.fact.amount_cents),'人民币分',expenseCovered,expenses.map(x=>x.id));
 const margin=metric([revenue.value,cost.value==null?null:-cost.value,spend.value==null?null:-spend.value],'人民币分',orderCovered&&expenseCovered,[...revenue.evidenceIds,...spend.evidenceIds]);
 const paid=orders.filter(x=>x.fact.entry_type==='paid');
 const paidOrders=metric([paid.every(x=>x.fact.order_id&&x.sourceId)?new Set(paid.map(x=>JSON.stringify([x.sourceId,x.fact.order_id]))).size:null],'笔',orderCovered,paid.map(x=>x.id));
 return {netRevenueCents:revenue,variableCostCents:cost,spendCents:spend,contributionMarginCents:margin,paidOrders};
}
