PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_neo_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`snapshot_id` text,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`generation_id` text,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `operating_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generation_id`) REFERENCES `neo_business_generations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_neo_sessions`("id", "business_id", "data_nature", "snapshot_id", "actor_id", "created_at", "generation_id") SELECT "id", "business_id", "data_nature", "snapshot_id", "actor_id", "created_at", NULL FROM `neo_sessions`;--> statement-breakpoint
DROP TABLE `neo_sessions`;--> statement-breakpoint
ALTER TABLE `__new_neo_sessions` RENAME TO `neo_sessions`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;