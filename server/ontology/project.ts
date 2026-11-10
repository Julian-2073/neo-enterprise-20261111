import type {FrozenInput} from '../../lib/business-state.ts';
import {mapRecord,recordIssues,type Definition,type BusinessObject,type BusinessLink,type QualityIssue,type Provenance} from './model.ts';
export type ProjectionInput={facts:Array<{id:string;kind:string;fact:Record<string,unknown>;sourceId:string;batchId:string;row:number;availableAt:string}>;domain:Array<{id:string;kind:string;payload:Record<string,unknown>;availableAt:string}>;imports:Array<{id:string;typeId:string;rows:Record<string,unknown>[];availableAt:string}>;artifacts:Array<{id:string;kind:string;payload:Record<string,unknown>;availableAt:string}>;edits:Array<{id:string;typeId:string;objectId:string;property:string;value:unknown;availableAt:string}>;snapshot?:Record<string,unknown>;operating?:{generationId:string;profileVersion:string;availableAt:string;inputs:FrozenInput[]}};
export function project(input:ProjectionInput,definition:Definition,asOf:string){
 const objects=new Map<string,BusinessObject>(),issues:QualityIssue[]=[];
 const key=(t:string,id:string)=>`${t}:${id}`;
 const add=(typeId:string,raw:Record<string,unknown>,prov:Provenance[],referenceOnly=false,canonical=true)=>{
  const t=definition.types.find(t=>t.id===typeId);if(!t)return;
  try{
   const properties=referenceOnly?Object.fromEntries(Object.entries(raw).filter(([k,v])=>t.properties[k]&&v!=null).map(([k,v])=>[k,String(v)])):mapRecord(raw,canonical?{...t,mapping:undefined}:t,!canonical);const id=String(properties[t.primaryKey]);
   const effective=t.effectiveField?properties[t.effectiveField]:null;if(effective&&!t.planned&&String(effective).slice(0,10)>asOf)return;
   const existing=objects.get(key(typeId,id));
   if(existing&&!referenceOnly&&!existing.referenceOnly&&JSON.stringify(existing.properties)!==JSON.stringify(properties)){
    // Append-only master revisions are ordered by system availability; the newest is selected explicitly.
    const last=existing.provenance.at(-1)?.availableAt??'';const at=prov.at(-1)?.availableAt??'';
    if(last===at){issues.push({severity:'error',code:'OBJECT_CONFLICT',typeId,objectId:id,message:'同一可用时点存在不同对象内容'});return;}
    if(last>at)return;
   }
   if(existing&&referenceOnly){for(const [k,v] of Object.entries(properties))if(existing.properties[k]==null)existing.properties[k]=v;existing.provenance.push(...prov);return;}
   const mergedProv=[...(existing?.provenance??[]),...prov];
   objects.set(key(typeId,id),{typeId,id,title:String(properties[t.title]??id),properties,provenance:mergedProv,referenceOnly});
  }catch(e){const checked=canonical?{...t,mapping:undefined}:t,fields=recordIssues(raw,checked,!canonical);const location={typeId,objectId:String(raw[checked.mapping?.[t.primaryKey]?.field??t.primaryKey]??''),row:prov.at(-1)?.row};if(fields.length)issues.push(...fields.map(issue=>({...issue,...location,severity:'error' as const,code:'PROPERTY_INVALID'})));else issues.push({severity:'error',code:'PROPERTY_INVALID',...location,message:e instanceof Error?e.message:'属性无效'});}
 };
 const ref=(typeId:string,id:unknown,p:Provenance[],extra:Record<string,unknown>={})=>{if(id!=null&&id!=='')add(typeId,{id:String(id),...extra},p,true);};
 for(const r of input.operating?.inputs??[]){
  const typeId='operating_'+r.kind;
  if(!definition.types.some(t=>t.id===typeId)){issues.push({severity:'warning',code:'OPERATING_TYPE_UNMAPPED',typeId,objectId:r.id,message:'当前定义未映射此经营事实类型；冻结输入仍保留'});continue;}
  add(typeId,{...r,generationId:input.operating!.generationId,profileVersion:input.operating!.profileVersion},[{kind:'operating_input',id:r.id,availableAt:input.operating!.availableAt,availability:'system_recorded'}]);
 }
 for(const r of input.facts){
  const f=r.fact,p:Provenance[]=[{kind:'fact',id:r.id,batchId:r.batchId,row:r.row,availableAt:r.availableAt,availability:'system_recorded'}];
  ref('customer',(f.resolved_customer_id??f.contact_id),p);ref('product',f.product_id,p);ref('sku',f.sku_id,p,{productId:f.product_id});ref('channel',f.channel,p);ref('warehouse',f.warehouse_id,p);
  const common={id:r.id,customerId:(f.resolved_customer_id??f.contact_id),date:f.business_date,productId:f.product_id,skuId:f.sku_id,channelId:f.channel,warehouseId:f.warehouse_id,quantity:f.quantity,amountCents:f.amount_cents,costCents:f.variable_cost_cents};
  if(r.kind==='orders'){
   const orderId=JSON.stringify([r.sourceId,f.order_id]),lineId=JSON.stringify([r.sourceId,f.order_id,f.order_line_id]);
   add('order',{id:orderId,sourceId:r.sourceId,channelId:f.channel,customerId:(f.resolved_customer_id??f.contact_id)},p);
   if(f.entry_type==='paid')add('order_line',{...common,id:lineId,orderId},p);
   else add('refund',{...common,orderLineId:lineId},p);
  }else if(r.kind==='events')add('event',{...common,eventType:f.event_type,linkedOrderId:f.linked_order_id?JSON.stringify([r.sourceId,f.linked_order_id]):null},p);
  else if(r.kind==='expenses')add('expense',common,p);
  else if(r.kind==='inventory')add('inventory',{...common,sellableUnits:f.sellable_units,inTransitUnits:f.in_transit_units,safetyUnits:f.safety_units,inventoryCostCents:f.inventory_cost_cents},p);
 }
 const domains:Record<string,string>={products:'product',skus:'sku',roles:'role',arrivals:'arrival',channels:'channel',warehouses:'warehouse',customers:'customer',customerIdentities:'customer_identity',supplyRules:'supply_rule'};
 for(const r of input.domain){
  const t=domains[r.kind];if(!t)continue;const p:Provenance[]=[{kind:'domain',id:r.id,availableAt:r.availableAt,availability:'system_recorded'}];
  const raw={...r.payload,productId:r.payload.productId??r.payload.product_id,roleId:r.payload.roleId??r.payload.role_id,purpose:r.payload.purpose??r.payload.rolePurpose};add(t,raw,p);if(raw.roleId)ref('role',raw.roleId,p);
  if(t==='sku')ref('product',r.payload.productId??r.payload.product_id,p);
  if(t==='arrival'){ref('sku',r.payload.skuId,p);ref('warehouse',r.payload.warehouseId,p);}
 }
 for(const batch of input.imports)for(const [i,row] of batch.rows.entries())add(batch.typeId,row,[{kind:'ontology_import',id:batch.id,row:i+1,availableAt:batch.availableAt,availability:'system_recorded'}],false,false);
 for(const r of input.artifacts){
  const p:Provenance[]=[{kind:'artifact',id:r.id,availableAt:r.availableAt,availability:'system_recorded'}];const v=r.payload;
  if(['forecast','scenario','decision'].includes(r.kind))add(r.kind,{id:r.id,snapshotId:v.snapshotId,asOf:v.asOf,units:(v.totals as Record<string,unknown>|undefined)?.units,forecastId:v.parentId,scenarioId:v.scenarioId,reason:v.reason,actualOutcome:null},p);
  else if(r.kind==='market_evidence')add(r.kind,{id:r.id,...v},p);
 }
 for(const edit of input.edits){
  const o=objects.get(key(edit.typeId,edit.objectId));const p=definition.types.find(t=>t.id===edit.typeId)?.properties[edit.property];
  if(!o||p?.mode!=='editable')continue;
  const prior=o.provenance.filter(p=>p.kind!=='edit').map(p=>p.availableAt).sort().at(-1)??'';
  if(p.conflict==='source'&&prior>edit.availableAt)continue;
  if(p.conflict==='review'&&prior>edit.availableAt){issues.push({severity:'warning',code:'EDIT_REVIEW',typeId:o.typeId,objectId:o.id,field:edit.property,message:'源数据晚于人工编辑，待核对；本版本使用源值'});continue;}
  o.properties[edit.property]=edit.value as string|number|boolean|null;
  o.provenance.push({kind:'edit',id:edit.id,property:edit.property,availableAt:edit.availableAt,availability:'system_recorded'});

 }
 const links:BusinessLink[]=[];
 for(const l of definition.links){
  if(l.cardinality==='many-to-many'){for(const o of objects.values())if(o.typeId===l.through!.typeId){const from=String(o.properties[l.through!.fromProperty]??''),to=String(o.properties[l.through!.toProperty]??'');if(objects.has(key(l.from,from))&&objects.has(key(l.to,to)))links.push({linkId:l.id,fromId:from,toId:to,provenance:o.provenance});else issues.push({severity:'warning',code:'ORPHAN_LINK',typeId:o.typeId,objectId:o.id,message:'关联记录的一端对象缺失'});}continue;}
  const incoming=new Set<string>();
  for(const o of objects.values())if(o.typeId===l.from){
   const target=o.properties[l.property];if(target==null||target==='')continue;const to=objects.get(key(l.to,String(target)));
   if(!to){issues.push({severity:'warning',code:'ORPHAN_LINK',typeId:l.from,objectId:o.id,field:l.property,message:`关联的${l.to}不存在：${target}`});continue;}
   if(l.cardinality==='one-to-one'&&incoming.has(to.id)){issues.push({severity:'error',code:'LINK_CARDINALITY',typeId:l.from,objectId:o.id,message:'一对一关系存在重复目标'});continue;}
   incoming.add(to.id);links.push({linkId:l.id,fromId:o.id,toId:to.id,provenance:o.provenance});
  }
 }
 for(const o of objects.values())if(o.referenceOnly)issues.push({severity:'warning',code:'REFERENCE_ONLY',typeId:o.typeId,objectId:o.id,message:'仅有事实中的引用，尚无完整主数据'});
 const uniqueLinks=[...new Map(links.map(l=>[JSON.stringify([l.linkId,l.fromId,l.toId]),l])).values()];
 const values=[...objects.values()].sort((a,b)=>a.typeId.localeCompare(b.typeId)||a.id.localeCompare(b.id));
 return {objects:values,links:uniqueLinks,issues,counts:{objects:values.length,links:uniqueLinks.length,types:Object.fromEntries(definition.types.map(t=>[t.id,values.filter(o=>o.typeId===t.id).length]))}};
}
