import {index,integer,sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const neoBusinessProfiles=sqliteTable('neo_business_profiles',{
 id:text('id').primaryKey(),businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),version:integer('version').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_business_profile_version').on(t.businessId,t.dataNature,t.version)]);
export const neoBusinessInputs=sqliteTable('neo_business_inputs',{
 id:text('id').primaryKey(),businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),sourceId:text('source_id').notNull(),importId:text('import_id'),recordKey:text('record_key').notNull(),revision:integer('revision').notNull(),kind:text('kind').notNull(),businessDate:text('business_date').notNull(),knownAt:text('known_at').notNull(),supersedesId:text('supersedes_id'),payload:text('payload').notNull(),contentHash:text('content_hash').notNull(),
},t=>[uniqueIndex('uq_business_input_revision').on(t.businessId,t.dataNature,t.sourceId,t.recordKey,t.revision),index('idx_business_input_window').on(t.businessId,t.dataNature,t.businessDate),index('idx_business_input_key').on(t.businessId,t.dataNature,t.sourceId,t.recordKey,t.knownAt)]);
export const neoBusinessImports=sqliteTable('neo_business_imports',{
 id:text('id').primaryKey(),businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),requestId:text('request_id').notNull(),requestHash:text('request_hash').notNull(),sourceId:text('source_id').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_business_import_request').on(t.businessId,t.dataNature,t.requestId)]);
export const neoBusinessGenerations=sqliteTable('neo_business_generations',{
 id:text('id').primaryKey(),businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),sourceKey:text('source_key').notNull(),status:text('status').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('uq_business_generation_source').on(t.businessId,t.dataNature,t.sourceKey),index('idx_business_generation_latest').on(t.businessId,t.dataNature,t.createdAt)]);
export const neoBusinessUpdates=sqliteTable('neo_business_updates',{
 id:text('id').primaryKey(),businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),cause:text('cause').notNull(),resourceId:text('resource_id').notNull(),status:text('status').notNull(),leaseUntil:text('lease_until'),attempts:integer('attempts').notNull().default(0),lastError:text('last_error'),createdAt:text('created_at').notNull(),
},t=>[index('idx_business_update_pending').on(t.status,t.businessId,t.dataNature)]);
export const neoDecisionExecutions=sqliteTable('neo_decision_executions',{
 id:text('id').primaryKey(),businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),decisionId:text('decision_id').notNull(),requestId:text('request_id').notNull(),requestHash:text('request_hash').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_decision_execution_request').on(t.businessId,t.dataNature,t.requestId)]);
export const neoExecutionProofs=sqliteTable('neo_execution_proofs',{
 businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),proofId:text('proof_id').notNull(),executionId:text('execution_id').notNull(),
},t=>[uniqueIndex('uq_execution_proof').on(t.businessId,t.dataNature,t.proofId),index('idx_execution_proof').on(t.executionId)]);
export const neoBusinessPublications=sqliteTable('neo_business_publications',{
 businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),epoch:integer('epoch').notNull(),
},t=>[uniqueIndex('uq_business_publication').on(t.businessId,t.dataNature)]);
export const neoBusinessHeads=sqliteTable('neo_business_heads',{
 businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),generationId:text('generation_id').notNull(),eventAt:text('event_at').notNull(),eventId:text('event_id').notNull(),
},t=>[uniqueIndex('uq_business_head').on(t.businessId,t.dataNature)]);
export const neoForecastJobs=sqliteTable('neo_forecast_jobs',{
 id:text('id').primaryKey(),businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),generationId:text('generation_id').notNull(),requestId:text('request_id').notNull(),requestHash:text('request_hash').notNull(),status:text('status').notNull(),controlToken:text('control_token').notNull(),inputPayload:text('input_payload').notNull(),resultId:text('result_id'),errorCode:text('error_code'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('uq_forecast_job_request').on(t.businessId,t.dataNature,t.requestId),index('idx_forecast_job_scope').on(t.businessId,t.dataNature,t.generationId,t.createdAt)]);
