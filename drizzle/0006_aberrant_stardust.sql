CREATE TABLE `ontology_builds` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`definition_id` text NOT NULL,
	`snapshot_id` text,
	`as_of` text NOT NULL,
	`known_at` text NOT NULL,
	`source_hash` text NOT NULL,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`issues` text NOT NULL,
	`counts` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `operating_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ontology_build_scope` ON `ontology_builds` (`business_id`,`data_nature`,`created_at`);--> statement-breakpoint
CREATE TABLE `ontology_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`base_id` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ontology_definition_scope` ON `ontology_definitions` (`business_id`,`status`,`published_at`);--> statement-breakpoint
CREATE TABLE `ontology_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`type_id` text NOT NULL,
	`object_id` text NOT NULL,
	`property` text NOT NULL,
	`base_build_id` text NOT NULL,
	`value` text NOT NULL,
	`previous_value` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ontology_edit_scope` ON `ontology_edits` (`business_id`,`data_nature`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ontology_edit_base` ON `ontology_edits` (`business_id`,`base_build_id`);--> statement-breakpoint
CREATE TABLE `ontology_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`definition_id` text NOT NULL,
	`type_id` text NOT NULL,
	`source_name` text NOT NULL,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	`object_key` text NOT NULL,
	`status` text NOT NULL,
	`rows` text NOT NULL,
	`issues` text NOT NULL,
	`created_at` text NOT NULL,
	`committed_at` text,
	`actor_id` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ontology_import` ON `ontology_imports` (`business_id`,`data_nature`,`definition_id`,`type_id`,`source_name`,`file_hash`);--> statement-breakpoint
CREATE TABLE `ontology_links` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`link_id` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `ontology_builds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ontology_link_build` ON `ontology_links` (`build_id`,`link_id`,`from_id`);--> statement-breakpoint
CREATE TABLE `ontology_object_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`build_id` text NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`build_id`) REFERENCES `ontology_builds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ontology_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`type_id` text NOT NULL,
	`object_id` text NOT NULL,
	`title` text NOT NULL,
	`properties` text NOT NULL,
	`provenance` text NOT NULL,
	`reference_only` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `ontology_builds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ontology_object` ON `ontology_objects` (`build_id`,`type_id`,`object_id`);--> statement-breakpoint
CREATE TABLE `ontology_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`build_id` text,
	`kind` text NOT NULL,
	`operation` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`result` text,
	`trace` text NOT NULL,
	`error` text,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ontology_request` ON `ontology_runs` (`business_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_ontology_run_scope` ON `ontology_runs` (`business_id`,`data_nature`,`created_at`);