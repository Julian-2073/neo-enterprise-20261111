CREATE TABLE `business_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dataset_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`event_type` text NOT NULL,
	`stage` text NOT NULL,
	`channel` text NOT NULL,
	`contact_id` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`revenue_cents` integer DEFAULT 0 NOT NULL,
	`spend_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_business_events_dataset_stage` ON `business_events` (`dataset_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_business_events_dataset_occurred_at` ON `business_events` (`dataset_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_filename` text NOT NULL,
	`row_count` integer NOT NULL,
	`imported_at` text NOT NULL
);
