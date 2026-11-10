import {currentBusinessGeneration} from './business-head.ts';
import {shanghaiDay,emergencyDeadline,nextDailyAt} from './knowledge-time.ts';
import {all,first,statement,type Runtime} from './store.ts';
import type {Context} from './auth.ts';
import {hash} from './csv.ts';
import {agentPolicy,automaticMonitorAllowed} from './agent-policy.ts';
import {service,synchronizeOperatingRun,handleAgents} from './agents.ts';
import {operatingReviews} from './business-reviews.ts';
import {loadGeneration} from './generation-storage.ts';
import {enqueueSource,readKnowledgeDocument,scheduleWindow,invalidateKnowledge,confirmedEnterpriseMemories,knowledgeReferenceValidity,type Row} from './knowledge.ts';
import {activePlatformSettings} from './platform-settings.ts';
import {assert} from './errors.ts';
import {aggregateDocumentDisposition,DOCUMENT_DISPOSITION_VERSION} from './document-disposition.ts';

type Dependencies={service:typeof service;read:typeof readKnowledgeDocument};
const defaultDeps:Dependencies={service,read:readKnowledgeDocument};
const context=(runtime:Runtime,businessId:string):Context=>({db:runtime.DB!,runtime,businessId,businessName:businessId,userId:'local-knowledge-monitor',role:'admin'});
export async function monitoringEnabled(ctx:Context,n:string){return !!await first(ctx.db,'SELECT id FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=? AND enabled=1',ctx.businessId,n);}
// References, not a duplicated objective ledger. Every extraction freezes the
// current published profile/configuration version; a caller cannot supply facts.
export async function monitorBasis(ctx:Context,n:string,configuration:Row){
 const latestProfile=await first<Row>(ctx.db,'SELECT id,payload FROM neo_business_profiles WHERE business_id=? AND data_nature=? ORDER BY version DESC LIMIT 1',ctx.businessId,n);
 const profileReference=latestProfile?{id:'profile:'+latestProfile.id,version:latestProfile.id}:null;
 const configurationGaps=profileReference?[]:['enterprise_profile_unavailable'];
 const row=await currentBusinessGeneration(ctx,n);
 if(!row){
  const snapshot=await first<Row>(ctx.db,'SELECT * FROM operating_snapshots WHERE business_id=? AND data_nature=? ORDER BY generated_at DESC,id DESC LIMIT 1',ctx.businessId,n);
  const s=snapshot?JSON.parse(snapshot.payload):null,active=await activePlatformSettings(ctx,n);
  const rows=await confirmedEnterpriseMemories(ctx,n);
  const rules=rows.map(r=>({...JSON.parse(r.payload),id:r.id,version:String(r.version),kind:JSON.parse(r.payload).riskKind??'objective'}));
  return {scope:{sourceKind:'snapshot',snapshotId:s?.id??null,asOf:s?.asOf??null,operatingVersion:s?.id??'unavailable',entities:(s?.domain?.products??s?.data?.materials?.domain?.products??[]).map((p:Row)=>p.id)},configuration:{version:configuration.version??0,profileReference,gaps:configurationGaps,platformVersion:active.id,region:configuration.region??null,competitors:configuration.competitors??[],methodReference:active.id?{id:'configuration:'+active.id,version:active.id}:null,objectives:rules.filter(r=>r.kind==='objective'),constraints:rules.filter(r=>['compliance','safety','fulfillment'].includes(r.kind))}};
 }
 const g=await loadGeneration(ctx,n,row.payload),active=await activePlatformSettings(ctx,n);
 const profile=latestProfile?JSON.parse(latestProfile.payload):g.state.profile as unknown as Row,profileVersion=latestProfile?.id??g.state.profileVersion;
 const confirmed=[{id:'profile:'+profileVersion,version:profileVersion,statement:profile,kind:'objective'}];
 const requested=[...(configuration.objectives??[]),...(configuration.constraints??[])];
 const refs=requested.length?requested.filter((r:Row)=>confirmed.some(x=>x.id===r.id&&x.version===r.version)).map((r:Row)=>confirmed.find(x=>x.id===r.id)!):confirmed;
 const memories=await confirmedEnterpriseMemories(ctx,n);
 const constraints=memories.map(r=>({id:r.id,version:String(r.version),...JSON.parse(r.payload)})).filter(r=>['compliance','safety','fulfillment'].includes(r.riskKind)).map(r=>({...r,kind:r.riskKind}));
 return {scope:{operatingVersion:g.sourceKey,generationId:g.id,asOf:g.state.asOf,period:g.state.period,entities:[...new Set(g.state.inputs.map(i=>i.entityId))]},configuration:{version:configuration.version??0,profileReference,gaps:configurationGaps,platformVersion:active.id,methodReference:active.id?{id:'configuration:'+active.id,version:active.id}:null,region:profile.region||null,competitors:profile.competitors??[],objectives:refs.filter(x=>x.kind==='objective'),constraints}};
}
function chunks(paragraphs:Row[]){const result:Row[][]=[];let current:Row[]=[],bytes=0;for(const p of paragraphs){const size=new TextEncoder().encode(p.text).length;if(size>14000)throw Error('单段原文超过模型窗口，需要分节来源');if(current.length&&(bytes+size>14000||current.length>=60)){result.push(current);current=[];bytes=0;}current.push({index:p.index,text:p.text});bytes+=size;}if(current.length)result.push(current);assert(result.length<=24,422,'DOCUMENT_WINDOW','文档分节超出单任务范围，覆盖记为部分');return result;}
async function updateTask(ctx:Context,task:Row,owner:string,status:string,payload:Row,result:unknown=null,error:string|null=null,retryAt:string|null=null){
 const changed=await statement(ctx.db,'UPDATE neo_monitor_tasks SET status=?,payload=?,result=?,error=?,retry_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status=?',status,JSON.stringify(payload),result?JSON.stringify(result):null,error,retryAt,new Date().toISOString(),task.id,owner,'running').run();return !!changed.meta.changes;
}
export async function saveMonitorResult(ctx:Context,n:string,task:Row,doc:Row,result:Row,basis:Row){
 assert(result.documentId===doc.id&&result.documentVersion===doc.content_hash&&result.semanticValidation?.status==='verified'&&Array.isArray(result.claims),502,'CLAIMS','监控结果未经校验或版本错配');
 const currentSource=await first<Row>(ctx.db,'SELECT version,enabled FROM neo_knowledge_sources WHERE id=? AND business_id=? AND data_nature=?',doc.source_id,ctx.businessId,n);assert(currentSource?.enabled&&currentSource.version===doc.source_version,409,'SOURCE_CHANGED','读取后来源被修改，禁止发布旧版本主张');
 const now=new Date().toISOString(),paragraphs=JSON.parse(doc.paragraphs),payload=JSON.parse(task.payload);const commands:D1PreparedStatement[]=[];
 if(payload.documentDispositionVersion){
  assert(payload.documentDispositionVersion===DOCUMENT_DISPOSITION_VERSION&&result.documentDisposition?.coverage.complete,502,'DISPOSITION','文档筛选尚未完成全部分节');
  const subscription=await first<Row>(ctx.db,'SELECT configuration_version FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?',ctx.businessId,n);
  assert((subscription?.configuration_version??0)===payload.configurationVersion,409,'CONFIGURATION_CHANGED','观察配置已改变，保留原筛选记录但不发布');
  for(const r of result.documentDisposition.configurationReferences)assert((await knowledgeReferenceValidity(ctx,n,r.id,String(r.version))).status==='current',409,'CONFIGURATION_CHANGED','筛选所用企业配置或规则已改变');
 }
 for(const raw of result.claims){
  assert(raw.paragraphIndices?.every((i:number)=>paragraphs.some((p:Row)=>p.index===i)),502,'CLAIMS','原文定位无效');
  const bodyHash=await hash(JSON.stringify([raw.statement,raw.region,raw.effectiveAt,raw.expiresAt,raw.limitations,raw.entities]));
  const id='claim-'+await hash([ctx.businessId,n,doc.original_id,bodyHash].join('|'));
  const versionHash=await hash(JSON.stringify([bodyHash,doc.content_hash,doc.source_version,raw.temporalUse,raw.applicability,raw.applicabilityVerified,raw.supportStatus,raw.relations,raw.deadline,raw.urgency,raw.classification,basis.configuration]));
  const supported=raw.supportStatus==='supported',state=supported?'active':'candidate',claim={...raw,id,originalId:doc.original_id,bodyHash,sourceRead:true,state};
  const old=await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_claims WHERE id=?',id);
  if(!old)commands.push(statement(ctx.db,"INSERT OR IGNORE INTO neo_knowledge_claims SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM neo_monitor_tasks WHERE id=? AND status='running' AND lease_owner=?)",id,ctx.businessId,n,doc.id,versionHash,state,JSON.stringify(claim),now,now,task.id,task.lease_owner));
  else if(supported&&(['candidate','superseded'].includes(old.state)||old.body_hash!==versionHash||old.document_id!==doc.id)){if(old.body_hash!==versionHash)await invalidateKnowledge(ctx,n,id,old.body_hash,'claim_applicability_or_time_changed');commands.push(statement(ctx.db,"UPDATE neo_knowledge_claims SET state='active',payload=?,updated_at=?,document_id=?,body_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM neo_monitor_tasks WHERE id=? AND status='running' AND lease_owner=?)",JSON.stringify(claim),now,doc.id,versionHash,id,task.id,task.lease_owner));}
  const eventKey=await hash(JSON.stringify([doc.original_id,versionHash,basis.scope.operatingVersion,basis.scope.entities,payload.configurationVersion,await hash(JSON.stringify(basis.configuration))]));
  const event={scope:{businessId:ctx.businessId,dataNature:n,...basis.scope},entities:raw.entities,claimId:id,claimVersion:versionHash,documentId:doc.id,documentVersion:doc.content_hash,sourceId:doc.source_id,sourceVersion:String(doc.source_version),relationVersions:[...basis.configuration.objectives,...basis.configuration.constraints].filter((r:Row)=>raw.relations.includes(r.id)).map((r:Row)=>({id:r.id,version:String(r.version)})),support:raw.support,relations:raw.relations,impact:raw.impact,urgency:raw.urgency,actionability:raw.actionability,classification:raw.classification,reason:raw.reason,applicabilityVerified:raw.applicabilityVerified===true,supportStatus:raw.supportStatus,deadline:raw.deadline,emergencyEligible:raw.emergencyEligible===true,temporalUse:raw.temporalUse,configurationVersion:payload.configurationVersion,configurationReferences:[basis.configuration.profileReference,basis.configuration.methodReference].filter(Boolean),configurationGaps:basis.configuration.gaps??[],discoveredAt:now,occurredAt:raw.effectiveAt??doc.published_at??null};
  // Only new information is alertable. Reposts/share URLs of the same original
  // and unchanged bodies never create a second independent confirmation.
  commands.push(statement(ctx.db,"INSERT OR IGNORE INTO neo_knowledge_events SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM neo_monitor_tasks WHERE id=? AND status='running' AND lease_owner=?)",'event-'+eventKey,ctx.businessId,n,eventKey,supported?raw.classification:'research',old&&old.state!=='candidate'&&old.body_hash===versionHash?'observed':'pending',JSON.stringify(event),event.occurredAt,now,task.id,task.lease_owner));
 }
 const replaces=result.claims.length>0&&result.claims.every((c:Row)=>c.supportStatus==='supported');
 const previous=replaces?await all<Row>(ctx.db,"SELECT id,content_hash FROM neo_knowledge_documents WHERE source_id=? AND business_id=? AND data_nature=? AND id!=? AND json_extract(coverage,'$.pendingReplacement')=?",doc.source_id,ctx.businessId,n,doc.id,doc.id):[];
 const oldClaims:Row[]=[];
 for(const previousDoc of previous){oldClaims.push(...await all<Row>(ctx.db,'SELECT id,body_hash FROM neo_knowledge_claims WHERE document_id=?',previousDoc.id));commands.push(statement(ctx.db,"UPDATE neo_knowledge_claims SET state='superseded',updated_at=? WHERE document_id=? AND state='active' AND EXISTS(SELECT 1 FROM neo_monitor_tasks WHERE id=? AND status='running' AND lease_owner=?)",now,previousDoc.id,task.id,task.lease_owner));commands.push(statement(ctx.db,"UPDATE neo_knowledge_documents SET state='superseded' WHERE id=? AND EXISTS(SELECT 1 FROM neo_monitor_tasks WHERE id=? AND status='running' AND lease_owner=?)",previousDoc.id,task.id,task.lease_owner));}
 commands.push(statement(ctx.db,"UPDATE neo_knowledge_documents SET state=?,coverage=json_remove(coverage,'$.pendingReplacement') WHERE id=? AND EXISTS(SELECT 1 FROM neo_monitor_tasks WHERE id=? AND status='running' AND lease_owner=?)",replaces?'active':'candidate',doc.id,task.id,task.lease_owner));
 if(commands.length)await ctx.db.batch(commands);
 for(const previousDoc of previous)await invalidateKnowledge(ctx,n,previousDoc.id,previousDoc.content_hash,'source_body_replaced');
 for(const c of oldClaims)await invalidateKnowledge(ctx,n,c.id,c.body_hash,'source_body_replaced');
}
export async function processMonitorTask(ctx:Context,task:Row,deps=defaultDeps,now=new Date()){
 const owner=crypto.randomUUID(),stamp=now.toISOString();
 const claim=await statement(ctx.db,"UPDATE neo_monitor_tasks SET status='running',lease_owner=?,lease_until=?,attempts=attempts+CASE WHEN status='pending' THEN 1 ELSE 0 END,updated_at=? WHERE id=? AND (status IN ('pending','waiting') OR status='deferred' AND retry_at<=? OR status='running' AND lease_until<?)",owner,new Date(now.getTime()+180000).toISOString(),stamp,task.id,stamp,stamp).run();if(!claim.meta.changes)return;
 const n=task.data_nature,payload=JSON.parse(task.payload);
 try{
  const source=await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_sources WHERE id=? AND business_id=? AND data_nature=?',task.source_id,ctx.businessId,n);
  assert(source?.enabled&&source.version===payload.sourceVersion,409,'SOURCE_CHANGED','来源已停用或版本改变');
  if(!payload.documents){
   payload.basis=await monitorBasis(ctx,n,{...payload.configuration,version:payload.configurationVersion});
   const settings=JSON.parse(source.payload),urls=[source.url,...settings.pages],documents:Row[]=[],gaps:string[]=[...payload.window.gaps];
   for(const url of [...new Set(urls)]){
    try{
     const loaded=await deps.read(url,now,async()=>{const r=await deps.service(ctx,'/knowledge-source',{url,allowedHosts:settings.allowedHosts});return new Response(String(r.body),{headers:{'content-type':String(r.contentType)}});},settings.allowedHosts);
     const originalId=settings.originalId??source.url,docId='document-'+await hash(JSON.stringify([source.id,source.version,url,loaded.contentHash]));
     const coverage={...loaded.coverage,requestWindow:payload.window,scheduleWindow:{day:payload.window.day,start:payload.window.scheduleStart},page:url,pagesRequested:urls.length,publishedAt:loaded.publishedAt,retrievedAt:loaded.retrievedAt};
     const previousDocs=await all<Row>(ctx.db,"SELECT id,content_hash FROM neo_knowledge_documents WHERE source_id=? AND business_id=? AND data_nature=? AND id!=? AND json_extract(coverage,'$.page')=?",source.id,ctx.businessId,n,docId,url);
     for(const previous of previousDocs){await statement(ctx.db,"UPDATE neo_knowledge_documents SET coverage=json_set(coverage,'$.pendingReplacement',?) WHERE id=? AND state!='superseded'",docId,previous.id).run();await invalidateKnowledge(ctx,n,previous.id,previous.content_hash,'conflict');const oldClaims=await all<Row>(ctx.db,'SELECT id,body_hash FROM neo_knowledge_claims WHERE document_id=? AND state=?',previous.id,'active');for(const c of oldClaims)await invalidateKnowledge(ctx,n,c.id,c.body_hash,'conflict');}
     await statement(ctx.db,'INSERT OR IGNORE INTO neo_knowledge_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',docId,ctx.businessId,n,source.id,source.version,loaded.contentHash,originalId,loaded.rawText,JSON.stringify(loaded.paragraphs),loaded.publishedAt,loaded.retrievedAt,JSON.stringify(coverage),'candidate').run();
     const observedDoc=(await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_documents WHERE id=?',docId))!;
     const doc=(await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_documents WHERE business_id=? AND data_nature=? AND original_id=? AND content_hash=? ORDER BY rowid LIMIT 1',ctx.businessId,n,originalId,loaded.contentHash))??observedDoc;
     const datedClaims=await all<Row>(ctx.db,'SELECT payload FROM neo_knowledge_claims WHERE document_id=?',doc.id);
     const reached=datedClaims.flatMap(r=>{const p=JSON.parse(r.payload);return [p.effectiveAt,p.expiresAt].filter(v=>v&&v<=shanghaiDay(new Date(payload.window.requestEnd)));}).sort();const temporalPhase=reached.at(-1)??null;
     await first(ctx.db,"SELECT id FROM neo_knowledge_claims WHERE document_id=? AND state='candidate' LIMIT 1",doc.id);
     const prior=await first(ctx.db,"SELECT id FROM neo_monitor_tasks WHERE id!=? AND business_id=? AND data_nature=? AND status='completed' AND json_extract(payload,'$.configurationVersion')=? AND json_extract(payload,'$.basis')=? AND EXISTS(SELECT 1 FROM json_each(payload,'$.documents') WHERE json_extract(value,'$.id')=? AND json_extract(value,'$.temporalPhase') IS ?)",task.id,ctx.businessId,n,payload.configurationVersion,JSON.stringify(payload.basis),doc.id,temporalPhase);
     documents.push({id:doc.id,observedDocumentId:docId,temporalPhase,unchanged:!!prior,chunks:chunks(JSON.parse(doc.paragraphs))});gaps.push(...loaded.coverage.gaps);
    }catch(e){gaps.push('read_failure:'+url+':'+String(e).slice(0,120));}
   }
   if(!documents.length)throw Error('没有成功读取原文；successful cursor 保持不变：'+gaps.join(','));
   payload.documents=documents;payload.gaps=gaps;payload.partial=gaps.some(g=>g.startsWith('read_failure'));
   // Preserve prepared bodies and fixed job IDs before any external dispatch.
   await statement(ctx.db,"UPDATE neo_monitor_tasks SET payload=? WHERE id=? AND lease_owner=? AND status='running'",JSON.stringify(payload),task.id,owner).run();
  }
  let pending=false,deferred=false;
  for(const d of payload.documents){
   if(d.unchanged)continue;const doc=(await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_documents WHERE id=?',d.id))!;
   d.runs??=[];
   for(let i=0;i<d.chunks.length;i++){
    const runId=d.runs[i]?.id??'knowledge-'+await hash(JSON.stringify([ctx.businessId,n,d.id,i,...(d.retryRevision?[d.retryRevision]:[]),d.temporalPhase??null,payload.configurationVersion,await hash(JSON.stringify(payload.basis))]));
    if(d.runs[i]?.status==='completed'&&d.runs[i].result)continue;
    // Do not automatically resubmit failed/cancelled/uncertain model calls.
    const job={id:runId,businessId:ctx.businessId,dataNature:n,purpose:'knowledge',taskType:'DOCUMENT',document:{id:doc.id,version:doc.content_hash,sourceId:doc.source_id,sourceVersion:doc.source_version,originalId:doc.original_id,publishedAt:doc.published_at,retrievedAt:doc.retrieved_at,paragraphs:d.chunks[i]},...payload.basis,configuration:{...payload.basis.configuration,evaluationAt:payload.window.requestEnd,evaluationTimezone:'Asia/Shanghai'}};
    if(payload.documentDispositionVersion)Object.assign(job,{documentDispositionVersion:payload.documentDispositionVersion});
    if(!await first(ctx.db,"SELECT id FROM neo_monitor_tasks WHERE id=? AND status='running' AND lease_owner=?",task.id,owner))return;
    const existingRun=d.runs[i];
    if(!existingRun){d.runs[i]={id:runId,status:'dispatching'};await statement(ctx.db,"UPDATE neo_monitor_tasks SET payload=? WHERE id=? AND status='running' AND lease_owner=?",JSON.stringify(payload),task.id,owner).run();}
    // A frozen receipt, including uncertain dispatch, is observed only. Missing
    // or unknown old work must not become a new paid submission for this field.
    const run=existingRun?await deps.service(ctx,`/runs/${encodeURIComponent(runId)}`):await deps.service(ctx,'/knowledge-runs',job);
    if(!await first(ctx.db,"SELECT id FROM neo_monitor_tasks WHERE id=? AND status='running' AND lease_owner=?",task.id,owner)){await deps.service(ctx,`/runs/${runId}/cancel`,{});return;}d.runs[i]={id:runId,status:run.status,observability:run.observability??null};
    if(run.status==='completed'){d.runs[i].result=run.result;}
    else if(run.status==='failed'||run.status==='cancelled')throw Error('模型任务 '+runId+' '+run.status+'：'+String(run.error??''));
    else if(run.status==='deferred'){pending=true;deferred=true;}else pending=true;
    if(payload.documentDispositionVersion){const disposition=aggregateDocumentDisposition(doc,d,payload.basis);await statement(ctx.db,"UPDATE neo_knowledge_documents SET coverage=json_set(coverage,'$.documentDisposition',json(?)) WHERE id=? AND EXISTS(SELECT 1 FROM neo_monitor_tasks WHERE id=? AND status='running' AND lease_owner=?)",JSON.stringify(disposition),doc.id,task.id,owner).run();}
    // One new chunk dispatch per pump tick keeps interactive service responsive.
    if(pending)break;
   }if(pending)break;
   // Publish only after every chunk is available. A later chunk failure must
   // not partially replace the last valid document.
   await saveMonitorResult(ctx,n,{...task,lease_owner:owner,payload:JSON.stringify(payload)},doc,{documentId:doc.id,documentVersion:doc.content_hash,semanticValidation:{status:'verified'},...(payload.documentDispositionVersion?{documentDisposition:aggregateDocumentDisposition(doc,d,payload.basis)}:{}),claims:d.runs.flatMap((r:Row)=>{assert(r.result?.semanticValidation?.status==='verified'&&r.result.documentId===doc.id&&r.result.documentVersion===doc.content_hash,502,'CLAIMS','分节结果未经验证');return r.result.claims;})},payload.basis);
  }
  if(pending){await updateTask(ctx,task,owner,deferred?'deferred':'waiting',payload,null,null,deferred?new Date(Date.parse(payload.window.day+'T01:00:00Z')+86400000).toISOString():null);return;}
  const status=payload.partial?'partial':'completed';
  const finished=await updateTask(ctx,task,owner,status,payload,{documents:payload.documents.map((d:Row)=>d.id),gaps:payload.gaps,actualSourceCoverage:'current_observation_only',lastSuccess:payload.partial?null:stamp});
  if(!finished)return;
  if(!payload.partial){
   await statement(ctx.db,"UPDATE neo_knowledge_sources SET payload=json_set(payload,'$.lastSuccessAt',?),updated_at=? WHERE id=? AND business_id=? AND data_nature=?",stamp,stamp,source.id,ctx.businessId,n).run();
   const cursor=await first<Row>(ctx.db,"SELECT MIN(json_extract(payload,'$.lastSuccessAt')) cursor,COUNT(*) total,COUNT(json_extract(payload,'$.lastSuccessAt')) successes FROM neo_knowledge_sources WHERE business_id=? AND data_nature=? AND enabled=1 AND kind!='business'",ctx.businessId,n);
   if(cursor?.total===cursor?.successes)await statement(ctx.db,'UPDATE neo_monitor_subscriptions SET last_success_at=?,updated_at=? WHERE business_id=? AND data_nature=?',cursor?.cursor??null,stamp,ctx.businessId,n).run();
  }
  await statement(ctx.db,'INSERT OR IGNORE INTO neo_knowledge_audit VALUES(?,?,?,?,?,?,?,?)','audit-'+task.id,ctx.businessId,n,source.id,'monitor_'+status,payload.operator??ctx.userId,JSON.stringify({taskId:task.id,sourceVersion:source.version,documentIds:payload.documents.map((d:Row)=>d.id),gaps:payload.gaps}),stamp).run();
 }catch(e){await updateTask(ctx,task,owner,'failed',payload,null,String(e).slice(0,1000));}
}
export async function requestKnowledgeRecheck(ctx:Context,n:string,task:Row,documentId:string,requestId:string,now=new Date()){
 assert(task.status==='completed',409,'RECHECK_STATE','仅已完成且结论未解决的任务可显式重核；未知计费不能重发');
 const previous=JSON.parse(task.payload),entry=previous.documents?.find((d:Row)=>d.id===documentId);
 assert(entry&&entry.runs?.length&&entry.runs.every((r:Row)=>r.status==='completed'),409,'RECHECK_STATE','必须已有确定完成的抽取记录');
 const id='monitor-recheck-'+await hash([ctx.businessId,n,requestId].join('|'));
 const replay=await first<Row>(ctx.db,'SELECT * FROM neo_monitor_tasks WHERE id=?',id);if(replay)return replay;
 const doc=await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_documents WHERE id=? AND business_id=? AND data_nature=?',documentId,ctx.businessId,n);
 const disposition=doc?JSON.parse(doc.coverage).documentDisposition:null;
 assert(doc&&(await first(ctx.db,"SELECT id FROM neo_knowledge_claims WHERE document_id=? AND state='candidate' LIMIT 1",documentId)||disposition&&disposition.supportStatus!=='supported'),409,'RECHECK_RESOLVED','只有未解决主张或未验证筛选理由可以显式重核');
 const blocking=await first(ctx.db,"SELECT id FROM neo_monitor_tasks WHERE business_id=? AND data_nature=? AND status NOT IN ('completed','partial') AND EXISTS(SELECT 1 FROM json_each(payload,'$.documents') WHERE json_extract(value,'$.id')=?)",ctx.businessId,n,documentId);
 assert(!blocking,409,'RECHECK_UNCERTAIN','已有未完成、失败或未知计费任务，禁止另起重核');
 const revision=Number(JSON.parse(doc.coverage).recheckRevision??0);assert(revision<2,409,'RECHECK_LIMIT','同一原文版本最多两次显式重核');
 const basis=await monitorBasis(ctx,n,{...previous.configuration,version:previous.configurationVersion});
 const payload={...previous,basis,requestId,manual:true,operator:ctx.userId,window:scheduleWindow(now,null),documents:[{...entry,unchanged:false,retryRevision:revision+1,runs:[]}],gaps:['explicit_bounded_unresolved_recheck'],partial:false};
 await ctx.db.batch([
  statement(ctx.db,"UPDATE neo_knowledge_documents SET coverage=json_set(coverage,'$.recheckRevision',?,'$.recheckRequestId',?) WHERE id=? AND COALESCE(json_extract(coverage,'$.recheckRevision'),0)=?",revision+1,requestId,documentId,revision),
  statement(ctx.db,"INSERT OR IGNORE INTO neo_monitor_tasks(id,business_id,data_nature,source_id,dedupe_key,status,payload,created_at,updated_at) SELECT ?,?,?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM neo_knowledge_documents WHERE id=? AND json_extract(coverage,'$.recheckRevision')=? AND json_extract(coverage,'$.recheckRequestId')=?)",id,ctx.businessId,n,doc.source_id,id,JSON.stringify(payload),now.toISOString(),now.toISOString(),documentId,revision+1,requestId),
 ]);
 const created=await first<Row>(ctx.db,'SELECT * FROM neo_monitor_tasks WHERE id=?',id);assert(created,409,'RECHECK_RACE','原文重核版本已被另一请求保留');return created;
}
export async function expireKnowledge(ctx:Context,n:string,now=new Date()){
 const rows=await all<Row>(ctx.db,"SELECT id,body_hash version FROM neo_knowledge_claims WHERE business_id=? AND data_nature=? AND state='active' AND json_extract(payload,'$.expiresAt')<? UNION ALL SELECT id,CAST(version AS TEXT) version FROM neo_enterprise_memories WHERE business_id=? AND data_nature=? AND state='active' AND json_extract(payload,'$.expiresAt')<?",ctx.businessId,n,shanghaiDay(now),ctx.businessId,n,shanghaiDay(now));
 for(const r of rows){await ctx.db.batch([statement(ctx.db,"UPDATE neo_knowledge_claims SET state='expired',updated_at=? WHERE id=?",now.toISOString(),r.id),statement(ctx.db,"UPDATE neo_enterprise_memories SET state='expired',updated_at=? WHERE id=?",now.toISOString(),r.id)]);await invalidateKnowledge(ctx,n,r.id,r.version,'expired');}
}
async function currentMonitorEvent(ctx:Context,n:string,e:Row,sub:Row,now:Date){
 const profile=await first<Row>(ctx.db,'SELECT id FROM neo_business_profiles WHERE business_id=? AND data_nature=? ORDER BY version DESC LIMIT 1',ctx.businessId,n);
 const p=JSON.parse(e.payload),refs=[{id:p.claimId,version:p.claimVersion},{id:p.documentId,version:p.documentVersion},{id:p.sourceId,version:p.sourceVersion},...(p.relationVersions??[]),...(p.configurationReferences??[])];
 const hasCurrentProfile=!profile||(p.configurationReferences??[]).some((r:Row)=>(r.id==='profile:'+profile.id||r.id===profile.id)&&r.version===profile.id);
 return hasCurrentProfile&&p.configurationVersion===sub.configuration_version&&p.supportStatus==='supported'&&p.applicabilityVerified&&p.relations?.length&&p.relations.every((id:string)=>(p.relationVersions??[]).some((r:Row)=>r.id===id))&&refs.every(r=>r.id&&r.version)&&!(await Promise.all(refs.map(r=>knowledgeReferenceValidity(ctx,n,r.id,String(r.version),now)))).some(r=>r.status!=='current');
}
async function reservedEvents(ctx:Context,n:string,record:Row){
 const ids:string[]=JSON.parse(record.event_ids);const events:Row[]=[];
 for(const id of ids){const e=await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_events WHERE id=? AND business_id=? AND data_nature=?',id,ctx.businessId,n);if(e)events.push(e);}
 return events;
}
async function staleReview(ctx:Context,record:Row,events:Row[]){
 await ctx.db.batch([statement(ctx.db,"UPDATE neo_monitor_reviews SET status='stale' WHERE id=?",record.id),...events.map(e=>statement(ctx.db,"UPDATE neo_knowledge_events SET state='stale',payload=json_set(payload,'$.currentValidity','requires_recheck') WHERE id=?",e.id))]);
}
async function dispatchReservedReview(ctx:Context,n:string,record:Row,selected:Row[],now:Date){
 const id=record.id,kind=record.kind,day=record.day;
 // The queue request ID is durable before any HTTP. Recover both crash
 // windows: no run yet, and run created but review.run_id not bound yet.
 const existing=await first<Row>(ctx.db,'SELECT id,snapshot_id FROM neo_runs WHERE business_id=? AND data_nature=? AND request_id IN (?,?)',ctx.businessId,n,id,'operating-request:'+id);
 let run:Row;
 if(existing)run=await synchronizeOperatingRun(ctx,n,existing.snapshot_id,existing.id);
 else{
  const generation=await currentBusinessGeneration(ctx,n);
  const latest=generation??await first<Row>(ctx.db,'SELECT id FROM operating_snapshots WHERE business_id=? AND data_nature=? ORDER BY generated_at DESC,id DESC LIMIT 1',ctx.businessId,n);if(!latest)return;
  const metadata={id,kind,day,eventIds:JSON.parse(record.event_ids),...(kind==='emergency'?{validUntil:selected.map(e=>JSON.parse(e.payload).deadline).sort((a,b)=>Date.parse(a)-Date.parse(b))[0],nextDailyAt:nextDailyAt(now).toISOString()}: {})};
  if(generation)run=await operatingReviews(ctx,n,latest.id,true,id,kind==='emergency'?{question:'仅核查已支持且适用的紧急履约或安全合规约束，保留缺口，不执行经营动作。',role:'supply'}:undefined,kind==='emergency'?{maxTokens:null,maxModelCalls:null}:undefined,metadata);
  else{const request=new Request('http://localhost/api/v1/agent-runs',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({snapshotId:latest.id,dataNature:n,mode:kind==='emergency'?'supply':'joint',purpose:'review',taskType:'REVIEW',requestId:id,question:kind==='emergency'?'仅核查已支持且适用的紧急履约或安全合规约束，保留缺口。':'综合本轮已支持的重要变化，完成三专业与联合研判。',...(kind==='emergency'?{budget:{maxTokens:null,maxModelCalls:null}}:{})})});const response=await handleAgents(request,ctx,['agent-runs'],undefined,undefined,true,metadata);assert(response,503,'REVIEW','自动研判未创建');run=await response.json();assert(response.ok,503,'REVIEW','自动研判未创建');}
 }
 await ctx.db.batch([statement(ctx.db,'UPDATE neo_monitor_reviews SET status=?,run_id=? WHERE id=?',run.status,'id' in run?run.id:run.runId,id),...selected.map(e=>statement(ctx.db,"UPDATE neo_knowledge_events SET state='review_queued' WHERE id=?",e.id))]);
}
export async function reviewImportantChanges(ctx:Context,n:string,now=new Date()){
 const sub=await first<Row>(ctx.db,'SELECT * FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=? AND enabled=1',ctx.businessId,n);if(!sub||!automaticMonitorAllowed(ctx.runtime,ctx.businessId))return;
 const day=scheduleWindow(now,null).day;
 const unbound=await all<Row>(ctx.db,"SELECT r.* FROM neo_monitor_reviews r JOIN neo_monitor_admissions a ON a.review_id=r.id WHERE r.business_id=? AND r.data_nature=? AND r.run_id IS NULL AND r.status='pending' ORDER BY r.day,r.kind,r.slot",ctx.businessId,n);
 for(const record of unbound){const selected=await reservedEvents(ctx,n,record);const valid=record.day===day&&selected.length===JSON.parse(record.event_ids).length&&selected.length>0&&(await Promise.all(selected.map(e=>currentMonitorEvent(ctx,n,e,sub,now)))).every(Boolean)&&(record.kind!=='emergency'||selected.every(e=>emergencyDeadline(JSON.parse(e.payload).deadline,now)));
  if(!valid){await staleReview(ctx,record,selected);continue;}
  await dispatchReservedReview(ctx,n,record,selected,now);
 }
 const runningReviews=await all<Row>(ctx.db,"SELECT m.id,m.run_id,r.snapshot_id FROM neo_monitor_reviews m JOIN neo_runs r ON r.id=m.run_id WHERE m.business_id=? AND m.data_nature=? AND m.status IN ('pending','queued','running','pending_dispatch','deferred')",ctx.businessId,n);
 for(const record of runningReviews){const run=await synchronizeOperatingRun(ctx,n,record.snapshot_id,record.run_id);await statement(ctx.db,'UPDATE neo_monitor_reviews SET status=? WHERE id=?',run.status,record.id).run();}
 const events=await all<Row>(ctx.db,"SELECT * FROM neo_knowledge_events WHERE business_id=? AND data_nature=? AND state IN ('pending','pending_next_day') AND classification='affects_assessment' ORDER BY discovered_at,id",ctx.businessId,n);
 if(!events.length)return;
 const established:Row[]=[];
 for(const e of events){if(await currentMonitorEvent(ctx,n,e,sub,now))established.push(e);else await statement(ctx.db,"UPDATE neo_knowledge_events SET state='stale',payload=json_set(payload,'$.currentValidity','requires_recheck') WHERE id=?",e.id).run();}if(!established.length)return;
 const prior=await first<Row>(ctx.db,"SELECT * FROM neo_monitor_admissions WHERE business_id=? AND day=? AND kind='full'",ctx.businessId,day);
 const emergencies=established.filter(e=>{const p=JSON.parse(e.payload);return p.emergencyEligible&&emergencyDeadline(p.deadline,now);});
 let kind='full',slot=0,selected=established;
 if(prior){kind='emergency';selected=emergencies;if(!selected.length){await ctx.db.batch(established.map(e=>statement(ctx.db,"UPDATE neo_knowledge_events SET state='pending_next_day' WHERE id=?",e.id)));return;}
  const used=await all<Row>(ctx.db,"SELECT a.slot,r.event_ids FROM neo_monitor_admissions a JOIN neo_monitor_reviews r ON r.id=a.review_id WHERE a.business_id=? AND a.day=? AND a.kind='emergency'",ctx.businessId,day);const already=new Set(used.flatMap(r=>JSON.parse(r.event_ids)));selected=selected.filter(e=>!already.has(e.id));slot=used.length;
  if(!selected.length||slot>=JSON.parse(sub.payload).emergencyMaxPerDay)return;
 }
 const generation=await currentBusinessGeneration(ctx,n);
 const latest=generation??await first<Row>(ctx.db,'SELECT id FROM operating_snapshots WHERE business_id=? AND data_nature=? ORDER BY generated_at DESC,id DESC LIMIT 1',ctx.businessId,n);if(!latest)return;
 const id='monitor-review-'+await hash([ctx.businessId,n,day,kind,slot].join('|'));
 await ctx.db.batch([
  statement(ctx.db,'INSERT OR IGNORE INTO neo_monitor_admissions VALUES(?,?,?,?,?,?,?)',ctx.businessId,day,kind,slot,id,n,now.toISOString()),
  statement(ctx.db,"INSERT OR IGNORE INTO neo_monitor_reviews SELECT ?,?,?,?,?,?,'pending',NULL,?,? WHERE EXISTS(SELECT 1 FROM neo_monitor_admissions WHERE business_id=? AND day=? AND kind=? AND slot=? AND review_id=?)",id,ctx.businessId,n,day,kind,slot,JSON.stringify(selected.map(e=>e.id)),now.toISOString(),ctx.businessId,day,kind,slot,id),
 ]);
 const admission=await first<Row>(ctx.db,'SELECT review_id FROM neo_monitor_admissions WHERE business_id=? AND day=? AND kind=? AND slot=?',ctx.businessId,day,kind,slot);
 if(admission?.review_id!==id){await ctx.db.batch(selected.map(e=>statement(ctx.db,"UPDATE neo_knowledge_events SET state='pending_next_day' WHERE id=?",e.id)));return;}
 const record=(await first<Row>(ctx.db,'SELECT * FROM neo_monitor_reviews WHERE id=?',id))!;
 await dispatchReservedReview(ctx,n,record,await reservedEvents(ctx,n,record),now);
}
export function startKnowledgeMonitorPump(runtime:Runtime,intervalMs=5000,deps=defaultDeps){
 let stopped=false,running=false;
 const tick=async(now=new Date())=>{if(stopped||running||!runtime.DB||runtime.agentExecutionMode==='offline'||runtime.agentExecutionMode==='disabled')return;running=true;
  try{
   const subscriptions=await all<Row>(runtime.DB,'SELECT * FROM neo_monitor_subscriptions WHERE enabled=1 ORDER BY business_id,data_nature');
   for(const sub of subscriptions){if(stopped)break;const ctx=context(runtime,sub.business_id);if(!automaticMonitorAllowed(runtime,sub.business_id))continue;await expireKnowledge(ctx,sub.data_nature,now);const w=scheduleWindow(now,sub.last_schedule_at);
    if(w.due){await enqueueBusinessObservation(ctx,sub.data_nature,sub,now);const sources=await all<Row>(runtime.DB,"SELECT * FROM neo_knowledge_sources WHERE business_id=? AND data_nature=? AND enabled=1 AND kind!='business' ORDER BY id LIMIT 100",sub.business_id,sub.data_nature);for(const source of sources)await enqueueSource(ctx,sub.data_nature,source,w.day,now);await statement(runtime.DB,'UPDATE neo_monitor_subscriptions SET last_schedule_at=?,updated_at=? WHERE id=?',now.toISOString(),now.toISOString(),sub.id).run();}
   }
   const tasks=await all<Row>(runtime.DB,"SELECT * FROM neo_monitor_tasks WHERE status IN ('pending','waiting') OR status='deferred' AND retry_at<=? OR status='running' AND lease_until<? ORDER BY updated_at,id LIMIT 2",now.toISOString(),now.toISOString());
   for(const task of tasks){if(stopped)break;const ctx=context(runtime,task.business_id);if(!agentPolicy(runtime,task.business_id).marketSearchAllowed&&!(automaticMonitorAllowed(runtime,task.business_id)&&await monitoringEnabled(ctx,task.data_nature)))continue;await processMonitorTask(ctx,task,deps,now);}
   for(const sub of subscriptions){if(stopped)break;await reviewImportantChanges(context(runtime,sub.business_id),sub.data_nature,now);}
  }finally{running=false;}
 };
 const timer=setInterval(()=>{void tick().catch(()=>{/* persisted queue state and prior cursors remain available */});},intervalMs);
 return {tick,async stop(){stopped=true;clearInterval(timer);while(running)await new Promise(r=>setTimeout(r,10));}};
}

// A change observation points to the authoritative frozen input. Only the
// existing computed metrics/constraints are summarized for classification.
// This is not an import path and cannot change any business facts.
export async function enqueueBusinessObservation(ctx:Context,n:string,sub:Row,now=new Date()){
 const config=JSON.parse(sub.payload),basis=await monitorBasis(ctx,n,{...config,version:sub.configuration_version});
 if(basis.scope.operatingVersion==='unavailable')return;
 const scope=basis.scope as Row;
 const key=await hash(JSON.stringify(['business-change',scope.operatingVersion,sub.configuration_version]));
 if(await first(ctx.db,'SELECT id FROM neo_monitor_tasks WHERE business_id=? AND data_nature=? AND dedupe_key=?',ctx.businessId,n,key))return;
 let summary:Row;
 if(scope.generationId){const row=await first<Row>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',scope.generationId,ctx.businessId,n);const g=await loadGeneration(ctx,n,row!.payload);summary={inputId:g.id,asOf:g.state.asOf,metrics:g.state.metrics,feasibility:g.baseline.feasibility,quality:g.state.quality};}
 else{const row=await first<Row>(ctx.db,'SELECT payload FROM operating_snapshots WHERE id=? AND business_id=? AND data_nature=?',scope.snapshotId,ctx.businessId,n);const s=JSON.parse(row!.payload);summary={inputId:s.id,asOf:s.asOf,periodStart:s.periodStart,periodEnd:s.periodEnd,financial:s.data?.financial??{},events:s.data?.events??{},quality:s.data?.quality??{},stock:(s.data?.inventory??[]).slice(0,20),stockSampleOnly:(s.data?.inventory??[]).length>20,inventoryCoverage:{totalRows:Array.isArray(s.data?.inventory)?s.data.inventory.length:null,returnedRows:Math.min(20,s.data?.inventory?.length??0),status:Array.isArray(s.data?.inventory)?s.data.inventory.length>20?'partial':'snapshot_complete':'missing',reference:'operating_snapshots:'+s.id+':data.inventory',emptyDoesNotProveZeroStock:true},financialReference:'operating_snapshots:'+s.id+':data.financial',scope:{asOf:s.asOf,periodStart:s.periodStart,periodEnd:s.periodEnd,knownAt:s.knownAt??null}};}
 const body=JSON.stringify({notice:'当前已保存计算的引用摘要；初次观察不证明变化。仅支持与确认目标/约束相关的异常，缺少关联则research。',reference:{businessId:ctx.businessId,dataNature:n,...scope},summary});
 const documentId='business-document-'+key,sourceId='business-source-'+await hash([ctx.businessId,n].join('|')),contentHash=await hash(body),paragraphs=[{index:0,start:0,end:body.length,text:body,hash:contentHash}],id='monitor-'+key,stamp=now.toISOString();
 const payload={sourceVersion:1,configurationVersion:sub.configuration_version,documentDispositionVersion:DOCUMENT_DISPOSITION_VERSION,configuration:config,window:scheduleWindow(now,sub.last_success_at),basis,manual:false,operator:ctx.userId,documents:[{id:documentId,unchanged:false,chunks:chunks(paragraphs)}],gaps:[],partial:false,internal:true};
 await ctx.db.batch([
  statement(ctx.db,"INSERT OR IGNORE INTO neo_knowledge_sources VALUES(?,?,?,?,?,'business',1,1,?,?,?,?)",sourceId,ctx.businessId,n,'neo://business/'+encodeURIComponent(ctx.businessId),'经营依据变化',JSON.stringify({internal:true,reference:scope}),ctx.userId,stamp,stamp),
  statement(ctx.db,"INSERT OR IGNORE INTO neo_knowledge_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",documentId,ctx.businessId,n,sourceId,1,contentHash,'neo://business/'+scope.operatingVersion,body,JSON.stringify(paragraphs),null,stamp,JSON.stringify({kind:'frozen_business_reference',inputId:scope.operatingVersion}),'candidate'),
  statement(ctx.db,"INSERT OR IGNORE INTO neo_monitor_tasks(id,business_id,data_nature,source_id,dedupe_key,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?,?)",id,ctx.businessId,n,sourceId,key,JSON.stringify(payload),stamp,stamp),
 ]);
}

export async function initializeAcceptanceMonitoring(runtime:Runtime,businessId:string,nature='demo'){
 if(!runtime.DB||!automaticMonitorAllowed(runtime,businessId)||!(runtime.automaticMonitorBusinesses??[]).includes(businessId))return;
 if(!await first(runtime.DB,'SELECT id FROM businesses WHERE id=?',businessId))return;
 const ctx=context(runtime,businessId),stamp=new Date().toISOString();
 if(await first(ctx.db,'SELECT id FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?',businessId,nature))return;
 const profile=await first<Row>(ctx.db,'SELECT payload FROM neo_business_profiles WHERE business_id=? AND data_nature=? ORDER BY version DESC LIMIT 1',businessId,nature);
 const p=profile?JSON.parse(profile.payload):{};
 // The explicitly selected acceptance enterprise alone receives the default;
 // other enterprises require their own writer-authorized configuration.
 const config={industry:p.industry??'ecommerce',region:p.region??null,competitors:p.competitors??[],objectives:[],constraints:[],emergencyMaxPerDay:2};
 await statement(ctx.db,'INSERT OR IGNORE INTO neo_monitor_subscriptions VALUES(?,?,?,1,1,?,NULL,NULL,?)','subscription-'+await hash([businessId,nature].join('|')),businessId,nature,JSON.stringify(config),stamp).run();
 const {REGISTERED_KNOWLEDGE_SOURCES,OFFICIAL_HOSTS}=await import('./knowledge.ts');
 for(const source of REGISTERED_KNOWLEDGE_SOURCES)await statement(ctx.db,'INSERT OR IGNORE INTO neo_knowledge_sources VALUES(?,?,?,?,?,?,1,1,?,?,?,?)','source-'+await hash([businessId,nature,source.url].join('|')),businessId,nature,source.url,source.title,source.kind,JSON.stringify({pages:[],allowedHosts:OFFICIAL_HOSTS,originalId:source.id==='fitness-safety-2026'?'GB47368-2026':source.id}),ctx.userId,stamp,stamp).run();
}
