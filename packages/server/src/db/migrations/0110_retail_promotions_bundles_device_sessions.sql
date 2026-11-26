CREATE TABLE `product_bundle_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`bundle_product_id` text NOT NULL,
	`component_product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bundle_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_product_bundle_components_qty" CHECK("product_bundle_components"."quantity" > 0),
	CONSTRAINT "chk_product_bundle_components_no_self" CHECK("product_bundle_components"."bundle_product_id" <> "product_bundle_components"."component_product_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_bundle_components_unique` ON `product_bundle_components` (`tenant_id`,`bundle_product_id`,`component_product_id`);--> statement-breakpoint
CREATE INDEX `idx_product_bundle_components_bundle` ON `product_bundle_components` (`tenant_id`,`bundle_product_id`);--> statement-breakpoint
CREATE INDEX `idx_product_bundle_components_component` ON `product_bundle_components` (`tenant_id`,`component_product_id`);--> statement-breakpoint
CREATE TABLE `sale_item_bundle_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`component_product_id` text NOT NULL,
	`component_quantity_per_unit` real NOT NULL,
	`total_quantity_deducted` real NOT NULL,
	`unit_cost_at_sale` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_item_bundle_components_qty" CHECK("sale_item_bundle_components"."component_quantity_per_unit" > 0 AND "sale_item_bundle_components"."total_quantity_deducted" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_sale_item_bundle_components_sale_item` ON `sale_item_bundle_components` (`tenant_id`,`sale_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_bundle_components_component` ON `sale_item_bundle_components` (`tenant_id`,`component_product_id`);--> statement-breakpoint
CREATE TABLE `device_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`device_id` text NOT NULL,
	`user_id` text NOT NULL,
	`refresh_family_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revoked_at` text,
	`revoked_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refresh_family_id`) REFERENCES `auth_refresh_families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_device_sessions_refresh_family` ON `device_sessions` (`refresh_family_id`);--> statement-breakpoint
CREATE INDEX `idx_device_sessions_tenant_device_status` ON `device_sessions` (`tenant_id`,`device_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_device_sessions_tenant_user_status` ON `device_sessions` (`tenant_id`,`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `products` ADD `is_returnable_container` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `returnable_deposit_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `promotions` ADD `rule_kind` text DEFAULT 'percentage' NOT NULL;--> statement-breakpoint
ALTER TABLE `promotions` ADD `discount_amount` real;--> statement-breakpoint
ALTER TABLE `promotions` ADD `buy_quantity` integer;--> statement-breakpoint
ALTER TABLE `promotions` ADD `pay_quantity` integer;--> statement-breakpoint
ALTER TABLE `promotions` ADD `schedule_days` text;--> statement-breakpoint
ALTER TABLE `promotions` ADD `schedule_start_time` text;--> statement-breakpoint
ALTER TABLE `promotions` ADD `schedule_end_time` text;