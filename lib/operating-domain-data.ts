import {productName,channelName,inventoryStatus} from './business-presentation.ts';
import {eventStages} from '../server/templates.ts';
import type {Snapshot,Fact} from '../server/contracts';
import type {NeoData} from './operating-demo-data';
export type FrozenDomain={channels?:Array<{id:string;name:string}>;products:Array<{id:string;name:string;roleId?:string;role_id?:string}>;skus:Array<{id:string;product_id?:string;productId?:string;role_id?:string;roleId?:string}>;roles:Array<{id:string;name:string;purpose?:string;rolePurpose?:string}>;arrivals:Array<{id:string;skuId:string;warehouseId:string;date:string;units:number}>;facts:Array<{id:string;kind:string;sourceId?:string;fact:Fact}>};
export function enrichSavedDomain(d:NeoData,s:Snapshot,domain:FrozenDomain){
 const roleFor=(product:string|null,sku?:string|null)=>(domain.skus.find(x=>x.id===sku)?.roleId||domain.skus.find(x=>x.id===sku)?.role_id)||domain.products.find(x=>x.id===product)?.roleId||domain.products.find(x=>x.id===product)?.role_id;
 for(const role of d.productRoles){
  const definition=domain.roles.find(r=>r.id===role.id);if(!definition)continue;role.name=definition.name;role.rolePurpose=definition.rolePurpose||definition.purpose||'来自本快照的商品角色定义';
  const rows=s.data.inventory.filter(r=>roleFor(r.product_id,r.sku_id)===role.id);if(!s.data.materials)role.skuCount=new Set(rows.map(r=>r.sku_id)).size;
  role.currentInventoryCost=rows.length&&rows.every(r=>r.inventory_cost_cents!=null)?rows.reduce((n,r)=>n+r.inventory_cost_cents!,0)/100:rows.length?null:0;
 }
 const productIds=[...new Set(s.data.inventory.map(row=>row.product_id).filter((id):id is string=>!!id))];
 d.products=productIds.map(id=>{
  const rows=s.data.inventory.filter(row=>row.product_id===id);
  const orders=domain.facts.filter(item=>item.kind==='orders'&&item.fact.product_id===id&&item.fact.business_date>=s.periodStart&&item.fact.business_date<=s.periodEnd);
  const netQuantity=orders.length?orders.reduce((n,item)=>n+(item.fact.entry_type==='refund'?-1:1)*(item.fact.quantity||0),0):null;
  const lastFour=s.data.weeks.filter(week=>Date.parse(week.end)-Date.parse(week.start)===6*86400000).slice(-4);const period=lastFour.length===4?{start:lastFour[0].start,end:lastFour[3].end}:null;
  const sourceCoverage=new Map<string,Array<{start:string;end:string}>>();for(const item of (s.coverage??[]).filter(item=>item.kind==='orders'))sourceCoverage.set(item.sourceId,[...(sourceCoverage.get(item.sourceId)??[]),item]);
  const covered=!!period&&sourceCoverage.size>0&&[...sourceCoverage.values()].every(spans=>{let next=period.start;for(const span of spans.sort((a,b)=>a.start.localeCompare(b.start))){if(span.start<=next&&span.end>=next)next=new Date(Date.parse(span.end)+86400000).toISOString().slice(0,10);}return next>period.end;});
  const paidLastFour=covered&&period?orders.filter(item=>item.fact.entry_type==='paid'&&item.fact.business_date>=period.start&&item.fact.business_date<=period.end).reduce((n,item)=>n+(item.fact.quantity||0),0):0;
  const sellable=rows.every(row=>row.sellable_units!=null)?rows.reduce((n,row)=>n+row.sellable_units!,0):null;
  const plans=domain.arrivals.filter(plan=>rows.some(row=>row.sku_id===plan.skuId&&row.warehouse_id===plan.warehouseId)&&plan.date>s.asOf).sort((a,b)=>a.date.localeCompare(b.date));
  const value={id,name:productName(id,domain.products),roleId:roleFor(id)||roleFor(id,rows[0]?.sku_id)||'',netQuantity8w:netQuantity,sellableUnits:sellable,inTransitUnits:rows.every(row=>row.in_transit_units!=null)?rows.reduce((n,row)=>n+row.in_transit_units!,0):null,coverageDays:sellable!=null&&paidLastFour>0?Math.round(sellable/(paidLastFour/28)*10)/10:null,status:inventoryStatus(rows)};
  return plans[0]?{...value,eta:plans[0].date}:{...value,eta:null};
 });
 const productRole=(f:Fact)=>roleFor(f.product_id,f.sku_id);
 for(const cell of d.market.roleMatrix){
  const facts=domain.facts.filter(x=>x.fact.channel===cell.channelId&&productRole(x.fact)===cell.roleId&&x.fact.business_date>=s.periodStart&&x.fact.business_date<=s.periodEnd);
  if(!facts.length)continue;
  const paid=facts.filter(x=>x.kind==='orders'&&x.fact.entry_type==='paid');const orders=new Set(paid.map(x=>`${x.sourceId||''}/${x.fact.order_id||x.fact.source_record_id}`)).size;
  const a3rows=facts.filter(x=>x.kind==='events'&&eventStages[x.fact.event_type!]==='A3');
  const a3=a3rows.length?a3rows.reduce((n,x)=>n+(x.fact.quantity||0),0):null;
  const feeRows=facts.filter(x=>x.kind==='expenses');
  const fees=feeRows.length?feeRows.reduce((n,x)=>n+(x.fact.amount_cents||0),0)/100:null;
  cell.headline=`意向 ${a3==null?'待补':a3} 次 · 支付 ${paid.length?orders:'待补'} 笔`;cell.subtext=`已关联角色；投放 ${fees==null?'待补':fees.toLocaleString('zh-CN')} 元。阶段量不代表客户转化率。`;cell.status='observed';
 }
 for(const slice of Object.values(d.scopes))slice.label=`${s.productId?productName(s.productId,domain.products):'全部已导入商品'} / ${s.channel?channelName(s.channel,domain.channels??[]):'全部已导入渠道'} / ${s.periodStart} 至 ${s.periodEnd}`;
 for(const spend of d.market.channelSpends)spend.name=channelName(spend.channelId,domain.channels??[]);
 return d;
}
