CREATE TABLE `neo_execution_proofs` (
	`business_id` text NOT NULL,
	`data_nature` text NOT NULL,
	`proof_id` text NOT NULL,
	`execution_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_execution_proof` ON `neo_execution_proofs` (`business_id`,`data_nature`,`proof_id`);--> statement-breakpoint
CREATE INDEX `idx_execution_proof` ON `neo_execution_proofs` (`execution_id`);