import {assessmentConfigurationId} from '../lib/assessment-presentation.ts';
import {readStoredResult} from './agent-state.ts';
import {decodeInput} from './input-storage.ts';
import {shanghaiDay} from './knowledge-time.ts';
import {loadBusinessArtifact} from './business-artifact-storage.ts';
import {requireWrite,type Context} from './auth.ts';
import {all,first,statement} from './store.ts';
import {assert,json} from './errors.ts';
import {hash} from './csv.ts';
import {policyText,policyPublishedAt,POLICY_SOURCES} from './policy-briefing.ts';
import {agentPolicy,automaticMonitorAllowed} from './agent-policy.ts';
import {INDUSTRY_PACKS} from './knowledge-packs.ts';
import {DOCUMENT_DISPOSITION_VERSION,documentDispositionProjection} from './document-disposition.ts';
export const KNOWLEDGE_VERSION='knowledge-v1';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Published custom fields and historical resource envelopes retain their existing runtime validation.
export type Row=Record<string,any>;
export const OFFICIAL_HOSTS=['www.samr.gov.cn','openstd.samr.gov.cn','std.samr.gov.cn','www.mct.gov.cn','www.ndrc.gov.cn','www.gov.cn','www.miit.gov.cn','www.mofcom.gov.cn'];
export const REGISTERED_KNOWLEDGE_SOURCES=[...POLICY_SOURCES.map(s=>({id:s.id,url:s.url,title:s.title,kind:'policy'})),{id:'fitness-safety-2026',url:'https://www.samr.gov.cn/xw/sj/art/2026/art_f634995405714a9bbb5c9309ca529d28.html',title:'室内固定式健身器材国家标准发布',kind:'policy'}];
export function safeSourceUrl(value:unknown,hosts=OFFICIAL_HOSTS){
 assert(typeof value==='string'&&value.length<=2000,422,'SOURCE_URL','需要公开来源 HTTPS 地址');let u:URL;
 try{u=new URL(value);}catch{throw Error('来源地址无效');}
 assert(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&(!u.port||u.port==='443')&&hosts.includes(u.hostname)&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(u.hostname)&&!/(?:^|\.)(?:localhost|local|internal|invalid|test)$/i.test(u.hostname),422,'SOURCE_URL','来源只允许已许可的公开 HTTPS 主机，禁止凭证、私网或自选端口');return u.href;
}
export function scheduleWindow(now:Date,last:string|null){
 const shifted=new Date(now.getTime()+8*3600000),day=shifted.toISOString().slice(0,10),boundary=day+'T01:00:00.000Z',end=now.toISOString(),start=new Date(now.getTime()-7*86400000).toISOString();
 return {due:now.toISOString()>=boundary&&(!last||last<boundary),day,scheduleStart:boundary,requestStart:last&&last>start?last:start,requestEnd:end,gaps:last&&last<start?['downtime_exceeds_7_days']:[]};
}
export async function readKnowledgeDocument(url:string,now=new Date(),fetcher:typeof fetch=fetch,hosts=OFFICIAL_HOSTS){
 safeSourceUrl(url,hosts);const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(18000),headers:{Accept:'text/html,text/plain,application/rss+xml,application/atom+xml'}});
 assert(response.status===200&&/text\/(html|plain)|application\/(rss|atom)\+xml/i.test(response.headers.get('content-type')??''),502,'SOURCE_BODY','原文状态或类型异常');assert(!response.url||response.url===url,502,'SOURCE_REDIRECT','来源重定向需重新登记');
 const reader=response.body?.getReader();assert(reader,502,'SOURCE_BODY','原文为空');const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;assert(bytes<=300000,502,'SOURCE_SIZE','原文超出读取上限');chunks.push(value);}}finally{await reader.cancel();}
 const body=new Uint8Array(bytes);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(body),main=raw.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i),bodyText=(main?.[2]??raw).replace(/<(nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const paragraphTexts=bodyText.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'').split(/<\/(?:p|div|li|h[1-6]|article|section)>|[\r\n]+/i).map(policyText).filter(Boolean);
 const text=paragraphTexts.join('\n');assert(text.length>=100&&!/^\s*(?:403|404|access denied|forbidden)/i.test(text),502,'SOURCE_BODY','原文不足或错误页面');
 const paragraphs=[];let start=0;for(let i=0;i<paragraphTexts.length;i++){const t=paragraphTexts[i];paragraphs.push({index:i,start,end:start+t.length,text:t,hash:await hash(t)});start+=t.length+1;}
 return {rawText:text,paragraphs,contentHash:await hash(text),publishedAt:policyPublishedAt(raw),retrievedAt:now.toISOString(),coverage:{kind:'current_observation',actualStart:null,actualEnd:null,bodyScope:main?main[1]:'whole_page_unverified',gaps:['current_page_cannot_prove_historical_coverage',...(!main?['body_location_unverified']:[])]}};
}
const publicRow=(r:Row)=>({...r,...(r.payload?{payload:JSON.parse(r.payload)}:{})});
function nature(v:unknown){assert(v==='demo'||v==='business',422,'NATURE','需要明确数据性质');return v;}
function str(v:unknown,name:string,max=1000){assert(typeof v==='string'&&v.trim()&&v.length<=max,422,'FIELD',name+'无效');return v.trim();}
async function scoped(ctx:Context,table:string,id:string,n:string){const row=await first<Row>(ctx.db,`SELECT * FROM ${table} WHERE id=? AND business_id=? AND data_nature=?`,id,ctx.businessId,n);assert(row,404,'NOT_FOUND','记录不属于当前企业或数据性质');return row;}
function audit(ctx:Context,n:string,id:string,action:string,value:unknown,now:string){return statement(ctx.db,'INSERT INTO neo_knowledge_audit VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),ctx.businessId,n,id,action,ctx.userId,JSON.stringify(value),now);}
export async function invalidateKnowledge(ctx:Context,n:string,id:string,version:string,reason:string){
 await statement(ctx.db,"UPDATE neo_knowledge_dependencies SET status=?,reason=? WHERE business_id=? AND data_nature=? AND dependency_id=? AND dependency_version=? AND status='current'",reason==='conflict'?'conflict':'stale',reason,ctx.businessId,n,id,version).run();
 await statement(ctx.db,"WITH RECURSIVE affected(id) AS (SELECT consumer_id FROM neo_knowledge_dependencies WHERE business_id=? AND data_nature=? AND dependency_id=? AND dependency_version=? UNION SELECT d.consumer_id FROM neo_knowledge_dependencies d JOIN affected a ON d.dependency_id=a.id WHERE d.business_id=? AND d.data_nature=?) UPDATE neo_knowledge_dependencies SET status='stale',reason=? WHERE business_id=? AND data_nature=? AND dependency_id IN (SELECT id FROM affected)",ctx.businessId,n,id,version,ctx.businessId,n,reason,ctx.businessId,n).run();
}
/** Exact immutable input plus its latest-source fence. Model proposal is distinct from human confirmation. */
async function candidateOrigin(ctx:Context,n:string,origin:Row|undefined,requestedScope:Row){
 assert(requestedScope&&typeof requestedScope==='object'&&!Array.isArray(requestedScope)&&Object.keys(requestedScope).every(k=>['entities','channels','period'].includes(k)),422,'SCOPE','企业知识范围字段无效');
 for(const key of ['entities','channels'])assert(requestedScope[key]===undefined||Array.isArray(requestedScope[key])&&requestedScope[key].length<=20&&requestedScope[key].every((v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=200),422,'SCOPE','企业知识对象范围无效');
 if(requestedScope.period)assert(/^\d{4}-\d{2}-\d{2}$/.test(requestedScope.period.start)&&/^\d{4}-\d{2}-\d{2}$/.test(requestedScope.period.end)&&requestedScope.period.start<=requestedScope.period.end,422,'SCOPE','企业知识期间无效');
 if(!origin)return {references:[],scope:requestedScope,provenance:{kind:'human_assertion',actorId:ctx.userId}};
 assert(origin&&['model_result','evidence_analysis'].includes(origin.kind),422,'PROVENANCE','候选来源类型无效');
 let envelope:Row={},result:Row={};const inputId=str(origin.inputId,'inputId',200);
 if(origin.kind==='model_result'){
  const r=await scoped(ctx,'neo_runs',str(origin.runId,'runId',200),n);assert(r.status==='completed'&&r.snapshot_id===inputId,422,'PROVENANCE','需要同一资料版本的完整保存判断');
  envelope=JSON.parse(r.payload).envelope;if(envelope.envelopePacked)envelope=await decodeInput(JSON.stringify({storageFormat:'neo-inputs-gzip-v1',...envelope.envelopePacked}));
  result=readStoredResult(r.result).result??{};assert(result.finding||result.businessAssessment,422,'PROVENANCE','来源判断尚未形成结果');
 }
 const generation=await first<Row>(ctx.db,'SELECT payload FROM neo_business_generations WHERE id=? AND business_id=? AND data_nature=?',inputId,ctx.businessId,n);
 const snapshot=generation?null:await first<Row>(ctx.db,'SELECT payload FROM operating_snapshots WHERE id=? AND business_id=? AND data_nature=?',inputId,ctx.businessId,n);
 assert(generation||snapshot,404,'PROVENANCE','来源资料不属于当前企业');
 const input=generation??snapshot!,value=generation?await (await import('./generation-storage.ts')).loadGeneration(ctx,n,generation.payload):JSON.parse(input.payload),a=result.businessAssessment;
 const active=envelope.conversation?.active??{},period=active.period??envelope.operatingBasis?.period??value.state?.period??{start:value.periodStart,end:value.periodEnd};
 const scope={...(origin.kind==='model_result'?{}:requestedScope),...((active.skuId??active.entityId??value.productId)?{entities:[active.skuId??active.entityId??value.productId]}:{}),...((active.channelId??value.channel)?{channels:[active.channelId??value.channel]}:{}),...(period.start&&period.end?{period:origin.kind==='evidence_analysis'&&requestedScope.period?requestedScope.period:period}:{})};
 // Evidence-analysis proposals retain the entire recorded period, never a broader unscoped rule.
 if(origin.kind==='evidence_analysis')assert(scope.period?.start&&scope.period?.end,422,'PROVENANCE','证据候选需要原统计期间');
 const available=new Set([...(result.finding?.evidenceIds??[]),...Object.values(value.evidenceIds??{}),...(a?.claims??[]).flatMap((c:Row)=>[...(c.dependencyIds??[]),...(c.supportingReferences??[]).map((r:Row)=>r.id)])]);
 assert(Array.isArray(origin.evidenceIds)&&origin.evidenceIds.length<=20,422,'PROVENANCE','证据引用无效');
 for(const id of origin.evidenceIds){
  assert(typeof id==='string',422,'PROVENANCE','证据引用无效');if(available.has(id))continue;
  if(origin.kind==='evidence_analysis'){
   if(generation){(await import('./workbench-compat.ts')).compatibilityEvidence(value,id,null,new URL('http://localhost/?limit=1'));}
   else if(id.startsWith(inputId+':view:')){const stored=await first<Row>(ctx.db,'SELECT payload FROM neo_inputs WHERE snapshot_id=? AND business_id=?',inputId,ctx.businessId);assert(stored,404,'PROVENANCE','来源冻结资料不存在');(await import('./scoped-evidence.ts')).scopedEvidence(await decodeInput(stored.payload),id);}
   else {const row=await first<Row>(ctx.db,'SELECT id FROM evidence_records WHERE id=? AND snapshot_id=? AND business_id=?',id,inputId,ctx.businessId);assert(row,404,'PROVENANCE','证据不属于来源资料');}
  }else assert(false,422,'PROVENANCE','证据引用不属于来源结果或资料版本');
 }
 if(origin.kind==='evidence_analysis'){
  const entities=new Set<string>(),channels=new Set<string>();
  for(const id of origin.evidenceIds){
   const parts=id.startsWith(inputId+':view:')?id.slice((inputId+':view:').length).split(':').map(decodeURIComponent):[];
   if(parts[0]==='inventory'&&parts[1])entities.add(parts[1]);
   if(['market-channel','channel-role'].includes(parts[0])&&parts[1])channels.add(parts[1]);
   if(parts[0]==='week'){if(parts[3])entities.add(parts[3]);if(parts[4])channels.add(parts[4]);}
  }
  // The immutable snapshot's scope is the fallback for unqualified IDs. A
  // requested scope cannot broaden or replace an actual evidence constraint.
  if(value.productId)assert([...entities].every(entity=>entity===value.productId),422,'PROVENANCE','证据商品超出不可变快照范围');
  if(value.channel)assert([...channels].every(channel=>channel===value.channel),422,'PROVENANCE','证据渠道超出不可变快照范围');
  if(entities.size)scope.entities=[...entities];if(channels.size)scope.channels=[...channels];
 }
 if(origin.kind==='evidence_analysis')assert(scope.period.start>=period.start&&scope.period.end<=period.end,422,'PROVENANCE','候选期间超出来源资料');
 const reference={id:(generation?'generation:':'snapshot:')+inputId,version:await hash(input.payload)};
 const inherited=origin.runId?await all<Row>(ctx.db,'SELECT dependency_id id,dependency_version version FROM neo_knowledge_dependencies WHERE consumer_id=? AND business_id=? AND data_nature=?',origin.runId,ctx.businessId,n):[];
 return {references:[reference,...inherited.map(r=>({...r,derived:true}))],scope,provenance:{kind:origin.kind,runId:origin.runId??null,inputId,evidenceIds:origin.evidenceIds,model:result.model??envelope.operatingBasis?.modelIdentity??envelope.modelVersion??null,assessmentHash:a?.inputHash??null,actorId:ctx.userId,statementEdited:origin.statementEdited===true}};
}
type Validity={status:'current'|'stale'|'conflict';reason:string|null};
const current:Validity={status:'current',reason:null};
const stale=(reason:string):Validity=>({status:'stale',reason});
// Used at publication AND read time. History remains immutable; an old exact
// version never becomes current merely because invalidation ran before insert.
export async function knowledgeReferenceValidity(ctx:Context,n:string,id:string,version:string,now=new Date(),seen=new Set<string>()):Promise<Validity>{
 if(seen.has(id))return stale('dependency_cycle');seen=new Set(seen).add(id);
 const day=shanghaiDay(now);
 if(id==='configuration:legacy-unversioned'){const head=await first<Row>(ctx.db,'SELECT config_id FROM neo_platform_config_heads WHERE business_id=? AND data_nature=?',ctx.businessId,n);return !head?.config_id&&version==='legacy-unversioned'?current:stale('configuration_no_longer_current');}
 if(id.startsWith('snapshot:')||id.startsWith('generation:')){
  const canonical=id.startsWith('generation:'),table=canonical?'neo_business_generations':'operating_snapshots',key=id.slice(id.indexOf(':')+1);
  if(!canonical&&await first(ctx.db,'SELECT id FROM neo_business_generations WHERE business_id=? AND data_nature=? LIMIT 1',ctx.businessId,n))return stale('source_kind_changed');
  const row=await first<Row>(ctx.db,`SELECT id,payload FROM ${table} WHERE id=? AND business_id=? AND data_nature=?`,key,ctx.businessId,n);
  const latest=await first<Row>(ctx.db,`SELECT id FROM ${table} WHERE business_id=? AND data_nature=? ORDER BY ${canonical?'created_at':'generated_at'} DESC,id DESC LIMIT 1`,ctx.businessId,n);
  return row&&await hash(row.payload)===version&&latest?.id===key?current:stale('source_input_no_longer_current');
 }
 const claim=await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_claims WHERE id=? AND business_id=? AND data_nature=?',id,ctx.businessId,n);
 if(claim){const p=JSON.parse(claim.payload);if(claim.body_hash!==version||!['active','confirmed'].includes(claim.state)||p.expiresAt&&p.expiresAt<day)return stale('claim_version_or_state_changed');return knowledgeDocumentValidity(ctx,n,claim.document_id,null,now);}
 const doc=await first<Row>(ctx.db,'SELECT id FROM neo_knowledge_documents WHERE id=? AND business_id=? AND data_nature=?',id,ctx.businessId,n);
 if(doc)return knowledgeDocumentValidity(ctx,n,id,version,now);
 const source=await first<Row>(ctx.db,'SELECT version,enabled FROM neo_knowledge_sources WHERE id=? AND business_id=? AND data_nature=?',id,ctx.businessId,n);
 if(source)return source.enabled&&String(source.version)===version?current:stale('source_version_or_state_changed');
 const memory=await first<Row>(ctx.db,'SELECT * FROM neo_enterprise_memories WHERE id=? AND business_id=? AND data_nature=?',id,ctx.businessId,n);
 if(memory){const p=JSON.parse(memory.payload);if(String(memory.version)!==version||memory.state!=='active'||!memory.confirmed_by||p.expiresAt&&p.expiresAt<day)return stale('memory_version_or_state_changed');const validity=await knowledgeFreshness(ctx,n,id,now,seen);return {status:validity.status,reason:validity.status==='current'?null:'memory_dependency_not_current'};}
 const pack=Object.values(INDUSTRY_PACKS).find(p=>p.id===id);if(pack)return pack.version===version?current:stale('industry_pack_version_changed');
 const profileId=id.startsWith('profile:')?id.slice(8):id;
 const profile=await first<Row>(ctx.db,'SELECT id FROM neo_business_profiles WHERE id=? AND business_id=? AND data_nature=?',profileId,ctx.businessId,n);
 if(profile){const latest=await first<Row>(ctx.db,'SELECT id FROM neo_business_profiles WHERE business_id=? AND data_nature=? ORDER BY version DESC LIMIT 1',ctx.businessId,n);return profile.id===version&&latest?.id===profile.id?current:stale('profile_no_longer_current');}
 const configId=id.startsWith('configuration:')?id.slice(14):id;
 const configuration=await first<Row>(ctx.db,'SELECT id,status FROM neo_platform_configs WHERE id=? AND business_id=? AND data_nature=?',configId,ctx.businessId,n);
 if(configuration){const head=await first<Row>(ctx.db,'SELECT config_id FROM neo_platform_config_heads WHERE business_id=? AND data_nature=?',ctx.businessId,n);return configuration.id===version&&configuration.status==='published'&&head?.config_id===configuration.id?current:stale('configuration_no_longer_current');}
 const reference=await first<Row>(ctx.db,"SELECT CAST(revision AS TEXT) version,'active' state,NULL expires_at FROM neo_business_inputs WHERE id=? AND business_id=? AND data_nature=? UNION ALL SELECT id version,'active' state,NULL FROM neo_business_profiles WHERE id=? AND business_id=? AND data_nature=? UNION ALL SELECT content_hash version,'active' state,NULL FROM business_facts WHERE id=? AND business_id=? AND data_nature=? UNION ALL SELECT id version,status state,NULL FROM neo_platform_configs WHERE id=? AND business_id=? AND data_nature=?",id,ctx.businessId,n,id.startsWith('profile:')?id.slice(8):id,ctx.businessId,n,id,ctx.businessId,n,id.startsWith('configuration:')?id.slice(14):id,ctx.businessId,n);
 if(reference)return reference.version===version&&['active','published'].includes(reference.state)?current:stale('reference_version_or_state_changed');
 const artifact=await first<Row>(ctx.db,"SELECT request_hash,payload FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=? AND kind='business_experience'",id,ctx.businessId,n);
 if(artifact){const p=await loadBusinessArtifact(ctx,n,'business_experience',artifact.payload) as Row;return artifact.request_hash===version&&p.status==='active'&&p.supportStatus==='supported'&&p.confirmedBy?current:stale('experience_version_or_state_changed');}
 return stale('dependency_unavailable');
}
async function knowledgeDocumentValidity(ctx:Context,n:string,id:string,version:string|null,now:Date):Promise<Validity>{
 void now;
 const doc=await first<Row>(ctx.db,'SELECT d.*,s.enabled source_enabled,s.version current_source_version FROM neo_knowledge_documents d JOIN neo_knowledge_sources s ON s.id=d.source_id AND s.business_id=d.business_id AND s.data_nature=d.data_nature WHERE d.id=? AND d.business_id=? AND d.data_nature=?',id,ctx.businessId,n);
 if(!doc||version!==null&&doc.content_hash!==version||!doc.source_enabled||doc.source_version!==doc.current_source_version||['superseded','expired','rejected'].includes(doc.state))return stale('document_or_source_version_changed');
 if(JSON.parse(doc.coverage).pendingReplacement)return {status:'conflict',reason:'source_body_change_pending_verification'};
 return current;
}
export async function recordKnowledgeDependencies(ctx:Context,n:string,consumerId:string,assessment:Row){
 const configurationId=assessmentConfigurationId(assessment.scope?.configurationVersion),configurationVersion=configurationId??'legacy-unversioned';
 const listed=[...(assessment.context?.versions??[]),...(configurationId!==undefined?[{kind:'configuration',id:'configuration:'+configurationVersion,version:configurationVersion}]:[])].filter((v:Row)=>v.id&&['knowledge','document','knowledge_source','enterprise_memory','industry_pack','configuration'].includes(v.kind));
 const versions=[...new Map(listed.map((v:Row)=>[v.id+'|'+v.version,v])).values()] as Row[];
 if(!versions.length)return;
 await ctx.db.batch(await Promise.all(versions.map(async(v:Row)=>statement(ctx.db,'INSERT OR IGNORE INTO neo_knowledge_dependencies VALUES(?,?,?,?,?,?,?,?,?,?)',await hash([consumerId,v.id,v.version].join('|')),ctx.businessId,n,consumerId,'assessment',v.id,String(v.version),'current',null,new Date().toISOString()))));
 for(const v of versions){const validity=await knowledgeReferenceValidity(ctx,n,v.id,String(v.version));if(validity.status!=='current')await invalidateKnowledge(ctx,n,v.id,String(v.version),validity.status==='conflict'?'conflict':validity.reason!);}
}
export async function confirmedEnterpriseMemories(ctx:Context,n:string,now=new Date()){
 const rows=await all<Row>(ctx.db,"SELECT * FROM neo_enterprise_memories WHERE business_id=? AND data_nature=? AND state='active' AND confirmed_by IS NOT NULL ORDER BY updated_at DESC",ctx.businessId,n),valid:Row[]=[];
 for(const r of rows)if((await knowledgeReferenceValidity(ctx,n,r.id,String(r.version),now)).status==='current')valid.push(r);
 return valid;
}
export async function knowledgeContext(ctx:Context,n:string,now=new Date()){
 const sub=await first<Row>(ctx.db,'SELECT * FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?',ctx.businessId,n),config=sub?JSON.parse(sub.payload):{};
 const memories=await confirmedEnterpriseMemories(ctx,n,now);
 const claims=await all<Row>(ctx.db,"SELECT c.*,d.paragraphs,d.retrieved_at,d.published_at,d.source_id,d.content_hash,d.source_version,d.coverage,s.url,s.title,s.kind source_kind FROM neo_knowledge_claims c JOIN neo_knowledge_documents d ON d.id=c.document_id JOIN neo_knowledge_sources s ON s.id=d.source_id WHERE c.business_id=? AND c.data_nature=? AND s.enabled=1 AND d.source_version=s.version AND c.state IN ('active','confirmed') ORDER BY c.updated_at DESC",ctx.businessId,n);
 const items=claims.flatMap(r=>{const p=JSON.parse(r.payload);if(p.expiresAt&&p.expiresAt<shanghaiDay(now))return [];return [{id:r.id,version:r.body_hash,kind:'knowledge',...p,state:r.state,documentId:r.document_id,documentVersion:r.content_hash,sourceId:r.source_id,sourceVersion:String(r.source_version),freshness:JSON.parse(r.coverage).pendingReplacement?{status:'conflict',reason:'source_body_change_pending_verification'}:current,sourceKind:r.source_kind,url:r.url,title:r.title,retrievedAt:r.retrieved_at,publishedAt:r.published_at,paragraphs:JSON.parse(r.paragraphs).filter((x:Row)=>p.paragraphIndices.includes(x.index)).map((x:Row)=>({...x,id:r.document_id+':paragraph:'+x.index})),factUse:'current_external_information_not_historical_causation'}];});
 const rules=memories.map(r=>({id:r.id,kind:'enterprise_memory',...JSON.parse(r.payload),state:r.state,version:String(r.version),confirmedBy:r.confirmed_by}));
 const experiences=await all<Row>(ctx.db,"SELECT id,request_hash,payload FROM neo_artifacts WHERE business_id=? AND data_nature=? AND kind='business_experience' ORDER BY created_at DESC LIMIT 20",ctx.businessId,n);
 for(const row of experiences){const p=await loadBusinessArtifact(ctx,n,'business_experience',row.payload) as Row;if(p.status==='active'&&p.supportStatus==='supported'&&p.confirmedBy&&(!p.confirmedAt||p.confirmedAt<=now.toISOString()))rules.push({id:row.id,version:row.request_hash,kind:'enterprise_memory',location:'neo_artifacts',state:'active',confirmedBy:p.confirmedBy,statement:p.statement,scope:p.scope,referenceOnly:true,dependencyHash:p.dependencyHash,factUse:'historical_observation_only'});}
 const totals=await first<Row>(ctx.db,"SELECT count(*) total FROM neo_knowledge_claims c JOIN neo_knowledge_documents d ON d.id=c.document_id JOIN neo_knowledge_sources s ON s.id=d.source_id WHERE c.business_id=? AND c.data_nature=? AND s.enabled=1 AND d.source_version=s.version AND c.state IN ('active','confirmed') AND (json_extract(c.payload,'$.expiresAt') IS NULL OR json_extract(c.payload,'$.expiresAt')>=?)",ctx.businessId,n,shanghaiDay(now));
 const coverage={selection:'all_active_claims_frozen_retrieval_only',totalActiveClaims:totals?.total??0,deliveredClaims:items.length,complete:(totals?.total??0)<=items.length,absenceMeans:'not_in_frozen_delivery_not_proof_no_applicable_rule'};
 const pack=INDUSTRY_PACKS[config.industry as keyof typeof INDUSTRY_PACKS];
 return {version:KNOWLEDGE_VERSION,businessId:ctx.businessId,dataNature:n,capturedAt:now.toISOString(),configurationVersion:sub?.configuration_version??0,items,rules,pack:pack??null,coverage,gaps:[...(!coverage.complete?['knowledge_delivery_truncated_not_complete_catalog']:[]),...(items.some(i=>i.freshness.status==='conflict')?['source_body_change_pending_verification']:[]),...(!config.region?['enterprise_region_unknown']:[]),...(!config.competitors?.length?['competitors_unknown']:[])],limits:['候选不是确认规则，原文可读不是政策适用。','外部新信息不可用于解释历史因果。','知识不可自动修改目标、参数或触发全量预测重算。']};
}
export async function enqueueSource(ctx:Context,n:string,source:Row,requestId:string,now=new Date(),manual=false){
 const sub=await first<Row>(ctx.db,'SELECT * FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?',ctx.businessId,n);const w=scheduleWindow(now,JSON.parse(source.payload).lastSuccessAt??null);
 const key=await hash(JSON.stringify([source.id,source.version,manual?'manual':'daily',manual?requestId:w.day,sub?.configuration_version??0]));const id='monitor-'+key;
 await statement(ctx.db,"INSERT OR IGNORE INTO neo_monitor_tasks(id,business_id,data_nature,source_id,dedupe_key,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?,?)",id,ctx.businessId,n,source.id,key,JSON.stringify({sourceVersion:source.version,configurationVersion:sub?.configuration_version??0,documentDispositionVersion:DOCUMENT_DISPOSITION_VERSION,manual,requestId,window:w,configuration:sub?JSON.parse(sub.payload):{},operator:ctx.userId}),now.toISOString(),now.toISOString()).run();return publicRow((await first<Row>(ctx.db,'SELECT * FROM neo_monitor_tasks WHERE id=?',id))!);
}
async function dispositionDocuments(ctx:Context,n:string,query='',cursor=0,limit=20){
 const rows=await all<Row>(ctx.db,'SELECT d.id,d.source_id,d.source_version,d.content_hash,d.state,d.retrieved_at,d.published_at,d.coverage,s.title,s.url FROM neo_knowledge_documents d JOIN neo_knowledge_sources s ON s.id=d.source_id AND s.business_id=d.business_id AND s.data_nature=d.data_nature WHERE d.business_id=? AND d.data_nature=? AND (instr(lower(d.raw_text),lower(?))>0 OR instr(lower(d.coverage),lower(?))>0) ORDER BY d.retrieved_at DESC,d.id LIMIT ? OFFSET ?',ctx.businessId,n,query,query,limit+1,cursor);
 const sub=await first<Row>(ctx.db,'SELECT configuration_version FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?',ctx.businessId,n);
 const documents=await Promise.all(rows.slice(0,limit).map(async row=>{
  const doc=documentDispositionProjection(row),d=doc.documentDisposition;if(!d)return doc;
  const validity=await knowledgeDocumentValidity(ctx,n,doc.id,d.documentVersion,new Date());
  const refs=await Promise.all((d.configurationReferences??[]).map((r:Row)=>knowledgeReferenceValidity(ctx,n,r.id,String(r.version))));
  const configChanged=d.configurationVersion!==(sub?.configuration_version??0)||refs.some(r=>r.status!=='current');
  return {...doc,dispositionFreshness:validity.status!=='current'?validity:configChanged?{status:'stale',reason:'disposition_configuration_changed'}:{status:'current',reason:null}};
 }));
 return {documents,documentsPage:{cursor,limit,hasMore:rows.length>limit,nextCursor:rows.length>limit?cursor+limit:null,query}};
}
export async function handleKnowledge(request:Request,ctx:Context,segments:string[]){
 const [rawResource,id,action]=segments,resource=rawResource==='knowledge-monitor'?'monitor':rawResource;if(!['knowledge-sources','knowledge-items','monitor','agent-memory'].includes(resource))return null;
 const url=new URL(request.url);assert(['GET','POST'].includes(request.method),405,'METHOD','只支持 GET/POST');
 if(request.method==='GET'){
  const n=nature(url.searchParams.get('dataNature'));
  if(resource==='knowledge-items'){
   if(id){const item=await scoped(ctx,'neo_knowledge_claims',id,n),document=await scoped(ctx,'neo_knowledge_documents',item.document_id,n);return json({item:publicRow(item),document:{...documentDispositionProjection(document),paragraphs:JSON.parse(document.paragraphs)},dependencies:await all(ctx.db,'SELECT * FROM neo_knowledge_dependencies WHERE business_id=? AND data_nature=? AND dependency_id IN (?,?)',ctx.businessId,n,id,document.id)});}
   const cursor=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??20),query=url.searchParams.get('query')??'';
   assert(Number.isInteger(cursor)&&cursor>=0&&Number.isInteger(limit)&&limit>=1&&limit<=100&&query.length<=1000,422,'PAGE','知识分页参数无效');
   const rows=await all<Row>(ctx.db,'SELECT * FROM neo_knowledge_claims WHERE business_id=? AND data_nature=? AND instr(lower(payload),lower(?))>0 ORDER BY created_at DESC,id LIMIT ? OFFSET ?',ctx.businessId,n,query,limit+1,cursor);
   return json({items:rows.slice(0,limit).map(publicRow),page:{cursor,limit,hasMore:rows.length>limit,nextCursor:rows.length>limit?cursor+limit:null,query},...await dispositionDocuments(ctx,n,query,cursor,limit),...(!url.searchParams.has('query')&&!url.searchParams.has('cursor')?{context:await knowledgeContext(ctx,n)}:{})});
  }
  const table=resource==='knowledge-sources'?'neo_knowledge_sources':resource==='agent-memory'?'neo_enterprise_memories':'neo_monitor_tasks';
  if(id)return json({item:publicRow(await scoped(ctx,table,id,n))});
  return json({items:(await all<Row>(ctx.db,`SELECT * FROM ${table} WHERE business_id=? AND data_nature=? ORDER BY created_at DESC LIMIT 100`,ctx.businessId,n)).map(publicRow),...(resource==='monitor'?{...await dispositionDocuments(ctx,n),reviews:await all(ctx.db,"SELECT m.*,r.status run_status,r.error run_error,CASE WHEN r.status='deferred' THEN 'evidence_backed_pending_review' ELSE NULL END pending_review_notice FROM neo_monitor_reviews m LEFT JOIN neo_runs r ON r.id=m.run_id WHERE m.business_id=? AND m.data_nature=? ORDER BY m.created_at DESC LIMIT 100",ctx.businessId,n),subscription:await first(ctx.db,'SELECT * FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?',ctx.businessId,n),events:(await all<Row>(ctx.db,'SELECT * FROM neo_knowledge_events WHERE business_id=? AND data_nature=? ORDER BY discovered_at DESC LIMIT 100',ctx.businessId,n)).map(publicRow),dependencies:await all(ctx.db,'SELECT * FROM neo_knowledge_dependencies WHERE business_id=? AND data_nature=? AND status!=?',ctx.businessId,n,'current')}:{}),...(resource==='knowledge-sources'?{registered:REGISTERED_KNOWLEDGE_SOURCES}: {})});
 }
 requireWrite(request,ctx);const raw=await request.text();assert(raw.length<=20000,413,'SIZE','请求过大');let b:Row;try{b=JSON.parse(raw);}catch{assert(false,422,'BODY','JSON格式错误');}assert(b&&typeof b==='object'&&!Array.isArray(b),422,'BODY','需要JSON对象');const n=nature(b.dataNature),requestId=str(b.requestId,'requestId',100),now=new Date().toISOString(),requestHash=await hash(JSON.stringify([resource,id,action,b]));
 const prior=await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_requests WHERE business_id=? AND data_nature=? AND request_id=?',ctx.businessId,n,requestId);if(prior){assert(prior.request_hash===requestHash,409,'REQUEST_CONFLICT','相同 requestId 的内容改变');return json(JSON.parse(prior.response));}
 const commands:D1PreparedStatement[]=[];let response:Row;
 if(resource==='knowledge-sources'){
  const existing=id?await scoped(ctx,'neo_knowledge_sources',id,n):null;
  if(!existing)assert(!await first(ctx.db,'SELECT id FROM neo_knowledge_sources WHERE business_id=? AND data_nature=? AND url=?',ctx.businessId,n,b.url),409,'SOURCE_EXISTS','该来源已登记，请按ID更新');
  const allowedHosts=b.allowedHosts??(existing?JSON.parse(existing.payload).allowedHosts:undefined)??OFFICIAL_HOSTS;assert(Array.isArray(allowedHosts)&&allowedHosts.length<=20&&allowedHosts.every((h:unknown)=>typeof h==='string'&&h.length<254),422,'SOURCE_HOSTS','许可来源域名无效');
  const source={id:existing?.id??'source-'+await hash([ctx.businessId,n,b.url].join('|')),url:safeSourceUrl(b.url??existing?.url,allowedHosts),title:str(b.title??existing?.title,'title',200),kind:b.kind??existing?.kind??'policy',enabled:action==='disable'?0:b.enabled===false?0:1,version:(existing?.version??0)+1,payload:{allowedHosts,pages:b.pages??(existing?JSON.parse(existing.payload).pages:[])??[],originalId:b.originalId??(existing?JSON.parse(existing.payload).originalId:undefined)??null}};
  assert(['policy','market','competitor'].includes(source.kind),422,'KIND','来源类型无效');assert(Array.isArray(source.payload.pages)&&source.payload.pages.length<=5,422,'PAGES','归档最多五页');source.payload.pages=source.payload.pages.map((x:string)=>safeSourceUrl(x,allowedHosts));
  if(existing){commands.push(statement(ctx.db,'UPDATE neo_knowledge_sources SET url=?,title=?,kind=?,enabled=?,version=?,payload=?,actor_id=?,updated_at=? WHERE id=? AND version=?',source.url,source.title,source.kind,source.enabled,source.version,JSON.stringify(source.payload),ctx.userId,now,source.id,existing.version));commands.push(statement(ctx.db,"UPDATE neo_knowledge_dependencies SET status='stale',reason='source_changed' WHERE business_id=? AND data_nature=? AND dependency_id IN (SELECT id FROM neo_knowledge_documents WHERE source_id=?)",ctx.businessId,n,source.id));commands.push(statement(ctx.db,"UPDATE neo_knowledge_claims SET state='superseded',updated_at=? WHERE business_id=? AND data_nature=? AND document_id IN (SELECT id FROM neo_knowledge_documents WHERE source_id=?)",now,ctx.businessId,n,source.id));}
  else commands.push(statement(ctx.db,'INSERT INTO neo_knowledge_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',source.id,ctx.businessId,n,source.url,source.title,source.kind,source.enabled,source.version,JSON.stringify(source.payload),ctx.userId,now,now));
  response={source};commands.push(audit(ctx,n,source.id,action??'register',source,now));
 }else if(resource==='agent-memory'){
  if(!id){const origin=await candidateOrigin(ctx,n,b.provenance,b.scope??{});const item={id:'memory-'+await hash([ctx.businessId,n,requestId].join('|')),state:'candidate',statement:str(b.statement,'statement'),references:[...(b.references??[]),...origin.references],scope:origin.scope,provenance:origin.provenance,expiresAt:b.expiresAt??null,riskKind:b.riskKind??null,deadline:b.deadline??null};assert(Array.isArray(item.references)&&item.references.length<=20,422,'REFERENCES','引用无效');commands.push(statement(ctx.db,'INSERT INTO neo_enterprise_memories VALUES(?,?,?,?,?,?,?,?,?,?)',item.id,ctx.businessId,n,1,item.state,JSON.stringify(item),ctx.userId,null,now,now));response={item};}
  else{const row=await scoped(ctx,'neo_enterprise_memories',id,n),p=JSON.parse(row.payload);assert(['confirm','reject','supersede','expire'].includes(action),422,'ACTION','记忆状态操作无效');assert(!['rejected','superseded','expired'].includes(row.state),409,'STATE','终态记录不可改写');
   if(action==='confirm'){
    assert(p.references.length>0||b.confirmationMode==='human_attestation'&&typeof b.note==='string'&&b.note.trim().length>0,422,'REFERENCES','确认规则需要可核对依据或明确人工声明');
    for(const ref of p.references){
     assert(ref&&typeof ref.id==='string'&&typeof ref.version==='string',422,'REFERENCES','需要精确引用版本');
     if(ref.derived===true||ref.id.startsWith('snapshot:')||ref.id.startsWith('generation:')){assert((await knowledgeReferenceValidity(ctx,n,ref.id,ref.version)).status==='current',422,'REFERENCES','来源资料已改变，须重新提出候选');continue;}
     const c=await first<Row>(ctx.db,"SELECT body_hash version,state FROM neo_knowledge_claims WHERE id=? AND business_id=? AND data_nature=? UNION ALL SELECT request_hash version,'active' state FROM neo_artifacts WHERE id=? AND business_id=? AND data_nature=? AND kind='business_experience' AND json_extract(payload,'$.status')='active' AND json_extract(payload,'$.supportStatus')='supported' AND json_extract(payload,'$.confirmedBy') IS NOT NULL UNION ALL SELECT CAST(revision AS TEXT) version,'active' state FROM neo_business_inputs WHERE id=? AND business_id=? AND data_nature=? UNION ALL SELECT id version,'active' state FROM neo_business_profiles WHERE id=? AND business_id=? AND data_nature=? UNION ALL SELECT content_hash version,'active' state FROM business_facts WHERE id=? AND business_id=? AND data_nature=? UNION ALL SELECT id version,status state FROM neo_platform_configs WHERE id=? AND business_id=? AND data_nature=? AND status='published'",ref.id,ctx.businessId,n,ref.id,ctx.businessId,n,ref.id,ctx.businessId,n,ref.id,ctx.businessId,n,ref.id,ctx.businessId,n,ref.id,ctx.businessId,n);
     assert(c&&c.version===ref.version&&!['rejected','expired','superseded'].includes(c.state),422,'REFERENCES','引用无效、过期或不属于本企业');
    }
    p.confirmation={method:b.confirmationMode==='human_attestation'?'human_attestation':'referenced_evidence',actorId:ctx.userId,at:now,note:b.note??null,version:row.version+1};
   }
   if(action==='confirm')for(const ref of p.references)commands.push(statement(ctx.db,'INSERT OR IGNORE INTO neo_knowledge_dependencies VALUES(?,?,?,?,?,?,?,?,?,?)',await hash([id,ref.id,ref.version].join('|')),ctx.businessId,n,id,'memory',ref.id,ref.version,'current',null,now));
   const state=action==='confirm'?'active':action==='reject'?'rejected':action==='supersede'?'superseded':'expired';commands.push(statement(ctx.db,'UPDATE neo_enterprise_memories SET state=?,version=version+1,confirmed_by=?,updated_at=?,payload=? WHERE id=? AND version=?',state,action==='confirm'?ctx.userId:row.confirmed_by,now,JSON.stringify(p),id,row.version));commands.push(statement(ctx.db,"UPDATE neo_knowledge_dependencies SET status='stale',reason=? WHERE business_id=? AND data_nature=? AND dependency_id=? AND dependency_version=?",action,ctx.businessId,n,id,String(row.version)));response={item:{...publicRow(row),state,version:row.version+1}};
  }commands.push(audit(ctx,n,response.item.id,action??'propose',response.item,now));
 }else if(resource==='monitor'&&action==='configure'||resource==='monitor'&&id==='configure'){
  const existing=await first<Row>(ctx.db,'SELECT * FROM neo_monitor_subscriptions WHERE business_id=? AND data_nature=?',ctx.businessId,n);agentPolicy(ctx.runtime,ctx.businessId);
  assert(!b.enabled||automaticMonitorAllowed(ctx.runtime,ctx.businessId),403,'MONITOR_DISABLED','隔离/离线企业不能开启自动监控');assert(Object.hasOwn(INDUSTRY_PACKS,b.industry),422,'INDUSTRY','选择电商、酒店或库存离散制造');
  const config={industry:b.industry,region:b.region??null,competitors:b.competitors??[],objectives:b.objectives??[],constraints:b.constraints??[],emergencyMaxPerDay:Math.min(2,Math.max(0,Number(b.emergencyMaxPerDay??2)))};
  assert(Array.isArray(config.objectives)&&Array.isArray(config.constraints)&&[...config.objectives,...config.constraints].every(r=>typeof r.id==='string'&&typeof r.version==='string'),422,'REFERENCES','目标/约束必须引用确认配置的 ID 和版本');
  commands.push(statement(ctx.db,'INSERT INTO neo_monitor_subscriptions VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(business_id,data_nature) DO UPDATE SET enabled=excluded.enabled,configuration_version=neo_monitor_subscriptions.configuration_version+1,payload=excluded.payload,updated_at=excluded.updated_at','subscription-'+await hash([ctx.businessId,n].join('|')),ctx.businessId,n,b.enabled?1:0,(existing?.configuration_version??0)+1,JSON.stringify(config),existing?.last_schedule_at??null,existing?.last_success_at??null,now));response={configuration:config,enabled:!!b.enabled};commands.push(audit(ctx,n,ctx.businessId,'configure',response,now));
 }else if(resource==='monitor'&&id&&action==='recheck'){
  assert(agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed,403,'RESEARCH_DISABLED','外部读取未开启');const task=await scoped(ctx,'neo_monitor_tasks',id,n);const {requestKnowledgeRecheck}=await import('./knowledge-monitor.ts');response={task:await requestKnowledgeRecheck(ctx,n,task,str(b.documentId,'documentId',200),requestId)};commands.push(audit(ctx,n,id,'recheck',response,now));
 }else if(resource==='monitor'&&id&&['cancel','resume'].includes(action)){
  const task=await scoped(ctx,'neo_monitor_tasks',id,n),p=JSON.parse(task.payload);
  if(action==='resume')assert(['failed','cancelled','partial'].includes(task.status),409,'STATE','只能显式恢复失败、取消或部分读取任务');
  const {service}=await import('./agents.ts');
  for(const d of p.documents??[])for(const r of d.runs??[]){if(r&&r.status!=='completed')await service(ctx,`/runs/${encodeURIComponent(r.id)}/${action}`,{});}
  if(action==='resume'&&task.status==='partial')delete p.documents;
  commands.push(statement(ctx.db,'UPDATE neo_monitor_tasks SET status=?,payload=?,lease_owner=NULL,lease_until=NULL,error=NULL,retry_at=NULL,updated_at=? WHERE id=?',action==='cancel'?'cancelled':'pending',JSON.stringify(p),now,id));response={taskId:id,status:action==='cancel'?'cancelled':'pending'};commands.push(audit(ctx,n,id,action,response,now));
 }else if(resource==='monitor'&&id&&action==='refresh'){
  assert(agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed,403,'RESEARCH_DISABLED','外部读取未开启');const source=await scoped(ctx,'neo_knowledge_sources',id,n);assert(source.enabled,409,'SOURCE_DISABLED','来源已停用');response={task:await enqueueSource(ctx,n,source,requestId,new Date(),true)};
 }else{assert(false,404,'NOT_FOUND','知识操作不存在');}
 commands.push(statement(ctx.db,'INSERT INTO neo_knowledge_requests VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),ctx.businessId,n,requestId,requestHash,JSON.stringify(response),ctx.userId,now));
 try{await ctx.db.batch(commands);}catch(e){const race=await first<Row>(ctx.db,'SELECT * FROM neo_knowledge_requests WHERE business_id=? AND data_nature=? AND request_id=?',ctx.businessId,n,requestId);if(race){assert(race.request_hash===requestHash,409,'REQUEST_CONFLICT','并发请求内容不同');return json(JSON.parse(race.response));}throw e;}
 if(resource==='knowledge-sources'&&id){const docs=await all<Row>(ctx.db,'SELECT id,content_hash FROM neo_knowledge_documents WHERE source_id=? AND business_id=? AND data_nature=?',id,ctx.businessId,n);for(const d of docs){await invalidateKnowledge(ctx,n,d.id,d.content_hash,'source_changed');const claims=await all<Row>(ctx.db,'SELECT id,body_hash FROM neo_knowledge_claims WHERE document_id=?',d.id);for(const c of claims)await invalidateKnowledge(ctx,n,c.id,c.body_hash,'source_changed');}}
 if(resource==='agent-memory'&&id)await invalidateKnowledge(ctx,n,id,String(response.item.version-1),action);
 return json(response,201);
}

export async function knowledgeFreshness(ctx:Context,n:string,consumerId:string,now=new Date(),seen=new Set<string>()):Promise<{status:'current'|'stale'|'conflict';dependencies:Row[]}>{
 const refs=await all<Row>(ctx.db,'SELECT * FROM neo_knowledge_dependencies WHERE business_id=? AND data_nature=? AND consumer_id=?',ctx.businessId,n,consumerId);
 for(const ref of refs){const validity=await knowledgeReferenceValidity(ctx,n,ref.dependency_id,String(ref.dependency_version),now,seen);if(validity.status==='conflict'||ref.status==='current'&&validity.status!=='current'){ref.status=validity.status;ref.reason=validity.reason;}}
 return {status:refs.some(r=>r.status==='conflict')?'conflict':refs.some(r=>r.status!=='current')?'stale':'current',dependencies:refs};
}
