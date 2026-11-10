import type {BusinessInput} from './business-state.ts';
import {integerSum} from './business-metrics.ts';

type LedgerInput=BusinessInput&{sourceId:string};
// An order ID may contain several lines. A line is identified by product and
// channel inside its registered source; refunds must match that exact line.
export function validateBusinessLedger(rows:LedgerInput[]){
 const lines=new Map<string,LedgerInput[]>();
 for(const r of rows.filter(r=>['order','hotel_stay'].includes(r.kind))){
  const key=JSON.stringify([r.sourceId,r.kind,r.orderId??r.recordKey,r.orderLineId??JSON.stringify([r.entityId,r.channelId??null])]);
  lines.set(key,[...(lines.get(key)??[]),r]);
 }
 for(const line of lines.values()){
  const paid=line.filter(r=>r.entryType!=='refund'),refunds=line.filter(r=>r.entryType==='refund');
  if(paid.length>1)throw Error('同一来源订单行只能有一条有效支付记录；更正须引用原版本');
  if(!refunds.length)continue;
  if(paid.length!==1)throw Error('退款缺少同来源、同商品和渠道的有效支付依据');
  const payment=paid[0];
  if(refunds.some(r=>r.entityId!==payment.entityId||r.channelId!==payment.channelId))throw Error('退款商品和渠道须与关联支付行一致');
  if(refunds.some(r=>r.businessDate<payment.businessDate))throw Error('退款不能早于关联支付');
  for(const field of ['quantity','amountCents','variableCostCents'] as const){
   const amounts=refunds.map(r=>r[field]??0),total=integerSum(amounts);
   if(total>0&&(payment[field]==null||total>payment[field]!))throw Error(`累计退款 ${field} 超出可确认的支付余额`);
  }
 }
}
