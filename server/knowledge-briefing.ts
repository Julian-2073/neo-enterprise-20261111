import type {Context} from './auth.ts';
import type {Snapshot} from './contracts.ts';
import {knowledgeContext,enqueueSource,REGISTERED_KNOWLEDGE_SOURCES,OFFICIAL_HOSTS,type Row} from './knowledge.ts';
import {statement,all} from './store.ts';
import {hash} from './csv.ts';
import {agentPolicy} from './agent-policy.ts';
export async function monitoredPolicyBriefing(ctx:Context,s:Snapshot){
 const knowledge=await knowledgeContext(ctx,s.dataNature),items=knowledge.items.filter((i:Row)=>i.sourceKind==='policy'&&i.freshness?.status==='current'&&i.supportStatus==='supported'&&i.url?.startsWith('https:'));
 if(!items.length)return null;
 return {id:'knowledge-brief:'+await hash(JSON.stringify(items.map((i:Row)=>[i.id,i.version]))),businessId:ctx.businessId,snapshotId:s.id,dataNature:s.dataNature,version:'monitored-policy-v1',checkedAt:items.map((i:Row)=>i.retrievedAt).sort().at(-1),day:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),items:items.map((i:Row)=>({id:i.id,label:i.title,summary:i.statement,relevance:i.impact,applicability:i.applicabilityVerified?'已按确认企业范围核验；仍须遵守原文效期与限制。':'适用范围待核实，原文可读不代表企业符合条件。',claimSupport:i.supportStatus,applicabilityVerified:i.applicabilityVerified,effectiveAt:i.effectiveAt,expiresAt:i.expiresAt,source:{title:i.title,url:i.url,issuer:'原文发布方',documentNumber:i.originalId,publishedAt:i.publishedAt,retrievedAt:i.retrievedAt,contentHash:i.documentVersion,verificationStatus:'source_read'},evidence:i.paragraphs.map((p:Row)=>p.text)})),gaps:knowledge.gaps,coverage:'已登记来源中有模型抽取及逐段支持校验的主张；不承诺全量政策或企业适用。',stale:false,canRefresh:ctx.role!=='reader'&&agentPolicy(ctx.runtime,ctx.businessId).marketSearchAllowed};
}
export async function queuePolicySources(ctx:Context,s:Snapshot,requestId:string){
 const now=new Date().toISOString();
 for(const source of REGISTERED_KNOWLEDGE_SOURCES)await statement(ctx.db,'INSERT OR IGNORE INTO neo_knowledge_sources VALUES(?,?,?,?,?,?,1,1,?,?,?,?)','source-'+await hash([ctx.businessId,s.dataNature,source.url].join('|')),ctx.businessId,s.dataNature,source.url,source.title,source.kind,JSON.stringify({pages:[],allowedHosts:OFFICIAL_HOSTS,originalId:source.id==='fitness-safety-2026'?'GB47368-2026':source.id}),ctx.userId,now,now).run();
 const sources=await all<Row>(ctx.db,"SELECT * FROM neo_knowledge_sources WHERE business_id=? AND data_nature=? AND enabled=1 AND kind='policy'",ctx.businessId,s.dataNature);
 return Promise.all(sources.map(source=>enqueueSource(ctx,s.dataNature,source,requestId,new Date(),true)));
}
