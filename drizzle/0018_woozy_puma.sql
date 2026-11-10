CREATE TABLE `neo_business_heads` (
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`generation_id` text NOT NULL,
	`event_at` text NOT NULL,
	`event_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_business_head` ON `neo_business_heads` (`business_id`,`data_nature`);--> statement-breakpoint
CREATE TABLE `neo_business_publications` (
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`epoch` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_business_publication` ON `neo_business_publications` (`business_id`,`data_nature`);--> statement-breakpoint
CREATE TABLE `neo_forecast_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`generation_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`control_token` text NOT NULL,
	`input_payload` text NOT NULL,
	`result_id` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_forecast_job_request` ON `neo_forecast_jobs` (`business_id`,`data_nature`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_forecast_job_scope` ON `neo_forecast_jobs` (`business_id`,`data_nature`,`generation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `neo_control_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `neo_control_resources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `neo_control_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`secret` text,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_control_resource_scope` ON `neo_control_resources` (`business_id`,`data_nature`,`kind`,`created_at`);--> statement-breakpoint
ALTER TABLE `ontology_builds` ADD `generation_id` text REFERENCES neo_business_generations(id);
--> statement-breakpoint

INSERT OR IGNORE INTO neo_business_heads(business_id,data_nature,generation_id,event_at,event_id)
SELECT business_id,data_nature,id,COALESCE(json_extract(payload,'$.state.knownAt'),json_extract(payload,'$.summary.state.knownAt'),created_at),''
FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY business_id,data_nature ORDER BY COALESCE(json_extract(payload,'$.state.knownAt'),json_extract(payload,'$.summary.state.knownAt'),created_at) DESC,created_at DESC,id DESC) rank FROM neo_business_generations) WHERE rank=1;
