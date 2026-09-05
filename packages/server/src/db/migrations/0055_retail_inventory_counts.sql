ALTER TABLE `inventory_balances` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `inventory_count_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`session_id` text NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`expected_quantity` real NOT NULL,
	`expected_balance_version` integer DEFAULT 0 NOT NULL,
	`counted_quantity` real,
	`discrepancy` real,
	`unit_cost_snapshot` real DEFAULT 0 NOT NULL,
	`counted_by` text,
	`counted_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `inventory_count_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_count_lines_counted_nonnegative" CHECK("inventory_count_lines"."counted_quantity" IS NULL OR "inventory_count_lines"."counted_quantity" >= 0),
	CONSTRAINT "inventory_count_lines_cost_nonnegative" CHECK("inventory_count_lines"."unit_cost_snapshot" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_lines_session_product` ON `inventory_count_lines` (`tenant_id`,`session_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_lines_tenant_product` ON `inventory_count_lines` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_lines_session` ON `inventory_count_lines` (`session_id`);--> statement-breakpoint
CREATE TABLE `inventory_count_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`status` text DEFAULT 'counting' NOT NULL,
	`is_blind` integer DEFAULT true NOT NULL,
	`notes` text,
	`rejection_reason` text,
	`created_by` text NOT NULL,
	`submitted_by` text,
	`approved_by` text,
	`rejected_by` text,
	`submitted_at` text,
	`approved_at` text,
	`rejected_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rejected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_count_sessions_tenant_created` ON `inventory_count_sessions` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_sessions_tenant_site_status` ON `inventory_count_sessions` (`tenant_id`,`site_id`,`status`);
