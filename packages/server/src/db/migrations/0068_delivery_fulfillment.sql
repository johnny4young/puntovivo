-- Drizzle rebuild selects added columns from the old table; use explicit unknown legacy defaults instead.
CREATE TABLE `delivery_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`delivery_order_id` text NOT NULL,
	`version` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivery_order_id`) REFERENCES `delivery_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_delivery_events_version" CHECK("delivery_order_events"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_delivery_events_version` ON `delivery_order_events` (`tenant_id`,`delivery_order_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_delivery_events_site` ON `delivery_order_events` (`tenant_id`,`site_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_delivery_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`customer_id` text,
	`customer_name` text NOT NULL,
	`customer_phone` text,
	`address` text NOT NULL,
	`address_notes` text,
	`courier_name` text,
	`status` text DEFAULT 'accepted' NOT NULL,
	`source` text DEFAULT 'legacy' NOT NULL,
	`currency_code` text,
	`version` integer DEFAULT 1 NOT NULL,
	`cancellation_reason` text,
	`total_amount` real DEFAULT 0 NOT NULL,
	`items_snapshot` text,
	`sale_id` text,
	`accepted_at` text DEFAULT (datetime('now')) NOT NULL,
	`preparing_at` text,
	`dispatched_at` text,
	`delivered_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_delivery_orders_version" CHECK("__new_delivery_orders"."version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_delivery_orders`("id", "tenant_id", "site_id", "customer_id", "customer_name", "customer_phone", "address", "address_notes", "courier_name", "status", "source", "currency_code", "version", "cancellation_reason", "total_amount", "items_snapshot", "sale_id", "accepted_at", "preparing_at", "dispatched_at", "delivered_at", "cancelled_at", "created_at", "updated_at") SELECT "id", "tenant_id", "site_id", "customer_id", "customer_name", "customer_phone", "address", "address_notes", "courier_name", "status", 'legacy', NULL, 1, NULL, "total_amount", "items_snapshot", "sale_id", "accepted_at", "preparing_at", "dispatched_at", "delivered_at", "cancelled_at", "created_at", "updated_at" FROM `delivery_orders`;--> statement-breakpoint
DROP TABLE `delivery_orders`;--> statement-breakpoint
ALTER TABLE `__new_delivery_orders` RENAME TO `delivery_orders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_delivery_orders_tenant_site_status` ON `delivery_orders` (`tenant_id`,`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_delivery_orders_tenant_accepted` ON `delivery_orders` (`tenant_id`,`accepted_at`);--> statement-breakpoint
CREATE INDEX `idx_delivery_orders_queue_cursor` ON `delivery_orders` (`tenant_id`,`site_id`,`status`,`accepted_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_delivery_orders_sale` ON `delivery_orders` (`tenant_id`,`sale_id`);