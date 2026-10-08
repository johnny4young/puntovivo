CREATE TABLE `payment_reconciliation_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`rail_id` text NOT NULL,
	`statement_key` text NOT NULL,
	`selected_outbox_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`evidence` text NOT NULL,
	`created_at` text NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payment_proposals_status" CHECK("payment_reconciliation_proposals"."status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_proposals_statement` ON `payment_reconciliation_proposals` (`tenant_id`,`rail_id`,`statement_key`);--> statement-breakpoint
CREATE INDEX `idx_payment_proposals_tenant_status` ON `payment_reconciliation_proposals` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_proposals_one_pending_outbox` ON `payment_reconciliation_proposals` (`tenant_id`,`selected_outbox_id`) WHERE "payment_reconciliation_proposals"."status" = 'pending';