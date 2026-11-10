import type {Context} from './auth.ts';
import {all} from './store.ts';
import type {BusinessProfile,FrozenInput} from '../lib/business-state.ts';
import type {Coverage} from '../lib/business-metrics.ts';
import type {Fact} from './contracts.ts';
import {eventStages} from './templates.ts';
import {readMaterials,canonicalCustomer,selectMaterial} from './materials/validation.ts';
import {assert} from './errors.ts';
// Existing imports remain immutable. Only explicitly registered legacy source
// IDs participate; committed_at is the knowledge clock, never occurred_at.
// An ecommerce order must not be re-labelled as a hotel stay or production.
const map:Record<string,string>={orders:'order',expenses:'expense',events:'event',inventory:'inventory'};
export async function legacyOperatingCoverage(ctx:Context,nature:string,knownAt:string,profile:BusinessProfile){
 const batches=await all<{source_id:string;kind:string;coverage_start:string;coverage_end:string}>(ctx.db,"SELECT source_id,kind,coverage_start,coverage_end FROM ingestion_batches WHERE business_id=? AND data_nature=? AND status='committed' AND committed_at<=? AND source_id IN (SELECT value FROM json_each(?))",ctx.businessId,nature,knownAt,JSON.stringify(profile.expectedSources.map(s=>s.sourceId)));
 return batches.filter(b=>map[b.kind]&&profile.expectedSources.find(s=>s.sourceId===b.source_id)?.kinds.includes(map[b.kind])&&(b.kind!=='orders'||profile.industry!=='hotel')).map(b=>({sourceId:b.source_id,kind:map[b.kind],start:b.coverage_start,end:b.coverage_end} as Coverage));
}
export async function legacyOperatingInputs(ctx:Context,nature:string,knownAt:string,future:string,profile:BusinessProfile,keys?:string[],start?:string){
 const rows=await all<{id:string;source_id:string;record_key:string;kind:string;payload:string;committed_at:string}>(ctx.db,`SELECT f.id,f.source_id,f.record_key,f.kind,f.payload,b.committed_at FROM business_facts f JOIN ingestion_batches b ON b.id=f.batch_id WHERE f.business_id=? AND f.data_nature=? AND b.status='committed' AND b.committed_at<=? AND f.business_date<=? AND f.kind IN ('orders','expenses','events','inventory') AND f.source_id IN (SELECT value FROM json_each(?)) ${start?"AND (f.kind='inventory' OR f.business_date>=?)":''} ${keys?'AND f.record_key IN (SELECT value FROM json_each(?))':''} ORDER BY f.business_date,b.committed_at,f.id`,ctx.businessId,nature,knownAt,future,JSON.stringify(profile.expectedSources.map(s=>s.sourceId)),...(start?[start]:[]),...(keys?[JSON.stringify(keys)]:[]));
 const inputs:FrozenInput[]=[];
 const masters=rows.some(r=>['orders','events'].includes(r.kind))?await readMaterials(ctx,nature,knownAt):[];
 assert(masters.length<=10000,413,'MATERIAL_LIMIT','客户身份资料版本超过已支持上限，不能截断后计算');
 for(const row of rows){const f=JSON.parse(row.payload) as Fact,kind=map[row.kind];if(!profile.expectedSources.find(s=>s.sourceId===row.source_id)?.kinds.includes(kind)||row.kind==='orders'&&profile.industry==='hotel')continue;
 const customerId=canonicalCustomer(f,masters),customer=customerId?selectMaterial(masters,'customers',customerId,f.business_date):undefined;
 const identity=f.identity_namespace&&f.external_contact_id?selectMaterial(masters,'customer_identities',JSON.stringify([f.identity_namespace,f.external_contact_id]),f.business_date):undefined;
 const base={id:row.id,sourceId:row.source_id,recordKey:row.record_key,revision:1,knownAt:row.committed_at,businessDate:f.business_date,entityId:f.sku_id??f.product_id??'unassigned',...(f.channel?{channelId:f.channel}:{}),...(customer?{customerId:customerId!,identityEvidenceIds:[customer.id,...(identity?[identity.id]:[])]}:{})};
 if(kind==='order')inputs.push({...base,kind:'order',quantity:f.quantity,amountCents:f.amount_cents,variableCostCents:f.variable_cost_cents,entryType:f.entry_type,orderId:f.order_id,orderLineId:f.order_line_id});
 if(kind==='expense')inputs.push({...base,kind:'expense',amountCents:f.amount_cents});
 if(kind==='inventory')inputs.push({...base,kind:'inventory',warehouseId:f.warehouse_id,quantity:f.sellable_units,reservedUnits:0,inspectionUnits:0,inventoryCostCents:f.inventory_cost_cents});
 // A contact is usable only with an effective, committed same-tenant customer
 // master (and alias when present), frozen at this generation's cutoff.
 const stage=eventStages[f.event_type??''];if(kind==='event'&&['A1','A2','A3'].includes(stage))inputs.push({...base,kind:'event',quantity:f.quantity,stage:stage as 'A1'|'A2'|'A3'});
 }
 return inputs;
}
