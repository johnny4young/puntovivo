CREATE TABLE `price_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`discount_pct` integer NOT NULL,
	`reason` text DEFAULT 'expiry' NOT NULL,
	`lot_expires_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_price_suggestions_tenant_status` ON `price_suggestions` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_price_suggestions_tenant_product` ON `price_suggestions` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_price_suggestions_active_lot` ON `price_suggestions` (`tenant_id`,`lot_id`) WHERE "price_suggestions"."status" = 'active';