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
CREATE INDEX `idx_control_resource_scope` ON `neo_control_resources` (`business_id`,`data_nature`,`kind`,`created_at`);