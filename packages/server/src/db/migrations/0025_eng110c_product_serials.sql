CREATE TABLE `product_serials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`current_site_id` text NOT NULL,
	`product_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`status` text DEFAULT 'in_stock' NOT NULL,
	`sale_item_id` text,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`warranty_expires_at` text,
	`received_at` text DEFAULT (datetime('now')) NOT NULL,
	`sold_at` text,
	`returned_at` text,
	`notes` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_product_serials_unit_cost_nonneg" CHECK("product_serials"."unit_cost" >= 0),
	CONSTRAINT "chk_product_serials_unit_cost_2dec" CHECK(round("product_serials"."unit_cost", 2) = "product_serials"."unit_cost")
);
--> statement-breakpoint
CREATE INDEX `idx_product_serials_tenant_product` ON `product_serials` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_product_serials_tenant_site_status` ON `product_serials` (`tenant_id`,`current_site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_product_serials_sale_item` ON `product_serials` (`sale_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_serials_tenant_product_number` ON `product_serials` (`tenant_id`,`product_id`,`serial_number`);--> statement-breakpoint
CREATE TABLE `sale_item_serials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`product_serial_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_serial_id`) REFERENCES `product_serials`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_sale_item_serials_tenant` ON `sale_item_serials` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_serials_sale_item` ON `sale_item_serials` (`sale_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_serials_product_serial` ON `sale_item_serials` (`product_serial_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_item_serials_line_serial` ON `sale_item_serials` (`tenant_id`,`sale_item_id`,`product_serial_id`);--> statement-breakpoint
ALTER TABLE `products` ADD `tracks_serials` integer DEFAULT false NOT NULL;