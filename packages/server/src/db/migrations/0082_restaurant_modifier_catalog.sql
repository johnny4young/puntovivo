-- Historical snapshots have no catalog provenance; do not invent an authorization.
CREATE TABLE `restaurant_modifier_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`unit_price_delta` real NOT NULL,
	`max_quantity` integer DEFAULT 20 NOT NULL,
	`requires_manager` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_restaurant_modifier_catalog_name" CHECK(length(trim("restaurant_modifier_catalog"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "chk_restaurant_modifier_catalog_quantity" CHECK("restaurant_modifier_catalog"."max_quantity" BETWEEN 1 AND 20),
	CONSTRAINT "chk_restaurant_modifier_catalog_price" CHECK("restaurant_modifier_catalog"."unit_price_delta" BETWEEN 0 AND 1000000000),
	CONSTRAINT "chk_restaurant_modifier_catalog_price_2dec" CHECK(round("restaurant_modifier_catalog"."unit_price_delta", 2) = "restaurant_modifier_catalog"."unit_price_delta"),
	CONSTRAINT "chk_restaurant_modifier_catalog_version" CHECK("restaurant_modifier_catalog"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_restaurant_modifier_catalog_site` ON `restaurant_modifier_catalog` (`tenant_id`,`site_id`,`is_active`,`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_modifier_catalog_active_name` ON `restaurant_modifier_catalog` (`tenant_id`,`site_id`,`name_key`) WHERE "restaurant_modifier_catalog"."is_active" = 1;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_restaurant_line_modifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`check_line_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_delta` real DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	`catalog_id` text,
	`catalog_version` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`check_line_id`) REFERENCES `restaurant_check_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_id`) REFERENCES `restaurant_modifier_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_restaurant_modifiers_quantity" CHECK("__new_restaurant_line_modifiers"."quantity" BETWEEN 1 AND 20),
	CONSTRAINT "chk_restaurant_modifiers_price" CHECK("__new_restaurant_line_modifiers"."unit_price_delta" >= 0),
	CONSTRAINT "chk_restaurant_modifiers_price_2dec" CHECK(round("__new_restaurant_line_modifiers"."unit_price_delta", 2) = "__new_restaurant_line_modifiers"."unit_price_delta"),
	CONSTRAINT "chk_restaurant_modifiers_position" CHECK("__new_restaurant_line_modifiers"."position" BETWEEN 0 AND 19),
	CONSTRAINT "chk_restaurant_modifiers_catalog_reference" CHECK(("__new_restaurant_line_modifiers"."catalog_id" IS NULL AND "__new_restaurant_line_modifiers"."catalog_version" IS NULL) OR ("__new_restaurant_line_modifiers"."catalog_id" IS NOT NULL AND "__new_restaurant_line_modifiers"."catalog_version" IS NOT NULL AND "__new_restaurant_line_modifiers"."catalog_version" >= 1))
);
--> statement-breakpoint
INSERT INTO `__new_restaurant_line_modifiers`("id", "tenant_id", "check_line_id", "name", "quantity", "unit_price_delta", "position", "catalog_id", "catalog_version", "created_at") SELECT "id", "tenant_id", "check_line_id", "name", "quantity", "unit_price_delta", "position", NULL, NULL, "created_at" FROM `restaurant_line_modifiers`;--> statement-breakpoint
DROP TABLE `restaurant_line_modifiers`;--> statement-breakpoint
ALTER TABLE `__new_restaurant_line_modifiers` RENAME TO `restaurant_line_modifiers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_restaurant_modifiers_tenant_line` ON `restaurant_line_modifiers` (`tenant_id`,`check_line_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_modifiers_line_position` ON `restaurant_line_modifiers` (`check_line_id`,`position`);