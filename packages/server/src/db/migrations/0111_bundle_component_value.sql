PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sale_item_bundle_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`component_product_id` text NOT NULL,
	`component_quantity_per_unit` real NOT NULL,
	`total_quantity_deducted` real NOT NULL,
	`unit_cost_at_sale` real DEFAULT 0 NOT NULL,
	`inventory_cost_cents` integer,
	`cogs_cost_cents` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_item_bundle_components_inventory_cost_cents_safe_integer" CHECK("__new_sale_item_bundle_components"."inventory_cost_cents" IS NULL OR (typeof("__new_sale_item_bundle_components"."inventory_cost_cents") = 'integer' AND "__new_sale_item_bundle_components"."inventory_cost_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_sale_item_bundle_components_cogs_cost_cents_safe_integer" CHECK("__new_sale_item_bundle_components"."cogs_cost_cents" IS NULL OR (typeof("__new_sale_item_bundle_components"."cogs_cost_cents") = 'integer' AND "__new_sale_item_bundle_components"."cogs_cost_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_sale_item_bundle_components_valuation_basis_0" CHECK(("__new_sale_item_bundle_components"."inventory_cost_cents" IS NULL AND "__new_sale_item_bundle_components"."cogs_cost_cents" IS NULL) OR ("__new_sale_item_bundle_components"."inventory_cost_cents" IS NOT NULL AND "__new_sale_item_bundle_components"."cogs_cost_cents" IS NOT NULL)),
	CONSTRAINT "chk_sale_item_bundle_components_qty" CHECK("__new_sale_item_bundle_components"."component_quantity_per_unit" > 0 AND "__new_sale_item_bundle_components"."total_quantity_deducted" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_sale_item_bundle_components`("id", "tenant_id", "sale_item_id", "component_product_id", "component_quantity_per_unit", "total_quantity_deducted", "unit_cost_at_sale", "created_at") SELECT "id", "tenant_id", "sale_item_id", "component_product_id", "component_quantity_per_unit", "total_quantity_deducted", "unit_cost_at_sale", "created_at" FROM `sale_item_bundle_components`;--> statement-breakpoint
DROP TABLE `sale_item_bundle_components`;--> statement-breakpoint
ALTER TABLE `__new_sale_item_bundle_components` RENAME TO `sale_item_bundle_components`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sale_item_bundle_components_sale_item` ON `sale_item_bundle_components` (`tenant_id`,`sale_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_bundle_components_component` ON `sale_item_bundle_components` (`tenant_id`,`component_product_id`);