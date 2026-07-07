CREATE TABLE `sale_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_item_lots_unit_cost_nonneg" CHECK("sale_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_sale_item_lots_unit_cost_2dec" CHECK(round("sale_item_lots"."unit_cost", 2) = "sale_item_lots"."unit_cost")
);
--> statement-breakpoint
CREATE INDEX `idx_sale_item_lots_tenant` ON `sale_item_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_lots_sale_item` ON `sale_item_lots` (`sale_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_lots_lot` ON `sale_item_lots` (`lot_id`);