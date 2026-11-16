CREATE TABLE `cash_session_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`register_name` text NOT NULL,
	`from_session_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`from_user_name` text NOT NULL,
	`counted_total` real NOT NULL,
	`counted_denominations` text NOT NULL,
	`note` text,
	`carried_sale_ids` text NOT NULL,
	`notices` text NOT NULL,
	`to_session_id` text,
	`to_user_id` text,
	`to_user_name` text,
	`receive_mode` text,
	`recount_total` real,
	`recount_denominations` text,
	`recount_difference` real,
	`received_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cash_session_handoffs_tenant_site_created` ON `cash_session_handoffs` (`tenant_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cash_session_handoffs_tenant_from_session` ON `cash_session_handoffs` (`tenant_id`,`from_session_id`);--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `variance_reason` text;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `variance_note` text;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `variance_explained_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `variance_explained_at` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `carried_over_at` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `carried_over_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `day_close_signoffs` ADD `signature_method` text;--> statement-breakpoint
ALTER TABLE `day_close_signoffs` ADD `signature_image` text;