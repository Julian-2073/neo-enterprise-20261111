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
CREATE UNIQUE INDEX `uq_business_publication` ON `neo_business_publications` (`business_id`,`data_nature`);
--> statement-breakpoint
INSERT INTO neo_business_heads(business_id,data_nature,generation_id,event_at,event_id)
SELECT business_id,data_nature,id,COALESCE(json_extract(payload,'$.state.knownAt'),json_extract(payload,'$.summary.state.knownAt'),created_at),''
FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY business_id,data_nature ORDER BY COALESCE(json_extract(payload,'$.state.knownAt'),json_extract(payload,'$.summary.state.knownAt'),created_at) DESC,created_at DESC,id DESC) rank FROM neo_business_generations) WHERE rank=1;
