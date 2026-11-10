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
CREATE INDEX `idx_forecast_job_scope` ON `neo_forecast_jobs` (`business_id`,`data_nature`,`generation_id`,`created_at`);