CREATE TABLE `register_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text,
	`product_id` text,
	`product_name` text,
	`shelf_price` real,
	`system_price` real,
	`note` text,
	`reported_by` text NOT NULL,
	`cash_session_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`resolution_note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_register_incidents_tenant_status_created` ON `register_incidents` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_register_incidents_tenant_site_status` ON `register_incidents` (`tenant_id`,`site_id`,`status`);