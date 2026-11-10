CREATE TABLE `neo_platform_config_heads` (
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`config_id` text,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_platform_config_head` ON `neo_platform_config_heads` (`business_id`,`data_nature`);--> statement-breakpoint
CREATE TABLE `neo_platform_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`base_id` text,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_platform_config_scope` ON `neo_platform_configs` (`business_id`,`data_nature`,`status`,`published_at`);