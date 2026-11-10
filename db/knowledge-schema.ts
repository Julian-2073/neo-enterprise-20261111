import {sqliteTable,text,integer,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
// Knowledge records reference authoritative inputs. No orders, balances or
// business configuration values are copied into this store as a second ledger.
const scope=()=>({businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull()});
export const knowledgeSources=sqliteTable('neo_knowledge_sources',{
 id:text('id').primaryKey(),...scope(),url:text('url').notNull(),title:text('title').notNull(),kind:text('kind').notNull(),enabled:integer('enabled').notNull().default(1),version:integer('version').notNull().default(1),payload:text('payload').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('uq_knowledge_source_url').on(t.businessId,t.dataNature,t.url)]);
export const knowledgeDocuments=sqliteTable('neo_knowledge_documents',{
 id:text('id').primaryKey(),...scope(),sourceId:text('source_id').notNull(),sourceVersion:integer('source_version').notNull(),contentHash:text('content_hash').notNull(),originalId:text('original_id').notNull(),rawText:text('raw_text').notNull(),paragraphs:text('paragraphs').notNull(),publishedAt:text('published_at'),retrievedAt:text('retrieved_at').notNull(),coverage:text('coverage').notNull(),state:text('state').notNull().default('candidate'),
},t=>[uniqueIndex('uq_knowledge_document').on(t.businessId,t.dataNature,t.sourceId,t.sourceVersion,t.contentHash)]);
export const knowledgeClaims=sqliteTable('neo_knowledge_claims',{
 id:text('id').primaryKey(),...scope(),documentId:text('document_id').notNull(),bodyHash:text('body_hash').notNull(),state:text('state').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('idx_knowledge_claim_scope').on(t.businessId,t.dataNature,t.state)]);
export const enterpriseMemories=sqliteTable('neo_enterprise_memories',{
 id:text('id').primaryKey(),...scope(),version:integer('version').notNull().default(1),state:text('state').notNull(),payload:text('payload').notNull(),actorId:text('actor_id').notNull(),confirmedBy:text('confirmed_by'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('idx_enterprise_memory_scope').on(t.businessId,t.dataNature,t.state)]);
export const monitorSubscriptions=sqliteTable('neo_monitor_subscriptions',{
 id:text('id').primaryKey(),...scope(),enabled:integer('enabled').notNull().default(0),configurationVersion:integer('configuration_version').notNull().default(1),payload:text('payload').notNull(),lastScheduleAt:text('last_schedule_at'),lastSuccessAt:text('last_success_at'),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('uq_monitor_subscription').on(t.businessId,t.dataNature)]);
export const knowledgeEvents=sqliteTable('neo_knowledge_events',{
 id:text('id').primaryKey(),...scope(),eventKey:text('event_key').notNull(),classification:text('classification').notNull(),state:text('state').notNull(),payload:text('payload').notNull(),occurredAt:text('occurred_at'),discoveredAt:text('discovered_at').notNull(),
},t=>[uniqueIndex('uq_knowledge_event').on(t.businessId,t.dataNature,t.eventKey)]);
export const monitorTasks=sqliteTable('neo_monitor_tasks',{
 id:text('id').primaryKey(),...scope(),sourceId:text('source_id').notNull(),dedupeKey:text('dedupe_key').notNull(),status:text('status').notNull(),payload:text('payload').notNull(),result:text('result'),leaseOwner:text('lease_owner'),leaseUntil:text('lease_until'),attempts:integer('attempts').notNull().default(0),retryAt:text('retry_at'),error:text('error'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('uq_monitor_task').on(t.businessId,t.dataNature,t.dedupeKey),index('idx_monitor_task_queue').on(t.status,t.retryAt)]);
export const knowledgeDependencies=sqliteTable('neo_knowledge_dependencies',{
 id:text('id').primaryKey(),...scope(),consumerId:text('consumer_id').notNull(),consumerKind:text('consumer_kind').notNull(),dependencyId:text('dependency_id').notNull(),dependencyVersion:text('dependency_version').notNull(),status:text('status').notNull().default('current'),reason:text('reason'),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_knowledge_dependency').on(t.businessId,t.dataNature,t.consumerId,t.dependencyId,t.dependencyVersion),index('idx_knowledge_dependency_reverse').on(t.dependencyId,t.dependencyVersion)]);
export const knowledgeRequests=sqliteTable('neo_knowledge_requests',{
 id:text('id').primaryKey(),...scope(),requestId:text('request_id').notNull(),requestHash:text('request_hash').notNull(),response:text('response').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_knowledge_request').on(t.businessId,t.dataNature,t.requestId)]);
export const knowledgeAudit=sqliteTable('neo_knowledge_audit',{
 id:text('id').primaryKey(),...scope(),resourceId:text('resource_id').notNull(),action:text('action').notNull(),actorId:text('actor_id').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
});
export const monitorReviews=sqliteTable('neo_monitor_reviews',{
 id:text('id').primaryKey(),...scope(),day:text('day').notNull(),kind:text('kind').notNull(),slot:integer('slot').notNull(),status:text('status').notNull(),runId:text('run_id'),eventIds:text('event_ids').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_monitor_review_slot').on(t.businessId,t.dataNature,t.day,t.kind,t.slot)]);
// Admission is per enterprise/day across data natures. Results remain scoped
// in monitorReviews; this table stores only the winning immutable slot pointer.
export const monitorAdmissions=sqliteTable('neo_monitor_admissions',{
 businessId:text('business_id').notNull(),day:text('day').notNull(),kind:text('kind').notNull(),slot:integer('slot').notNull(),reviewId:text('review_id').notNull(),dataNature:text('data_nature').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_monitor_enterprise_admission').on(t.businessId,t.day,t.kind,t.slot)]);
