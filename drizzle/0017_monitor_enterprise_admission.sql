CREATE TABLE `neo_monitor_admissions` (
	`business_id` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`slot` integer NOT NULL,
	`review_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_monitor_enterprise_admission` ON `neo_monitor_admissions` (`business_id`,`day`,`kind`,`slot`);--> statement-breakpoint
-- Preserve every historical review. Only the earliest holder of each shared
-- business/day slot owns future admission; duplicate historical rows stay readable.
INSERT OR IGNORE INTO neo_monitor_admissions (business_id,day,kind,slot,review_id,data_nature,created_at)
SELECT business_id,day,kind,slot,id,data_nature,created_at FROM neo_monitor_reviews ORDER BY created_at,id;
