CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `business_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`source_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`kind` text NOT NULL,
	`data_nature` text NOT NULL,
	`record_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `ingestion_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fact_source_record` ON `business_facts` (`business_id`,`source_id`,`kind`,`data_nature`,`record_key`);--> statement-breakpoint
CREATE INDEX `idx_fact_scope_date` ON `business_facts` (`business_id`,`data_nature`,`business_date`);--> statement-breakpoint
CREATE TABLE `business_members` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_member` ON `business_members` (`business_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_name` ON `data_sources` (`business_id`,`name`);--> statement-breakpoint
CREATE TABLE `evidence_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`evidence_id` text NOT NULL,
	`fact_id` text NOT NULL,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fact_id`) REFERENCES `business_facts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_facts` ON `evidence_facts` (`evidence_id`,`fact_id`);--> statement-breakpoint
CREATE TABLE `evidence_records` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `operating_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ingestion_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`data_nature` text NOT NULL,
	`template_version` text NOT NULL,
	`file_hash` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`coverage_start` text NOT NULL,
	`coverage_end` text NOT NULL,
	`status` text NOT NULL,
	`validation_version` integer DEFAULT 1 NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`committed_at` text,
	`actor_id` text NOT NULL,
	`error` text,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_batch_file` ON `ingestion_batches` (`business_id`,`source_id`,`kind`,`data_nature`,`template_version`,`file_hash`);--> statement-breakpoint
CREATE INDEX `idx_batch_history` ON `ingestion_batches` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ingestion_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`field` text NOT NULL,
	`code` text NOT NULL,
	`message` text NOT NULL,
	`severity` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `ingestion_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_issues_batch` ON `ingestion_issues` (`batch_id`,`row_number`);--> statement-breakpoint
CREATE TABLE `ingestion_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`record_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`payload` text NOT NULL,
	`duplicate` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `ingestion_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_batch_row` ON `ingestion_rows` (`batch_id`,`row_number`);--> statement-breakpoint
CREATE TABLE `operating_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`generated_at` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_snapshot_latest` ON `operating_snapshots` (`business_id`,`data_nature`,`generated_at`);