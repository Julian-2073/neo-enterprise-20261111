import {neoBusinessGenerations} from './business-state-schema';
import {sql} from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { businesses, operatingSnapshots } from './schema';

export const ontologyDefinitions = sqliteTable('ontology_definitions', {
  id: text('id').primaryKey(), businessId: text('business_id').notNull().references(() => businesses.id),
  baseId: text('base_id').notNull(), status: text('status').notNull(), payload: text('payload').notNull(),
  actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(), publishedAt: text('published_at'),
}, t => [index('idx_ontology_definition_scope').on(t.businessId, t.status, t.publishedAt)]);
export const ontologyImports = sqliteTable('ontology_imports', {
  id: text('id').primaryKey(), businessId: text('business_id').notNull().references(() => businesses.id),
  dataNature: text('data_nature').notNull(), definitionId: text('definition_id').notNull(), typeId: text('type_id').notNull(),
  sourceName: text('source_name').notNull(), filename: text('filename').notNull(), fileHash: text('file_hash').notNull(),
  objectKey: text('object_key').notNull(), status: text('status').notNull(), rows: text('rows').notNull(), issues: text('issues').notNull(),
  createdAt: text('created_at').notNull(), committedAt: text('committed_at'), actorId: text('actor_id').notNull(),
}, t => [uniqueIndex('uq_ontology_import').on(t.businessId, t.dataNature, t.definitionId, t.typeId, t.sourceName, t.fileHash)]);
export const ontologyBuilds = sqliteTable('ontology_builds', {
  id: text('id').primaryKey(), businessId: text('business_id').notNull().references(() => businesses.id), dataNature: text('data_nature').notNull(),
  definitionId: text('definition_id').notNull(), snapshotId: text('snapshot_id').references(() => operatingSnapshots.id), generationId:text('generation_id').references(()=>neoBusinessGenerations.id),
  asOf: text('as_of').notNull(), knownAt: text('known_at').notNull(), sourceHash: text('source_hash').notNull(),
  status: text('status').notNull(), input: text('input').notNull(), issues: text('issues').notNull(), counts: text('counts').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_ontology_build_scope').on(t.businessId, t.dataNature, t.createdAt)]);
export const ontologyObjects = sqliteTable('ontology_objects', {
  id: text('id').primaryKey(), buildId: text('build_id').notNull().references(() => ontologyBuilds.id), typeId: text('type_id').notNull(),
  objectId: text('object_id').notNull(), title: text('title').notNull(), properties: text('properties').notNull(),
  provenance: text('provenance').notNull(), referenceOnly: integer('reference_only').notNull().default(0),
}, t => [uniqueIndex('uq_ontology_object').on(t.buildId, t.typeId, t.objectId)]);
export const ontologyLinks = sqliteTable('ontology_links', {
  id: text('id').primaryKey(), buildId: text('build_id').notNull().references(() => ontologyBuilds.id), linkId: text('link_id').notNull(),
  fromId: text('from_id').notNull(), toId: text('to_id').notNull(), provenance: text('provenance').notNull(),
}, t => [index('idx_ontology_link_build').on(t.buildId, t.linkId, t.fromId),index('idx_ontology_link_reverse').on(t.buildId,t.linkId,t.toId)]);
export const ontologyObjectSets = sqliteTable('ontology_object_sets', {
  id: text('id').primaryKey(), businessId: text('business_id').notNull().references(() => businesses.id),
  dataNature: text('data_nature').notNull(), buildId: text('build_id').notNull().references(() => ontologyBuilds.id),
  name: text('name').notNull(), query: text('query').notNull(), actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(),
});
export const ontologyEdits = sqliteTable('ontology_edits', {
  id: text('id').primaryKey(), businessId: text('business_id').notNull().references(() => businesses.id), dataNature: text('data_nature').notNull(),
  typeId: text('type_id').notNull(), objectId: text('object_id').notNull(), property: text('property').notNull(),
  baseBuildId: text('base_build_id').notNull(), value: text('value').notNull(), previousValue: text('previous_value').notNull(), actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(), status: text('status').notNull().default('rejected'), runId: text('run_id'), resultBuildId: text('result_build_id'),
}, t => [index('idx_ontology_edit_scope').on(t.businessId, t.dataNature, t.createdAt), uniqueIndex('uq_ontology_edit_base_active').on(t.businessId,t.baseBuildId).where(sql`status IN ('staged','committed')`)]);
export const ontologyRuns = sqliteTable('ontology_runs', {
  id: text('id').primaryKey(), businessId: text('business_id').notNull().references(() => businesses.id), dataNature: text('data_nature').notNull(),
  buildId: text('build_id'), kind: text('kind').notNull(), operation: text('operation').notNull(), requestId: text('request_id').notNull(),
  requestHash: text('request_hash').notNull(), status: text('status').notNull(), input: text('input').notNull(), result: text('result'),
  trace: text('trace').notNull(), error: text('error'), actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('uq_ontology_request').on(t.businessId, t.requestId), index('idx_ontology_run_scope').on(t.businessId, t.dataNature, t.createdAt)]);

export const ontologyHeads = sqliteTable('ontology_heads', {
 id:text('id').primaryKey(), buildId:text('build_id').notNull(), updatedAt:text('updated_at').notNull(),
});
export const ontologyResultObjects = sqliteTable('ontology_result_objects', {
 id:text('id').primaryKey(), businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),buildId:text('build_id').notNull(),
 artifactId:text('artifact_id').notNull(),typeId:text('type_id').notNull(),objectId:text('object_id').notNull(),title:text('title').notNull(),properties:text('properties').notNull(),provenance:text('provenance').notNull(),availableAt:text('available_at').notNull(),
},t=>[index('idx_ontology_result_scope').on(t.businessId,t.dataNature,t.buildId,t.typeId,t.availableAt),uniqueIndex('uq_ontology_result_object').on(t.artifactId,t.typeId,t.objectId)]);
export const ontologyResultLinks = sqliteTable('ontology_result_links', {
 id:text('id').primaryKey(),businessId:text('business_id').notNull(),dataNature:text('data_nature').notNull(),buildId:text('build_id').notNull(),artifactId:text('artifact_id').notNull(),linkId:text('link_id').notNull(),fromId:text('from_id').notNull(),toId:text('to_id').notNull(),availableAt:text('available_at').notNull(),
},t=>[index('idx_ontology_result_link').on(t.businessId,t.dataNature,t.buildId,t.linkId,t.fromId)]);
