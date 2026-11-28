CREATE TABLE `restaurant_modifier_bom_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`catalog_id` text NOT NULL,
	`component_product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`catalog_id`) REFERENCES `restaurant_modifier_catalog`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_restaurant_modifier_bom_quantity" CHECK("restaurant_modifier_bom_components"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_modifier_bom_pair` ON `restaurant_modifier_bom_components` (`tenant_id`,`catalog_id`,`component_product_id`);--> statement-breakpoint
CREATE INDEX `idx_restaurant_modifier_bom_component` ON `restaurant_modifier_bom_components` (`tenant_id`,`component_product_id`);--> statement-breakpoint
CREATE TABLE `sale_item_modifier_bom_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`catalog_id` text,
	`modifier_name` text NOT NULL,
	`component_product_id` text NOT NULL,
	`component_quantity_per_modifier` real NOT NULL,
	`total_quantity_deducted` real NOT NULL,
	`unit_cost_at_sale` real NOT NULL,
	`inventory_cost_cents` integer,
	`cogs_cost_cents` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_item_modifier_bom_components_inventory_cost_cents_safe_integer" CHECK("sale_item_modifier_bom_components"."inventory_cost_cents" IS NULL OR (typeof("sale_item_modifier_bom_components"."inventory_cost_cents") = 'integer' AND "sale_item_modifier_bom_components"."inventory_cost_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_sale_item_modifier_bom_components_cogs_cost_cents_safe_integer" CHECK("sale_item_modifier_bom_components"."cogs_cost_cents" IS NULL OR (typeof("sale_item_modifier_bom_components"."cogs_cost_cents") = 'integer' AND "sale_item_modifier_bom_components"."cogs_cost_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_sale_item_modifier_bom_components_valuation_basis_0" CHECK(("sale_item_modifier_bom_components"."inventory_cost_cents" IS NULL AND "sale_item_modifier_bom_components"."cogs_cost_cents" IS NULL) OR ("sale_item_modifier_bom_components"."inventory_cost_cents" IS NOT NULL AND "sale_item_modifier_bom_components"."cogs_cost_cents" IS NOT NULL)),
	CONSTRAINT "chk_sale_item_modifier_bom_quantities" CHECK("sale_item_modifier_bom_components"."component_quantity_per_modifier" > 0 AND "sale_item_modifier_bom_components"."total_quantity_deducted" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_sale_item_modifier_bom_item` ON `sale_item_modifier_bom_components` (`tenant_id`,`sale_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_modifier_bom_component` ON `sale_item_modifier_bom_components` (`tenant_id`,`component_product_id`);--> statement-breakpoint
ALTER TABLE `kds_stations` ADD `printer_config_json` text;