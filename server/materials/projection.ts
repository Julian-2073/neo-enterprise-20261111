import type {Fact,StoredFact} from '../contracts.ts';
import type {CustomerFunnelRule,FrozenDomain,FrozenObject,MaterialKind,MaterialRow,MaterialsProjection} from './contracts.ts';
import {selectMaterial,canonicalCustomer} from './validation.ts';
import {assert} from '../errors.ts';
type Row=StoredFact&{fact:Fact};
const sum=(xs:number[])=>{const n=xs.reduce((n,x)=>n+BigInt(x),BigInt(0));assert(n<=BigInt(Number.MAX_SAFE_INTEGER)&&n>=BigInt(Number.MIN_SAFE_INTEGER),422,'TOTAL_OVERFLOW','资料关联汇总超出安全整数');return Number(n);};
const dayPlus=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function validateFunnelRule(input:unknown):CustomerFunnelRule|null{
 if(input==null)return null;assert(typeof input==='object'&&!Array.isArray(input),422,'FUNNEL_RULE','客户漏斗规则无效');
 const r=input as CustomerFunnelRule;assert(['A1','A2','A3'].includes(r.cohortStage)&&Number.isInteger(r.conversionWindowDays)&&r.conversionWindowDays>=1&&r.conversionWindowDays<=90&&['same_channel','any'].includes(r.channelPolicy),422,'FUNNEL_RULE','须显式指定阶段、1至90天观察窗口及渠道策略');
 return {cohortStage:r.cohortStage,conversionWindowDays:r.conversionWindowDays,channelPolicy:r.channelPolicy};
}
const stages:Record<string,string>={impression:'A1',content_view:'A1',artwork_view:'A1',engaged:'A2',click:'A2',save:'A2',follow:'A2',like:'A2',share:'A2',add_to_cart:'A3',inquiry:'A3',lead:'A3',form_submit:'A3'};
export function projectMaterials(masters:MaterialRow[],facts:Row[],input:{dataNature:'demo'|'business';knownAt:string;asOf:string;start:string;end:string;productId?:string|null;channel?:string|null;weeks:Array<{start:string;end:string}>;customerFunnel:CustomerFunnelRule|null;observationCovered:boolean}):MaterialsProjection{
 const selected=(kind:MaterialKind,day=input.asOf)=>[...new Set(masters.filter(r=>r.kind===kind).map(r=>r.fact.object_id!))].map(id=>selectMaterial(masters,kind,id,day)).filter((r):r is MaterialRow=>!!r);
 const freeze=(r:MaterialRow):FrozenObject=>{const f=r.fact;return {id:f.object_id!,name:f.name??null,productId:f.product_id,roleId:f.role_id??null,purpose:f.purpose??null,imageUrl:f.image_url??null,safetyUnits:f.safety_units??null,unit:f.unit??null,skuId:f.sku_id,warehouseId:f.warehouse_id,
  customerId:f.customer_id,identityNamespace:f.identity_namespace,externalId:f.external_id,date:f.eta,units:f.units,status:f.status,minimumSellableUnits:f.minimum_sellable_units,targetRatio:f.target_ratio_bps==null?null:f.target_ratio_bps/10000,
  receivedUnits:f.received_units??null,sourceKnownAt:f.source_known_at??null,sourceStatus:f.source_status??null,sourceVersion:f.source_version??null,qualificationBasis:f.qualification_basis??(r.kind==='supply_rules'?'minimum_sellable_units':null),
  factId:r.id,batchId:r.batch_id,row:r.row_number,effectiveFrom:f.effective_from!,effectiveTo:f.effective_to??null,availableAt:r.availableAt};};
 const domain:FrozenDomain={products:selected('products').filter(r=>!input.productId||r.fact.object_id===input.productId).map(freeze),skus:selected('skus').filter(r=>!input.productId||r.fact.product_id===input.productId).map(freeze),roles:selected('roles').map(freeze),channels:selected('channels').filter(r=>!input.channel||r.fact.object_id===input.channel).map(freeze),warehouses:selected('warehouses').map(freeze),customers:selected('customers').map(freeze),customerIdentities:selected('customer_identities').map(freeze),arrivals:selected('arrivals').filter(r=>!input.productId||selectMaterial(masters,'skus',r.fact.sku_id!,input.asOf)?.fact.product_id===input.productId).map(freeze),supplyRules:selected('supply_rules').map(freeze)};
 const currentStock=(day:string)=>{const m=new Map<string,Row>();for(const r of facts.filter(r=>r.kind==='inventory'&&r.fact.business_date<=day).sort((a,b)=>a.fact.occurred_at.localeCompare(b.fact.occurred_at)||a.id.localeCompare(b.id)))m.set(JSON.stringify([r.fact.warehouse_id,r.fact.sku_id]),r);return [...m.values()];};
 const within=facts.filter(r=>r.fact.business_date>=input.start&&r.fact.business_date<=input.end),stock=currentStock(input.asOf);
 const products=[...new Set([...domain.products.map(p=>p.id),...facts.map(r=>r.fact.product_id).filter((s):s is string=>!!s)])].map(id=>{
  const st=stock.filter(r=>r.fact.product_id===id),orders=within.filter(r=>r.kind==='orders'&&r.fact.product_id===id);
  const skus=domain.skus.filter(s=>s.productId===id),planned=domain.arrivals.filter(a=>['planned','rescheduled','partially_received'].includes(String(a.status))&&String(a.date)>=input.asOf&&skus.some(s=>s.id===a.skuId));
  return {productId:id,netQuantity:orders.length?sum(orders.map(r=>(r.fact.entry_type==='refund'?-1:1)*r.fact.quantity!)):null,sellableUnits:st.length?sum(st.map(r=>r.fact.sellable_units!)):null,inTransitUnits:st.length&&st.every(r=>r.fact.in_transit_units!=null)?sum(st.map(r=>r.fact.in_transit_units!)):null,inventoryCostCents:st.length&&st.every(r=>r.fact.inventory_cost_cents!=null)?sum(st.map(r=>r.fact.inventory_cost_cents!)):null,earliestArrival:planned.length?planned.map(a=>String(a.date)).sort()[0]:null,plannedArrivalUnits:planned.length?sum(planned.map(a=>a.units as number)):null,remainingArrivalUnits:planned.length&&planned.every(a=>a.receivedUnits!=null)?sum(planned.map(a=>(a.units as number)-(a.receivedUnits as number))):null};
 });
 const roleAt=(sku:MaterialRow,day:string)=>sku.fact.role_id??selectMaterial(masters,'products',sku.fact.product_id!,day)?.fact.role_id;
 const ruleAt=(roleId:string,day:string)=>{const rules=selected('supply_rules',day).filter(r=>r.fact.role_id===roleId);return rules.length===1?rules[0]:undefined;};
 const evaluate=(roleId:string,day:string)=>{
  const skus=selected('skus',day).filter(s=>(!input.productId||s.fact.product_id===input.productId)&&roleAt(s,day)===roleId),st=currentStock(day),rule=ruleAt(roleId,day);
  const observed=skus.filter(s=>st.some(r=>r.fact.sku_id===s.fact.object_id));
  const basis=rule?.fact.qualification_basis??'minimum_sellable_units';
  const safetyComplete=basis!=='inventory_safety_units'||observed.every(s=>st.filter(r=>r.fact.sku_id===s.fact.object_id).every(r=>r.fact.safety_units!=null));
  const qualified=rule&&safetyComplete?observed.filter(s=>{const records=st.filter(r=>r.fact.sku_id===s.fact.object_id);const threshold=basis==='inventory_safety_units'?sum(records.map(r=>r.fact.safety_units!)):rule.fact.minimum_sellable_units!;return sum(records.map(r=>r.fact.sellable_units!))>=threshold;}).length:null;
  const allObserved=skus.length>0&&observed.length===skus.length;
  return {qualificationBasis:rule?basis:null,skuCount:skus.length,observedSkuCount:observed.length,qualifiedSkuCount:qualified,qualifiedRatio:allObserved&&qualified!=null?qualified/skus.length:null,targetRatio:rule?rule.fact.target_ratio_bps!/10000:null};
 };
 const roles=domain.roles.map(role=>{const current=evaluate(role.id,input.asOf),skuIds=domain.skus.filter(s=>(s.roleId??domain.products.find(p=>p.id===s.productId)?.roleId)===role.id).map(s=>s.id),records=stock.filter(r=>skuIds.includes(r.fact.sku_id!));
  return {roleId:role.id,...current,currentInventoryCostCents:current.observedSkuCount===current.skuCount&&records.length&&records.every(r=>r.fact.inventory_cost_cents!=null)?sum(records.map(r=>r.fact.inventory_cost_cents!)):null,weekly:input.weeks.map(w=>({start:w.start,...evaluate(role.id,w.end)}))};
 });
 const relevant=within.filter(r=>r.kind==='events'&&stages[r.fact.event_type!]||r.kind==='orders'&&r.fact.entry_type==='paid');
 const resolve=(r:Row)=>{const id=canonicalCustomer(r.fact,masters);return id&&selectMaterial(masters,'customers',id,r.fact.business_date)?id:null;};
 const unidentified=[...relevant,...facts.filter(r=>r.kind==='orders'&&r.fact.entry_type==='paid'&&r.fact.business_date>input.end&&r.fact.business_date<=input.asOf)].filter(r=>!resolve(r)).length;
 const counts=Object.fromEntries(['A1','A2','A3','A4'].map(stage=>{const rows=relevant.filter(r=>stage==='A4'?r.kind==='orders':r.kind==='events'&&stages[r.fact.event_type!]===stage);return [stage,rows.length&&rows.every(r=>resolve(r))?new Set(rows.map(resolve)).size:null];}));
 const rule=input.customerFunnel,anchors=new Map<string,Row>();
 if(rule)for(const r of relevant.filter(r=>r.kind==='events'&&stages[r.fact.event_type!]===rule.cohortStage).sort((a,b)=>a.fact.occurred_at.localeCompare(b.fact.occurred_at)||a.id.localeCompare(b.id))){const id=resolve(r);if(id&&!anchors.has(id))anchors.set(id,r);}
 const mature=rule?[...anchors.entries()].filter(([,r])=>dayPlus(r.fact.business_date,rule.conversionWindowDays)<=input.asOf):[];
 const paid=facts.filter(r=>r.kind==='orders'&&r.fact.entry_type==='paid'&&r.fact.business_date<=input.asOf);
 const converted=rule?mature.filter(([id,r])=>paid.some(p=>resolve(p)===id&&p.fact.occurred_at>=r.fact.occurred_at&&p.fact.business_date<=dayPlus(r.fact.business_date,rule.conversionWindowDays)&&(rule.channelPolicy==='any'||p.fact.channel===r.fact.channel))).length:null;
 const complete=!!rule&&!!anchors.size&&unidentified===0&&input.observationCovered;
 const customerAnalysis:MaterialsProjection['customerAnalysis']={status:!rule?'unconfigured':complete?'ready':'partial',stageCustomerCounts:counts,unidentifiedRecords:unidentified,rule,cohortCustomers:rule&&relevant.length?anchors.size:null,matureCustomers:rule&&relevant.length?mature.length:null,convertedCustomers:complete?converted:null,conversionRate:complete&&mature.length?converted!/mature.length:null,immatureCustomers:rule&&relevant.length?anchors.size-mature.length:null,limitations:['这是所选阶段客户队列到支付的转化；不代表净成交人数或全站客户。','未完成观察窗口的客户不进入转化率分母。',...(unidentified?['存在客户身份缺失或该日无有效映射，转化率不足。']:[]),...(!rule?['尚未配置客户队列/观察窗口/渠道规则。']:[]),...(!input.observationCovered?['行为统计期或支付观察期的来源覆盖不足；不能把未记录的转化当零。']:[])]};
 const missing:string[]=[];for(const [key,values] of Object.entries(domain))if(!values.length)missing.push(key);
 const unresolved=facts.filter(r=>(r.fact.product_id&&!selectMaterial(masters,'products',r.fact.product_id,r.fact.business_date))||(r.fact.sku_id&&!selectMaterial(masters,'skus',r.fact.sku_id,r.fact.business_date))||(r.fact.channel&&!selectMaterial(masters,'channels',r.fact.channel,r.fact.business_date))||(r.fact.warehouse_id&&!selectMaterial(masters,'warehouses',r.fact.warehouse_id,r.fact.business_date))).length;
 return {version:'operating-materials-v1',dataProvenance:input.dataNature==='demo'?'SYNTHETIC_DEMO':'BUSINESS_UNVERIFIED',knownAt:input.knownAt,availability:'system_recorded',domain,customerAnalysis,supply:{ruleStatus:domain.supplyRules.length?'configured':'unconfigured',roles,products,limitations:['仅已导入/已观测仓库和SKU；缺少SKU库存不按零评价，角色比例为null。','最低件数或库存安全线依据及目标比例来自有效规则；安全线缺失不计算达标数，不是演示基线。','到货计划不加到当前库存，在途快照与计划量分别保留。']},quality:{missingFields:missing,unresolvedReferences:unresolved},customerLinks:facts.filter(r=>['events','orders'].includes(r.kind)).map(r=>({factId:r.id,customerId:resolve(r),linkedOrderId:r.fact.linked_order_id??null,linkedOrderLineId:r.fact.linked_order_line_id??null})),sourceFactIds:masters.filter(r=>r.fact.effective_from!<=input.asOf).map(r=>r.id)};
}
