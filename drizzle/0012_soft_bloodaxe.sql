ALTER TABLE `neo_business_updates` ADD `lease_until` text;--> statement-breakpoint
ALTER TABLE `neo_business_updates` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `neo_business_updates` ADD `last_error` text;