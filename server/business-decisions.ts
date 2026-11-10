import {businessAudit} from './business-audit.ts';
import {currentRegisteredInput} from './business-input-visibility.ts';
import {publicationEpoch,guardPublication} from './business-publication.ts';
import {decisionPlan} from './decision-plan.ts';
import {storeBusinessArtifact,loadBusinessArtifact} from './business-artifact-storage.ts';
import {loadGeneration} from './generation-storage.ts';
import type {Context} from './auth.ts';
import {all,first,statement} from './store.ts';
import {assert,ApiError} from './errors.ts';
import {hash,dateOnly} from './csv.ts';
import {readBusinessState} from './business-state.ts';
import type {ScenarioResult,ScenarioSpec} from '../lib/business-scenarios.ts';
import {plusDays} from '../lib/business-metrics.ts';
import {currentBusinessGeneration} from './business-head.ts';
import {activeAssumptions,forecastPublicationGuard} from './forecast-assumptions.ts';
export type OperatingDecision={id:string;businessId:string;dataNature:string;generationId:string;bundleId:string;forecastJobId?:string;assumptionSetId?:string;scenario:ScenarioSpec;forecast:ScenarioResult;status:'saved_decision';createdAt:string;reason?:string;title?:string;plan?:ReturnType<typeof decisionPlan>;};
export async function getOperatingDecision(ctx:Context,nature:string,id:string){const row=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=? AND kind='business_decision'",id,ctx.businessId,nature);assert(row,404,'DECISION','决策不存在');return loadBusinessArtifact<OperatingDecision>(ctx,nature,'business_decision',row.payload);}
export async function saveOperatingDecision(ctx:Context,nature:string,body:Record<string,unknown>){
 assert(ctx.role==='admin',403,'ADMIN_REQUIRED','经营决策由管理员保存');
 assert(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId)&&typeof body.bundleId==='string'&&typeof body.scenarioId==='string',422,'DECISION','需要请求标识、方案集和方案标识');
 const row=await first<{payload:string}>(ctx.db,"SELECT payload FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=? AND kind='business_scenario_bundle'",body.bundleId,ctx.businessId,nature);assert(row,404,'SCENARIO','方案集不存在');
 const bundle=await loadBusinessArtifact<{id:string;generationId:string;scenarios:ScenarioSpec[];results:ScenarioResult[];forecastJobId?:string;assumptionSetId?:string}>(ctx,nature,'business_scenario_bundle',row.payload),scenario=bundle.scenarios.find((r:ScenarioSpec)=>r.id===body.scenarioId),forecast=bundle.results.find((r:ScenarioResult)=>r.id===body.scenarioId) as ScenarioResult|undefined;
 assert(scenario&&forecast&&forecast.status==='calculated'&&forecast.feasibility.status==='feasible',409,'UNCONFIRMED_DECISION','只能选择约束已确认且已计算的方案');
 const metadata=body.reason===undefined?{}:{reason:body.reason,title:body.title,plan:decisionPlan(body.plan)};
 if(body.reason!==undefined)assert(typeof body.reason==='string'&&body.reason.trim()&&body.reason.length<=4000&&typeof body.title==='string'&&body.title.trim()&&body.title.length<=100,422,'DECISION_REASON','选择理由或标题无效');
 const requestId=nature+':'+body.requestId,requestHash=await hash(JSON.stringify(body.reason===undefined?[body.bundleId,body.scenarioId]:[body.bundleId,body.scenarioId,metadata]));
 const prior=await first<{payload:string;request_hash:string}>(ctx.db,"SELECT payload,request_hash FROM neo_artifacts WHERE business_id=? AND kind='business_decision' AND request_id=?",ctx.businessId,requestId);
 if(prior){assert(prior.request_hash===requestHash,409,'REQUEST_CONFLICT','相同请求已保存其他选择');return {...(await loadBusinessArtifact(ctx,nature,'business_decision',prior.payload)),reused:true};}
 if(bundle.forecastJobId||bundle.assumptionSetId){const current=await currentBusinessGeneration(ctx,nature);assert(current?.id===bundle.generationId,409,'DECISION_STALE','资料已更新，旧模型或假设方案须重新核查');if(bundle.assumptionSetId){const g=await loadGeneration(ctx,nature,current.payload);await activeAssumptions(ctx,nature,bundle.assumptionSetId,g.id,g.state.asOf,g.state.profile.horizonDays);}}
 const linked=!!(bundle.forecastJobId||bundle.assumptionSetId),guard=linked?forecastPublicationGuard(ctx,nature,bundle.generationId,bundle.assumptionSetId):{sql:'1',args:[]};
 const payload:OperatingDecision={id:'operating-decision-'+crypto.randomUUID(),businessId:ctx.businessId,dataNature:nature,generationId:bundle.generationId,bundleId:body.bundleId,scenario,forecast,...metadata as {reason?:string;title?:string;plan?:ReturnType<typeof decisionPlan>},...(bundle.forecastJobId?{forecastJobId:bundle.forecastJobId}:{}),...(bundle.assumptionSetId?{assumptionSetId:bundle.assumptionSetId}:{}),status:'saved_decision',createdAt:new Date().toISOString()};
 try{await ctx.db.batch([statement(ctx.db,`INSERT INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,parent_id,payload,created_at) SELECT ?,?,?,?,'business_decision',?,?,?,?,? WHERE ${guard.sql}`,payload.id,ctx.businessId,nature,payload.generationId,requestId,requestHash,body.bundleId,await storeBusinessArtifact(ctx,nature,'business_decision',payload),payload.createdAt,...guard.args),linked?statement(ctx.db,"INSERT OR IGNORE INTO audit_events(id,business_id,actor_id,action,resource_id,created_at) SELECT ?,?,?,'business_decision_saved',?,? WHERE EXISTS(SELECT 1 FROM neo_artifacts WHERE id=? AND business_id=?)",'business_decision_saved:'+payload.id,ctx.businessId,ctx.userId,payload.id,payload.createdAt,payload.id,ctx.businessId):businessAudit(ctx,'business_decision_saved',payload.id,payload.createdAt)]);}catch{throw new ApiError(409,'REQUEST_CONFLICT','选择被并发保存，请回读');}
 assert(await first(ctx.db,'SELECT id FROM neo_artifacts WHERE id=?',payload.id),409,'DECISION_STALE','资料或假设在保存时更新，请重新核查');return {...payload,notice:'选择已保存；尚未执行企业经营动作'};
}
export async function recordOperatingExecution(ctx:Context,nature:string,body:Record<string,unknown>){
 assert(typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId)&&typeof body.decisionId==='string'&&['executed','cancelled'].includes(String(body.status)),422,'EXECUTION','需要请求、决策和执行状态');
 assert(ctx.role==='admin',403,'ADMIN_REQUIRED','实际执行由管理员登记并关联凭据');
 const decision=await getOperatingDecision(ctx,nature,body.decisionId);let executionDate:string;try{executionDate=dateOnly(String(body.executionDate));}catch{throw new ApiError(422,'EXECUTION','执行日期无效');}
 const action=Number.isInteger(body.actionIndex)?decision.scenario.actions[Number(body.actionIndex)]:null;
 assert(body.status!=='executed'||action,422,'ACTION','须选择决策中的具体经营动作');
 assert(Number.isSafeInteger(body.quantity)&&Number(body.quantity)>=0&&Number.isSafeInteger(body.costCents)&&Number(body.costCents)>=0,422,'EXECUTION','实际数量与费用须为非负整数');
 assert(Array.isArray(body.proofIds)&&body.proofIds.length<=100&&body.proofIds.every(id=>typeof id==='string'),422,'PROOF','执行凭据须为资料标识列表');
 assert(body.status!=='executed'||body.proofIds.length>0,422,'PROOF','执行完成须关联已导入的实际记录');
 const now=new Date().toISOString(),generationRow=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',decision.generationId,ctx.businessId,nature);assert(generationRow,404,'GENERATION','决策资料不存在');const generation=await loadGeneration(ctx,nature,generationRow.payload);const today=new Intl.DateTimeFormat('en-CA',{timeZone:generation.state.profile.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());assert(executionDate<=today,422,'EXECUTION','不能将未来计划登记为已执行');
 const clean={decisionId:decision.id,actionIndex:body.actionIndex??null,status:body.status,executionDate,quantity:body.quantity,costCents:body.costCents,proofIds:[...new Set(body.proofIds)],proofBasis:'registered_source_records',recordedBy:ctx.userId};
 const digest=await hash(JSON.stringify(clean)),requestId=String(body.requestId);
 const prior=await first<{payload:string;request_hash:string}>(ctx.db,'SELECT payload,request_hash FROM neo_decision_executions WHERE business_id=? AND data_nature=? AND request_id=?',ctx.businessId,nature,requestId);
 if(prior){assert(prior.request_hash===digest,409,'REQUEST_CONFLICT','相同请求已记录不同执行');return {...JSON.parse(prior.payload),reused:true};}
 const epoch=await publicationEpoch(ctx,nature),proofCutoff=new Date().toISOString();
 const proof=await all<{id:string;kind:string;payload:string;known_at:string;business_date:string}>(ctx.db,`SELECT i.id,i.kind,i.payload,i.known_at,i.business_date FROM neo_business_inputs i WHERE i.business_id=? AND i.data_nature=? AND i.id IN(SELECT value FROM json_each(?)) AND ${currentRegisteredInput('i')}`,ctx.businessId,nature,JSON.stringify(body.proofIds),proofCutoff,proofCutoff,proofCutoff,proofCutoff);
 assert(proof.length===new Set(body.proofIds).size&&proof.every(r=>['expense','arrival','production','hotel_capacity'].includes(r.kind)&&r.known_at>=decision.createdAt&&r.business_date===executionDate&&(r.kind==='expense'||r.kind==='hotel_capacity'||JSON.parse(r.payload).status==='completed')&&(!action||JSON.parse(r.payload).entityId===action.entityId&&(r.kind==='expense'||JSON.parse(r.payload).warehouseId===action.warehouseId||action.kind==='hotel_capacity'))),422,'PROOF','凭据须为选择之后接入的、同日发生的本企业实际投入/收货/生产记录');
 if(body.status==='executed'){const typed=proof.map(r=>({...JSON.parse(r.payload),kind:r.kind}));
 const requiredKind=action!.kind==='hotel_capacity'?'hotel_capacity':action!.kind==='production'?'production':'arrival';
 assert(typed.every(r=>r.kind==='expense'||r.kind===requiredKind),422,'ACTION_PROOF','凭据类型须与所选经营动作一致');
 if(action!.kind==='arrival')assert(typed.filter(r=>r.kind==='arrival').every(r=>!r.fromWarehouseId),422,'ARRIVAL_PROOF','外购动作不能使用内部调拨作为收货依据');
 if(action!.kind==='transfer')assert(typed.filter(r=>r.kind==='arrival').every(r=>r.fromWarehouseId===action!.fromWarehouseId),422,'TRANSFER_PROOF','调拨凭据须同时登记方案的来源仓和目的仓，普通到货不能替代调拨证明');
 if(action!.kind==='production')assert(typed.filter(r=>r.kind==='production').every(r=>r.workCenterId===action!.workCenterId),422,'PRODUCTION_PROOF','生产凭据的工作中心须与方案一致');
 const movement=action!.kind==='hotel_capacity'?'hotel_capacity':action!.kind==='production'?'production':'arrival';assert(typed.filter(r=>r.kind===movement).reduce((n,r)=>n+r.quantity,0)===body.quantity,422,'PROOF_TOTAL','执行数量与关联实际记录不一致');const expenses=typed.filter(r=>r.kind==='expense');assert(expenses.length>0||typed.filter(r=>r.kind===movement).every(r=>r.costCents!=null),422,'COST_PROOF','实际投入费用须有明确数值或关联费用凭据，缺失不能当作零');const cost=expenses.length?expenses.reduce((n,r)=>n+r.amountCents,0):typed.reduce((n,r)=>n+(r.costCents??0),0);assert(cost===body.costCents,422,'PROOF_TOTAL','执行费用与关联实际记录不一致');}
 if(body.status==='executed'){const used=await first(ctx.db,`SELECT used.proof_id FROM neo_execution_proofs used JOIN neo_business_inputs old ON old.id=used.proof_id JOIN neo_business_inputs candidate ON candidate.business_id=old.business_id AND candidate.data_nature=old.data_nature AND candidate.source_id=old.source_id AND candidate.record_key=old.record_key WHERE used.business_id=? AND used.data_nature=? AND candidate.id IN(SELECT value FROM json_each(?)) LIMIT 1`,ctx.businessId,nature,JSON.stringify(clean.proofIds));assert(!used,409,'PROOF_REUSED','同一实际凭据及其修订不能重复计入执行；更正后须重新核验原执行');}
 const payload={id:'execution-'+crypto.randomUUID(),...clean,createdAt:now};
 try{await ctx.db.batch([guardPublication(ctx,nature,epoch),businessAudit(ctx,'business_execution_recorded',payload.id,now),statement(ctx.db,'INSERT INTO neo_decision_executions(id,business_id,data_nature,decision_id,request_id,request_hash,payload,created_at) VALUES(?,?,?,?,?,?,?,?)',payload.id,ctx.businessId,nature,decision.id,requestId,digest,JSON.stringify(payload),now),...(body.status==='executed'?clean.proofIds.map(proofId=>statement(ctx.db,'INSERT INTO neo_execution_proofs(business_id,data_nature,proof_id,execution_id) VALUES(?,?,?,?)',ctx.businessId,nature,proofId,payload.id)):[])]);}catch{throw new ApiError(409,'REQUEST_CONFLICT','执行被并发登记，请回读');}
 return payload;
}
export async function verifiedExecutions(ctx:Context,nature:string,rows:Array<{payload:string}>){
 const executions=rows.map(r=>JSON.parse(r.payload)),ids=[...new Set<string>(executions.flatMap(e=>e.proofIds??[]))],cutoff=new Date().toISOString();
 const current=await all<{id:string}>(ctx.db,`SELECT i.id FROM neo_business_inputs i WHERE i.business_id=? AND i.data_nature=? AND i.id IN(SELECT value FROM json_each(?)) AND ${currentRegisteredInput('i')}`,ctx.businessId,nature,JSON.stringify(ids),cutoff,cutoff,cutoff,cutoff),valid=new Set(current.map(r=>r.id));
 return executions.map(e=>({...e,proofVerification:e.status==='executed'?{status:e.proofIds.every((id:string)=>valid.has(id))?'current':'needs_revalidation',invalidProofIds:e.proofIds.filter((id:string)=>!valid.has(id))}:null}));
}
export async function operatingOutcome(ctx:Context,nature:string,id:string){
 const decision=await getOperatingDecision(ctx,nature,id),row=await first<{payload:string}>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',decision.generationId,ctx.businessId,nature);assert(row,404,'GENERATION','原决策资料代次不存在');
 const generation=await loadGeneration(ctx,nature,row.payload),start=plusDays(generation.state.asOf,1),end=plusDays(generation.state.asOf,generation.state.profile.horizonDays);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:generation.state.profile.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const executions=await all<{payload:string}>(ctx.db,'SELECT payload FROM neo_decision_executions WHERE decision_id=? AND business_id=? AND data_nature=? ORDER BY created_at',id,ctx.businessId,nature);
 const verified=await verifiedExecutions(ctx,nature,executions),needsRevalidation=verified.some(r=>r.proofVerification?.status==='needs_revalidation');
 if(today<start)return {decisionId:id,attributionStatus:'not_identified',maturity:'immature',status:needsRevalidation?'needs_revalidation':'waiting',period:{start,end},executions:verified,actual:null,forecast:decision.forecast.totals};
 const actualEnd=today<end?today:end,actual=await readBusinessState(ctx,nature,{asOf:actualEnd,start,end:actualEnd});
 assert(actual.profile.industry===generation.state.profile.industry,409,'UNIT_CHANGED','经营单位变化，不能直接比较');
 const revenueKind=generation.state.profile.industry==='hotel'?'hotel_stay':'order';const originalEntities=new Set(generation.state.inputs.filter(r=>r.kind===revenueKind).map(r=>r.entityId));const scopeChanges=actual.inputs.filter(r=>r.kind===revenueKind&&r.businessDate>=start&&r.businessDate<=actualEnd&&!originalEntities.has(r.entityId)).map(r=>r.entityId);
 const originalChannels=new Set(generation.state.inputs.filter(r=>r.kind===revenueKind).map(r=>JSON.stringify([r.entityId,r.channelId??null]))),channelScopeChanges=actual.inputs.filter(r=>r.kind===revenueKind&&r.businessDate>=start&&r.businessDate<=actualEnd&&!originalChannels.has(JSON.stringify([r.entityId,r.channelId??null]))).map(r=>({entityId:r.entityId,channelId:r.channelId??null}));
 const closed=actualEnd===end,complete=!needsRevalidation&&scopeChanges.length===0&&channelScopeChanges.length===0&&['netRevenueCents','variableCostCents','spendCents','fulfilledUnits'].every(k=>actual.metrics[k]?.value!=null);
 const actualValues={fulfilled:actual.metrics.fulfilledUnits.value,netRevenueCents:actual.metrics.netRevenueCents.value,contributionMarginCents:actual.metrics.contributionMarginCents.value};
 return {decisionId:id,attributionStatus:'not_identified',maturity:closed?'closed':'immature',executionStatus:verified.some(r=>r.status==='executed'&&r.proofVerification?.status!=='needs_revalidation')?'registered_execution':'selected_not_executed',scope:{businessId:ctx.businessId,dataNature:nature,originalGenerationId:decision.generationId,entities:[...originalEntities]},status:needsRevalidation?'needs_revalidation':closed&&complete?'complete':'interim',period:{start,end},observedThrough:actualEnd,scopeChanges:[...new Set(scopeChanges)],channelScopeChanges,executions:verified,actual:actualValues,forecast:decision.forecast.totals,variance:closed&&complete?{fulfilled:actualValues.fulfilled!-decision.forecast.totals.fulfilled!,netRevenueCents:actualValues.netRevenueCents!-decision.forecast.totals.netRevenueCents!,contributionMarginCents:actualValues.contributionMarginCents!-decision.forecast.totals.contributionMarginCents!}:null,evidence:actual.metrics,notice:needsRevalidation?'执行凭据已被更正，需重新核验。':'对照记录用于复盘；没有对照实验，不能将差异归因于经营动作。'};
}

