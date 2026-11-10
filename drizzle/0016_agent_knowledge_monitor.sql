CREATE TABLE `neo_enterprise_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`actor_id` text NOT NULL,
	`confirmed_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_enterprise_memory_scope` ON `neo_enterprise_memories` (`business_id`,`data_nature`,`state`);--> statement-breakpoint
CREATE TABLE `neo_knowledge_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`resource_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `neo_knowledge_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`document_id` text NOT NULL,
	`body_hash` text NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_claim_scope` ON `neo_knowledge_claims` (`business_id`,`data_nature`,`state`);--> statement-breakpoint
CREATE TABLE `neo_knowledge_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`consumer_id` text NOT NULL,
	`consumer_kind` text NOT NULL,
	`dependency_id` text NOT NULL,
	`dependency_version` text NOT NULL,
	`status` text DEFAULT 'current' NOT NULL,
	`reason` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_dependency` ON `neo_knowledge_dependencies` (`business_id`,`data_nature`,`consumer_id`,`dependency_id`,`dependency_version`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_dependency_reverse` ON `neo_knowledge_dependencies` (`dependency_id`,`dependency_version`);--> statement-breakpoint
CREATE TABLE `neo_knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`source_id` text NOT NULL,
	`source_version` integer NOT NULL,
	`content_hash` text NOT NULL,
	`original_id` text NOT NULL,
	`raw_text` text NOT NULL,
	`paragraphs` text NOT NULL,
	`published_at` text,
	`retrieved_at` text NOT NULL,
	`coverage` text NOT NULL,
	`state` text DEFAULT 'candidate' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_document` ON `neo_knowledge_documents` (`business_id`,`data_nature`,`source_id`,`source_version`,`content_hash`);--> statement-breakpoint
CREATE TABLE `neo_knowledge_events` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`event_key` text NOT NULL,
	`classification` text NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`occurred_at` text,
	`discovered_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_event` ON `neo_knowledge_events` (`business_id`,`data_nature`,`event_key`);--> statement-breakpoint
CREATE TABLE `neo_knowledge_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`response` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_request` ON `neo_knowledge_requests` (`business_id`,`data_nature`,`request_id`);--> statement-breakpoint
CREATE TABLE `neo_knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_source_url` ON `neo_knowledge_sources` (`business_id`,`data_nature`,`url`);--> statement-breakpoint
CREATE TABLE `neo_monitor_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`slot` integer NOT NULL,
	`status` text NOT NULL,
	`run_id` text,
	`event_ids` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_monitor_review_slot` ON `neo_monitor_reviews` (`business_id`,`data_nature`,`day`,`kind`,`slot`);--> statement-breakpoint
CREATE TABLE `neo_monitor_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`configuration_version` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`last_schedule_at` text,
	`last_success_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_monitor_subscription` ON `neo_monitor_subscriptions` (`business_id`,`data_nature`);--> statement-breakpoint
CREATE TABLE `neo_monitor_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`source_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`lease_owner` text,
	`lease_until` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retry_at` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_monitor_task` ON `neo_monitor_tasks` (`business_id`,`data_nature`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_monitor_task_queue` ON `neo_monitor_tasks` (`status`,`retry_at`);