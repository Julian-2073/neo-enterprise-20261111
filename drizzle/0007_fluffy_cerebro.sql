CREATE TABLE `ontology_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ontology_result_links` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`build_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`link_id` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`available_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ontology_result_link` ON `ontology_result_links` (`business_id`,`data_nature`,`build_id`,`link_id`,`from_id`);--> statement-breakpoint
CREATE TABLE `ontology_result_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`build_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`type_id` text NOT NULL,
	`object_id` text NOT NULL,
	`title` text NOT NULL,
	`properties` text NOT NULL,
	`provenance` text NOT NULL,
	`available_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ontology_result_scope` ON `ontology_result_objects` (`business_id`,`data_nature`,`build_id`,`type_id`,`available_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ontology_result_object` ON `ontology_result_objects` (`artifact_id`,`type_id`,`object_id`);--> statement-breakpoint
DROP INDEX `uq_ontology_edit_base`;--> statement-breakpoint
ALTER TABLE `ontology_edits` ADD `status` text DEFAULT 'rejected' NOT NULL;--> statement-breakpoint
ALTER TABLE `ontology_edits` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `ontology_edits` ADD `result_build_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ontology_edit_base_active` ON `ontology_edits` (`business_id`,`base_build_id`) WHERE status IN ('staged','committed');--> statement-breakpoint
CREATE INDEX `idx_ontology_link_reverse` ON `ontology_links` (`build_id`,`link_id`,`to_id`);
--> statement-breakpoint
UPDATE ontology_edits SET status='committed',result_build_id=(SELECT b.id FROM ontology_builds b WHERE b.business_id=ontology_edits.business_id AND b.data_nature=ontology_edits.data_nature AND b.status IN ('ready','partial') AND EXISTS(SELECT 1 FROM json_each(b.input,'$.edits') e WHERE json_extract(e.value,'$.id')=ontology_edits.id) ORDER BY b.created_at DESC,b.id DESC LIMIT 1) WHERE EXISTS(SELECT 1 FROM ontology_builds b WHERE b.business_id=ontology_edits.business_id AND b.data_nature=ontology_edits.data_nature AND b.status IN ('ready','partial') AND EXISTS(SELECT 1 FROM json_each(b.input,'$.edits') e WHERE json_extract(e.value,'$.id')=ontology_edits.id));
--> statement-breakpoint
INSERT INTO ontology_heads(id,build_id,updated_at) SELECT json_array(b.business_id,b.data_nature,b.as_of,COALESCE(b.snapshot_id,'')),b.id,b.created_at FROM ontology_builds b WHERE b.status IN ('ready','partial') AND NOT EXISTS(SELECT 1 FROM ontology_builds n WHERE n.business_id=b.business_id AND n.data_nature=b.data_nature AND n.as_of=b.as_of AND COALESCE(n.snapshot_id,'')=COALESCE(b.snapshot_id,'') AND n.status IN ('ready','partial') AND (n.created_at>b.created_at OR n.created_at=b.created_at AND n.id>b.id));
