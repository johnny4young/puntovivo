CREATE TABLE `restaurant_modifier_group_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`group_id` text NOT NULL,
	`catalog_id` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `restaurant_modifier_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_id`) REFERENCES `restaurant_modifier_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_restaurant_modifier_group_items_position" CHECK("restaurant_modifier_group_items"."position" BETWEEN 0 AND 19)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_modifier_group_items_option` ON `restaurant_modifier_group_items` (`group_id`,`catalog_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_modifier_group_items_position` ON `restaurant_modifier_group_items` (`group_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_restaurant_modifier_group_items_catalog` ON `restaurant_modifier_group_items` (`tenant_id`,`catalog_id`);--> statement-breakpoint
CREATE TABLE `restaurant_modifier_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`kind` text NOT NULL,
	`selection` text NOT NULL,
	`min_selections` integer DEFAULT 0 NOT NULL,
	`max_selections` integer DEFAULT 1 NOT NULL,
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
	CONSTRAINT "chk_restaurant_modifier_groups_name" CHECK(length(trim("restaurant_modifier_groups"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "chk_restaurant_modifier_groups_kind" CHECK("restaurant_modifier_groups"."kind" IN ('choice', 'without', 'extra')),
	CONSTRAINT "chk_restaurant_modifier_groups_selection" CHECK("restaurant_modifier_groups"."selection" IN ('single', 'multiple')),
	CONSTRAINT "chk_restaurant_modifier_groups_bounds" CHECK("restaurant_modifier_groups"."min_selections" BETWEEN 0 AND 20 AND "restaurant_modifier_groups"."max_selections" BETWEEN 1 AND 20 AND "restaurant_modifier_groups"."min_selections" <= "restaurant_modifier_groups"."max_selections" AND ("restaurant_modifier_groups"."selection" = 'multiple' OR "restaurant_modifier_groups"."max_selections" = 1)),
	CONSTRAINT "chk_restaurant_modifier_groups_version" CHECK("restaurant_modifier_groups"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_restaurant_modifier_groups_site` ON `restaurant_modifier_groups` (`tenant_id`,`site_id`,`is_active`,`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_modifier_groups_active_name` ON `restaurant_modifier_groups` (`tenant_id`,`site_id`,`name_key`) WHERE "restaurant_modifier_groups"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `restaurant_product_modifier_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`group_id` text NOT NULL,
	`product_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `restaurant_modifier_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_product_modifier_groups_pair` ON `restaurant_product_modifier_groups` (`group_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_restaurant_product_modifier_groups_product` ON `restaurant_product_modifier_groups` (`tenant_id`,`product_id`);--> statement-breakpoint
ALTER TABLE `restaurant_line_modifiers` ADD `group_id` text;--> statement-breakpoint
ALTER TABLE `restaurant_line_modifiers` ADD `group_kind` text;