/** Explicitly confirmed observational experience; never labels variance as causal gain. */
export async function confirmOperatingExperience(ctx:Context,nature:string,body:Record<string,unknown>){
 assert(ctx.role==='admin',403,'ADMIN_REQUIRED','复盘经验须由管理员确认');
 assert(typeof body.decisionId==='string'&&typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId)&&body.confirmed===true,422,'EXPERIENCE','需要决策、请求标识和明确确认');
 const decision=await getOperatingDecision(ctx,nature,body.decisionId),outcome=await operatingOutcome(ctx,nature,decision.id);
 const executed=outcome.executions.filter((e:{status:string})=>e.status==='executed');
 const supportStatus=outcome.status==='complete'&&executed.length>0?'supported':'insufficient';
 const payload={id:'experience-'+crypto.randomUUID(),businessId:ctx.businessId,dataNature:nature,generationId:decision.generationId,decisionId:decision.id,version:'decision-experience-v1',supportStatus,status:supportStatus==='supported'?'active':'inactive',confirmedBy:ctx.userId,confirmedAt:new Date().toISOString(),objective:'contribution_margin',scope:{period:outcome.period,entities:[...new Set(decision.forecast.points.map(p=>p.entityId))],channels:[...new Set(decision.forecast.points.map(p=>p.channelId))]},statement:'已登记执行与同范围观察结果仅用于经验复核，不能将经营差异归因于动作。',attribution:'not_identified',dependencyHash:await hash(JSON.stringify({decision,outcome})),outcome,createdAt:new Date().toISOString()};
 const requestId=nature+':'+body.requestId,requestHash=await hash(JSON.stringify([body.decisionId,body.confirmed]));
 const prior=await first<{payload:string;request_hash:string}>(ctx.db,"SELECT payload,request_hash FROM neo_artifacts WHERE business_id=? AND kind='business_experience' AND request_id=?",ctx.businessId,requestId);
 if(prior){assert(prior.request_hash===requestHash,409,'REQUEST_CONFLICT','请求已确认其他决策');return {...await loadBusinessArtifact(ctx,nature,'business_experience',prior.payload),reused:true};}
 await statement(ctx.db,"INSERT INTO neo_artifacts(id,business_id,data_nature,snapshot_id,kind,request_id,request_hash,parent_id,payload,created_at) VALUES(?,?,?,?,'business_experience',?,?,?,?,?)",payload.id,ctx.businessId,nature,decision.generationId,requestId,requestHash,decision.id,await storeBusinessArtifact(ctx,nature,'business_experience',payload),payload.createdAt).run();return payload;
}
