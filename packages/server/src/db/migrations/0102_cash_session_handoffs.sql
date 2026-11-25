CREATE TABLE `cash_session_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`register_name` text NOT NULL,
	`from_session_id` text NOT NULL,
	`from_cashier_id` text NOT NULL,
	`to_cashier_id` text,
	`to_session_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`outgoing_count` real NOT NULL,
	`outgoing_denominations` text NOT NULL,
	`note` text,
	`from_signature` text NOT NULL,
	`handed_over_at` text NOT NULL,
	`receive_mode` text,
	`received_count` real,
	`received_denominations` text,
	`to_signature` text,
	`reassigned_draft_count` integer DEFAULT 0 NOT NULL,
	`received_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_cashier_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_cashier_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_cash_handoffs_outgoing_nonneg" CHECK("cash_session_handoffs"."outgoing_count" >= 0),
	CONSTRAINT "chk_cash_handoffs_outgoing_2dec" CHECK(round("cash_session_handoffs"."outgoing_count", 2) = "cash_session_handoffs"."outgoing_count"),
	CONSTRAINT "chk_cash_handoffs_received_nonneg" CHECK("cash_session_handoffs"."received_count" >= 0),
	CONSTRAINT "chk_cash_handoffs_received_2dec" CHECK(round("cash_session_handoffs"."received_count", 2) = "cash_session_handoffs"."received_count")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cash_handoffs_from_session` ON `cash_session_handoffs` (`from_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cash_handoffs_pending_register` ON `cash_session_handoffs` (`tenant_id`,`site_id`,`register_name`) WHERE "cash_session_handoffs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `idx_cash_handoffs_tenant_status` ON `cash_session_handoffs` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_cash_handoffs_tenant_to_session` ON `cash_session_handoffs` (`tenant_id`,`to_session_id`);--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `difference_reason` text;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `difference_note` text;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `difference_explained_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `difference_explained_at` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `carried_over_at` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `carried_over_by` text REFERENCES users(id);