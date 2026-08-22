CREATE TABLE `audit_chain_heads` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`head_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `prev_hash` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `chain_hash` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `redacted_at` text;--> statement-breakpoint
CREATE INDEX `idx_audit_logs_chain_hash` ON `audit_logs` (`chain_hash`);