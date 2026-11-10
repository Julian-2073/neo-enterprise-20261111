import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {sql} from 'drizzle-orm';
export * from './ontology-schema';
export * from './business-state-schema';
import {neoBusinessGenerations} from './business-state-schema';

export const datasets = sqliteTable("datasets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceFilename: text("source_filename").notNull(),
  rowCount: integer("row_count").notNull(),
  importedAt: text("imported_at").notNull(),
});

export const businessEvents = sqliteTable("business_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  occurredAt: text("occurred_at").notNull(),
  eventType: text("event_type").notNull(),
  stage: text("stage", { enum: ["A1", "A2", "A3", "A4", "A5"] }).notNull(),
  channel: text("channel").notNull(),
  artworkName: text("artwork_name"),
  contactId: text("contact_id"),
  quantity: integer("quantity").notNull().default(1),
  revenueCents: integer("revenue_cents").notNull().default(0),
  spendCents: integer("spend_cents").notNull().default(0),
}, (table) => [
  index("idx_business_events_dataset_stage").on(table.datasetId, table.stage),
  index("idx_business_events_dataset_occurred_at").on(table.datasetId, table.occurredAt),
]);

// v1 business facts are typed by kind; payloads follow server/contracts.ts.
export const businesses = sqliteTable("businesses", {
  id: text("id").primaryKey(), name: text("name").notNull(),
});
export const businessMembers = sqliteTable("business_members", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businesses.id),
  userId: text("user_id").notNull(), role: text("role", { enum: ["admin", "importer", "reader"] }).notNull(),
}, t => [uniqueIndex("uq_member").on(t.businessId, t.userId)]);
export const dataSources = sqliteTable("data_sources", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businesses.id), name: text("name").notNull(),
}, t => [uniqueIndex("uq_source_name").on(t.businessId, t.name)]);
export const ingestionBatches = sqliteTable("ingestion_batches", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businesses.id),
  sourceId: text("source_id").notNull().references(() => dataSources.id), kind: text("kind").notNull(), dataNature: text("data_nature").notNull(),
  templateVersion: text("template_version").notNull(), fileHash: text("file_hash").notNull(), objectKey: text("object_key").notNull(), filename: text("filename").notNull(),
  coverageStart: text("coverage_start").notNull(), coverageEnd: text("coverage_end").notNull(),
  status: text("status").notNull(), validationVersion: integer("validation_version").notNull().default(1),
  rowCount: integer("row_count").notNull().default(0), duplicateCount: integer("duplicate_count").notNull().default(0), importedCount: integer("imported_count").notNull().default(0),
  validationStartedAt: text("validation_started_at").notNull().default(""),
  createdAt: text("created_at").notNull(), committedAt: text("committed_at"), actorId: text("actor_id").notNull(), error: text("error"),
}, t => [uniqueIndex("uq_batch_file").on(t.businessId, t.sourceId, t.kind, t.dataNature, t.templateVersion, t.fileHash), index("idx_batch_history").on(t.businessId, t.createdAt)]);
export const ingestionRows = sqliteTable("ingestion_rows", {
  id: text("id").primaryKey(), batchId: text("batch_id").notNull().references(() => ingestionBatches.id), rowNumber: integer("row_number").notNull(),
  recordKey: text("record_key").notNull(), contentHash: text("content_hash").notNull(), payload: text("payload").notNull(), duplicate: integer("duplicate").notNull().default(0),
}, t => [uniqueIndex("uq_batch_row").on(t.batchId, t.rowNumber)]);
export const ingestionIssues = sqliteTable("ingestion_issues", {
  id: text("id").primaryKey(), batchId: text("batch_id").notNull().references(() => ingestionBatches.id), rowNumber: integer("row_number").notNull(),
  field: text("field").notNull(), code: text("code").notNull(), message: text("message").notNull(), severity: text("severity").notNull(),
}, t => [index("idx_issues_batch").on(t.batchId, t.rowNumber)]);
export const businessFacts = sqliteTable("business_facts", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businesses.id), sourceId: text("source_id").notNull().references(() => dataSources.id),
  batchId: text("batch_id").notNull().references(() => ingestionBatches.id), rowNumber: integer("row_number").notNull(), kind: text("kind").notNull(), dataNature: text("data_nature").notNull(),
  recordKey: text("record_key").notNull(), contentHash: text("content_hash").notNull(), occurredAt: text("occurred_at").notNull(), businessDate: text("business_date").notNull(), payload: text("payload").notNull(),
}, t => [uniqueIndex("uq_fact_source_record").on(t.businessId, t.sourceId, t.kind, t.dataNature, t.recordKey), index("idx_fact_scope_date").on(t.businessId, t.dataNature, t.businessDate),
uniqueIndex('uq_material_version').on(t.businessId,t.dataNature,t.kind,t.recordKey).where(sql`${t.kind} IN ('roles','products','skus','channels','warehouses','customers','customer_identities','arrivals','supply_rules')`)]);
export const operatingSnapshots = sqliteTable("operating_snapshots", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businesses.id), dataNature: text("data_nature").notNull(), generatedAt: text("generated_at").notNull(), payload: text("payload").notNull(),
}, t => [index("idx_snapshot_latest").on(t.businessId, t.dataNature, t.generatedAt)]);
export const evidenceRecords = sqliteTable("evidence_records", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businesses.id), snapshotId: text("snapshot_id").notNull().references(() => operatingSnapshots.id), payload: text("payload").notNull(),
});
export const evidenceFacts = sqliteTable("evidence_facts", {
  id: text("id").primaryKey(), evidenceId: text("evidence_id").notNull().references(() => evidenceRecords.id), factId: text("fact_id").notNull().references(() => businessFacts.id),
}, t => [index("idx_evidence_facts").on(t.evidenceId, t.factId)]);
export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), businessId: text("business_id").notNull().references(() => businesses.id), actorId: text("actor_id").notNull(),
  action: text("action").notNull(), resourceId: text("resource_id").notNull(), createdAt: text("created_at").notNull(),
});

