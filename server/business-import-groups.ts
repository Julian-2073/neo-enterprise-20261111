import {businessAudit} from './business-audit.ts';
import {publicationEpoch,guardPublication,validatePublishedLedger} from './business-publication.ts';
import {businessProfile} from './business-state.ts';
import type {Context} from './auth.ts';
import {all,first,statement} from './store.ts';
import {assert,ApiError} from './errors.ts';
import {hash} from './csv.ts';
import {integerSum} from '../lib/business-metrics.ts';
import {drainBusinessUpdates} from './business-generations.ts';
// Chunk uploads stage immutable revisions. Only a reconciled seal publishes
// facts and the provider's complete-period claim in the same transaction.
export async function sealBusinessImport(ctx:Context,nature:string,body:Record<string,unknown>){
 assert(typeof body.groupId==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(body.groupId),422,'IMPORT_GROUP','需要有效接入组标识');
 const requestId='seal:'+body.groupId,digest=await hash(JSON.stringify(body));
 const prior=await first<{payload:string;request_hash:string}>(ctx.db,'SELECT payload,request_hash FROM neo_business_imports WHERE business_id=? AND data_nature=? AND request_id=?',ctx.businessId,nature,requestId);
 if(prior){assert(prior.request_hash===digest,409,'REQUEST_CONFLICT','封存请求内容变化');return {...JSON.parse(prior.payload),reused:true};}
 const epoch=await publicationEpoch(ctx,nature);
 const rows=await all<{payload:string;source_id:string}>(ctx.db,"SELECT payload,source_id FROM neo_business_imports WHERE business_id=? AND data_nature=? AND json_extract(payload,'$.group.id')=? ORDER BY json_extract(payload,'$.group.partIndex')",ctx.businessId,nature,body.groupId),parts=rows.map(r=>JSON.parse(r.payload));
 assert(parts.length>0,422,'IMPORT_GROUP','接入组不存在');const base=parts[0],count=base.group.partCount;
 assert(parts.length===count&&parts.every((p,i)=>p.group.partIndex===i&&p.group.partCount===count&&JSON.stringify(p.declaredCoverage)===JSON.stringify(base.declaredCoverage))&&rows.every(r=>r.source_id===rows[0].source_id),422,'IMPORT_INCOMPLETE','全部分片到齐且来源、类型与覆盖期一致后才能封存');
 const keys=parts.flatMap(p=>p.recordKeys);assert(new Set(keys).size===keys.length,422,'IMPORT_DUPLICATE','接入组中有重复记录键，不能声明完整覆盖');
 const rowCount=integerSum(parts.map(p=>p.rowCount)),totals={amountCents:integerSum(parts.map(p=>p.totals.amountCents)),quantity:integerSum(parts.map(p=>p.totals.quantity))};
 assert(body.expectedRowCount===rowCount&&body.expectedTotals&&typeof body.expectedTotals==='object'&&Object.entries(totals).every(([k,v])=>(body.expectedTotals as Record<string,unknown>)[k]===v),422,'RECONCILIATION','封存须核对提供方完整记录数、金额及数量总量');
 const now=new Date().toISOString(),id='business-import-'+crypto.randomUUID(),report={id,requestId,groupId:body.groupId,status:'sealed',rowCount,totals,coverage:base.declaredCoverage,partIds:parts.map(p=>p.id),coverageBasis:'reconciled_provider_manifest',createdAt:now};
 const staged=await all<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_inputs WHERE business_id=? AND data_nature=? AND import_id IN (SELECT value FROM json_each(?))',ctx.businessId,nature,JSON.stringify(parts.map(p=>p.id)));
 const profile=await businessProfile(ctx,nature);assert(profile,409,'PROFILE_REQUIRED','请先发布企业经营档案');
 await validatePublishedLedger(ctx,nature,JSON.parse(profile.payload),now,rows[0].source_id,staged.map(r=>JSON.parse(r.payload)));
 try{await ctx.db.batch([guardPublication(ctx,nature,epoch),businessAudit(ctx,'business_import_sealed',id,now),statement(ctx.db,'INSERT INTO neo_business_imports(id,business_id,data_nature,request_id,request_hash,source_id,payload,created_at) VALUES(?,?,?,?,?,?,?,?)',id,ctx.businessId,nature,requestId,digest,rows[0].source_id,JSON.stringify(report),now),statement(ctx.db,"INSERT INTO neo_business_updates(id,business_id,data_nature,cause,resource_id,status,created_at) VALUES(?,?,?,'import-sealed',?,'pending',?)",'update-'+id,ctx.businessId,nature,id,now)]);}catch{throw new ApiError(409,'INPUT_CONFLICT','接入组被并发封存，请回读');}
 return {...report,updates:await drainBusinessUpdates(ctx,nature)};
}
