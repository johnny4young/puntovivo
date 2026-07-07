CREATE TABLE `inventory_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lot_number` text NOT NULL,
	`expires_at` text,
	`on_hand` real DEFAULT 0 NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`received_at` text DEFAULT (datetime('now')) NOT NULL,
	`notes` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_inventory_lots_unit_cost_nonneg" CHECK("inventory_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_inventory_lots_unit_cost_2dec" CHECK(round("inventory_lots"."unit_cost", 2) = "inventory_lots"."unit_cost")
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_tenant` ON `inventory_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_site` ON `inventory_lots` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_product` ON `inventory_lots` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_fefo` ON `inventory_lots` (`tenant_id`,`site_id`,`product_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_expires` ON `inventory_lots` (`tenant_id`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_lots_scope` ON `inventory_lots` (`tenant_id`,`site_id`,`product_id`,`lot_number`);--> statement-breakpoint
ALTER TABLE `products` ADD `tracks_lots` integer DEFAULT false NOT NULL;