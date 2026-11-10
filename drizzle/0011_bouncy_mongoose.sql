CREATE TABLE `neo_business_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`source_key` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_business_generation_source` ON `neo_business_generations` (`business_id`,`data_nature`,`source_key`);--> statement-breakpoint
CREATE INDEX `idx_business_generation_latest` ON `neo_business_generations` (`business_id`,`data_nature`,`created_at`);--> statement-breakpoint
CREATE TABLE `neo_business_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`source_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_business_import_request` ON `neo_business_imports` (`business_id`,`data_nature`,`request_id`);--> statement-breakpoint
CREATE TABLE `neo_business_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`source_id` text NOT NULL,
	`record_key` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`business_date` text NOT NULL,
	`known_at` text NOT NULL,
	`supersedes_id` text,
	`payload` text NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_business_input_revision` ON `neo_business_inputs` (`business_id`,`data_nature`,`source_id`,`record_key`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_business_input_window` ON `neo_business_inputs` (`business_id`,`data_nature`,`business_date`);--> statement-breakpoint
CREATE INDEX `idx_business_input_key` ON `neo_business_inputs` (`business_id`,`data_nature`,`source_id`,`record_key`,`known_at`);--> statement-breakpoint
CREATE TABLE `neo_business_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_business_profile_version` ON `neo_business_profiles` (`business_id`,`data_nature`,`version`);--> statement-breakpoint
CREATE TABLE `neo_business_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`cause` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_business_update_pending` ON `neo_business_updates` (`status`,`business_id`,`data_nature`);--> statement-breakpoint
CREATE TABLE `neo_decision_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`decision_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_decision_execution_request` ON `neo_decision_executions` (`business_id`,`data_nature`,`request_id`);