// Decision-support product records. Original imported facts remain immutable.
export const neoDomainRecords = sqliteTable('neo_domain_records', {
 id:text('id').primaryKey(),businessId:text('business_id').notNull().references(()=>businesses.id),dataNature:text('data_nature').notNull(),kind:text('kind').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_neo_domain_scope').on(t.businessId,t.dataNature)]);
export const neoInputs = sqliteTable('neo_inputs', {
 id:text('id').primaryKey(),businessId:text('business_id').notNull().references(()=>businesses.id),snapshotId:text('snapshot_id').notNull().references(()=>operatingSnapshots.id),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_neo_input_snapshot').on(t.businessId,t.snapshotId)]);
export const neoSessions = sqliteTable('neo_sessions', {
 id:text('id').primaryKey(),businessId:text('business_id').notNull().references(()=>businesses.id),dataNature:text('data_nature').notNull(),snapshotId:text('snapshot_id').references(()=>operatingSnapshots.id),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),generationId:text('generation_id').references(()=>neoBusinessGenerations.id),
});
export const neoRuns = sqliteTable('neo_runs', {
 id:text('id').primaryKey(),businessId:text('business_id').notNull().references(()=>businesses.id),dataNature:text('data_nature').notNull(),snapshotId:text('snapshot_id').notNull(),sessionId:text('session_id').notNull().references(()=>neoSessions.id),requestId:text('request_id').notNull(),requestHash:text('request_hash').notNull(),payload:text('payload').notNull(),status:text('status').notNull(),result:text('result'),steps:text('steps').notNull().default('[]'),error:text('error'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('uq_neo_run_request').on(t.businessId,t.requestId),index('idx_neo_run_session').on(t.sessionId,t.createdAt)]);
export const neoArtifacts = sqliteTable('neo_artifacts', {
 id:text('id').primaryKey(),businessId:text('business_id').notNull().references(()=>businesses.id),dataNature:text('data_nature').notNull(),snapshotId:text('snapshot_id').notNull(),kind:text('kind').notNull(),requestId:text('request_id').notNull(),requestHash:text('request_hash').notNull(),parentId:text('parent_id'),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_neo_artifact_request').on(t.businessId,t.kind,t.requestId),index('idx_neo_artifact_scope').on(t.businessId,t.snapshotId,t.kind)]);
export const neoMarketEvidence = sqliteTable('neo_market_evidence', {
 id:text('id').primaryKey(),businessId:text('business_id').notNull().references(()=>businesses.id),snapshotId:text('snapshot_id').notNull(),runId:text('run_id').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
});

export const neoPlatformConfigs=sqliteTable('neo_platform_configs',{
 id:text('id').primaryKey(),businessId:text('business_id').notNull().references(()=>businesses.id),dataNature:text('data_nature').notNull(),baseId:text('base_id'),status:text('status').notNull(),payload:text('payload').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),publishedAt:text('published_at'),
},t=>[index('idx_platform_config_scope').on(t.businessId,t.dataNature,t.status,t.publishedAt)]);
export const neoPlatformConfigHeads=sqliteTable('neo_platform_config_heads',{
 businessId:text('business_id').notNull().references(()=>businesses.id),dataNature:text('data_nature').notNull(),configId:text('config_id'),
},t=>[uniqueIndex('uq_platform_config_head').on(t.businessId,t.dataNature)]);

export * from "./knowledge-schema";
export * from './control-plane-schema';
