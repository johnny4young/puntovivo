CREATE TABLE `site_quick_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text DEFAULT 'product' NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text,
	`label` text,
	`colour` text,
	`created_by` text,
	`updated_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_site_quick_keys_tenant_site_position` ON `site_quick_keys` (`tenant_id`,`site_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_site_quick_keys_product` ON `site_quick_keys` (`product_id`);