CREATE TABLE `neo_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`kind` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`parent_id` text,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_neo_artifact_request` ON `neo_artifacts` (`business_id`,`kind`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_neo_artifact_scope` ON `neo_artifacts` (`business_id`,`snapshot_id`,`kind`);--> statement-breakpoint
CREATE TABLE `neo_domain_records` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_neo_domain_scope` ON `neo_domain_records` (`business_id`,`data_nature`);--> statement-breakpoint
CREATE TABLE `neo_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `operating_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_neo_input_snapshot` ON `neo_inputs` (`business_id`,`snapshot_id`);--> statement-breakpoint
CREATE TABLE `neo_market_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`run_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `neo_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`session_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`steps` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `neo_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_neo_run_request` ON `neo_runs` (`business_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_neo_run_session` ON `neo_runs` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `neo_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `operating_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
