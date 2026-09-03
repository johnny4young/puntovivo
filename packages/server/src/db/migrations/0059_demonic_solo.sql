CREATE TABLE `restaurant_check_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`check_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`round_id` text,
	`course_id` text,
	`diner_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`check_id`) REFERENCES `restaurant_checks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`round_id`) REFERENCES `restaurant_rounds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`course_id`) REFERENCES `restaurant_courses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`diner_id`) REFERENCES `restaurant_diners`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_check_lines_tenant_sale_item` ON `restaurant_check_lines` (`tenant_id`,`sale_item_id`);--> statement-breakpoint
CREATE INDEX `idx_restaurant_check_lines_tenant_check` ON `restaurant_check_lines` (`tenant_id`,`check_id`);--> statement-breakpoint
CREATE INDEX `idx_restaurant_check_lines_round` ON `restaurant_check_lines` (`round_id`);--> statement-breakpoint
CREATE TABLE `restaurant_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`service_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`label` text,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` text DEFAULT (datetime('now')) NOT NULL,
	`closed_by` text,
	`closed_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `restaurant_services`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_restaurant_checks_status" CHECK("restaurant_checks"."status" IN ('open', 'settled', 'cancelled')),
	CONSTRAINT "chk_restaurant_checks_version" CHECK("restaurant_checks"."version" >= 1),
	CONSTRAINT "chk_restaurant_checks_close_shape" CHECK(("restaurant_checks"."status" = 'open' AND "restaurant_checks"."closed_at" IS NULL AND "restaurant_checks"."closed_by" IS NULL) OR ("restaurant_checks"."status" != 'open' AND "restaurant_checks"."closed_at" IS NOT NULL AND "restaurant_checks"."closed_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_checks_tenant_sale` ON `restaurant_checks` (`tenant_id`,`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_restaurant_checks_tenant_service_status` ON `restaurant_checks` (`tenant_id`,`service_id`,`status`);--> statement-breakpoint
CREATE TABLE `restaurant_courses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`check_id` text NOT NULL,
	`course_key` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`check_id`) REFERENCES `restaurant_checks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_restaurant_courses_key" CHECK("restaurant_courses"."course_key" IN ('starter', 'main', 'dessert', 'drink', 'other')),
	CONSTRAINT "chk_restaurant_courses_position" CHECK("restaurant_courses"."position" BETWEEN 0 AND 20)
);
--> statement-breakpoint
CREATE INDEX `idx_restaurant_courses_tenant_check` ON `restaurant_courses` (`tenant_id`,`check_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_courses_check_key` ON `restaurant_courses` (`check_id`,`course_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_courses_check_position` ON `restaurant_courses` (`check_id`,`position`);--> statement-breakpoint
CREATE TABLE `restaurant_diners` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`service_id` text NOT NULL,
	`label` text,
	`seat_number` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `restaurant_services`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_restaurant_diners_seat" CHECK("restaurant_diners"."seat_number" IS NULL OR ("restaurant_diners"."seat_number" BETWEEN 1 AND 200))
);
--> statement-breakpoint
CREATE INDEX `idx_restaurant_diners_tenant_service` ON `restaurant_diners` (`tenant_id`,`service_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_diners_service_seat` ON `restaurant_diners` (`service_id`,`seat_number`) WHERE "restaurant_diners"."seat_number" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `restaurant_line_modifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`check_line_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_delta` real DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`check_line_id`) REFERENCES `restaurant_check_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_restaurant_modifiers_quantity" CHECK("restaurant_line_modifiers"."quantity" BETWEEN 1 AND 20),
	CONSTRAINT "chk_restaurant_modifiers_price" CHECK("restaurant_line_modifiers"."unit_price_delta" >= 0),
	CONSTRAINT "chk_restaurant_modifiers_price_2dec" CHECK(round("restaurant_line_modifiers"."unit_price_delta", 2) = "restaurant_line_modifiers"."unit_price_delta"),
	CONSTRAINT "chk_restaurant_modifiers_position" CHECK("restaurant_line_modifiers"."position" BETWEEN 0 AND 19)
);
--> statement-breakpoint
CREATE INDEX `idx_restaurant_modifiers_tenant_line` ON `restaurant_line_modifiers` (`tenant_id`,`check_line_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_modifiers_line_position` ON `restaurant_line_modifiers` (`check_line_id`,`position`);--> statement-breakpoint
CREATE TABLE `restaurant_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`check_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`label` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_by` text NOT NULL,
	`submitted_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`check_id`) REFERENCES `restaurant_checks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_restaurant_rounds_status" CHECK("restaurant_rounds"."status" IN ('open', 'submitted', 'voided')),
	CONSTRAINT "chk_restaurant_rounds_sequence" CHECK("restaurant_rounds"."sequence" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_restaurant_rounds_tenant_check` ON `restaurant_rounds` (`tenant_id`,`check_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_rounds_check_sequence` ON `restaurant_rounds` (`check_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `restaurant_services` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`table_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`guest_count` integer,
	`opened_by` text NOT NULL,
	`opened_at` text DEFAULT (datetime('now')) NOT NULL,
	`closed_by` text,
	`closed_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_restaurant_services_guest_count" CHECK("restaurant_services"."guest_count" IS NULL OR ("restaurant_services"."guest_count" BETWEEN 1 AND 200)),
	CONSTRAINT "chk_restaurant_services_status" CHECK("restaurant_services"."status" IN ('open', 'closed', 'cancelled')),
	CONSTRAINT "chk_restaurant_services_version" CHECK("restaurant_services"."version" >= 1),
	CONSTRAINT "chk_restaurant_services_close_shape" CHECK(("restaurant_services"."status" = 'open' AND "restaurant_services"."closed_at" IS NULL AND "restaurant_services"."closed_by" IS NULL) OR ("restaurant_services"."status" != 'open' AND "restaurant_services"."closed_at" IS NOT NULL AND "restaurant_services"."closed_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_restaurant_services_tenant_site_status` ON `restaurant_services` (`tenant_id`,`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_restaurant_services_tenant_table` ON `restaurant_services` (`tenant_id`,`table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_services_one_open_per_table` ON `restaurant_services` (`tenant_id`,`table_id`) WHERE "restaurant_services"."status" = 'open';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name_snapshot` text,
	`product_sku_snapshot` text,
	`tracks_stock_snapshot` integer,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`catalog_unit_price1` real,
	`catalog_unit_price2` real,
	`catalog_unit_price3` real,
	`unit_id` text,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`unit_standard_code` text,
	`discount` real DEFAULT 0 NOT NULL,
	`manual_discount_rate` real,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_kind` text DEFAULT 'iva' NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`cost_at_sale` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`exchange_rate_at_sale` real DEFAULT 1 NOT NULL,
	`settle_currency_code` text,
	`notes` text,
	`restaurant_modifier_amount` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settle_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_items_unit_price_nonneg" CHECK("__new_sale_items"."unit_price" >= 0),
	CONSTRAINT "chk_sale_items_unit_price_2dec" CHECK(round("__new_sale_items"."unit_price", 2) = "__new_sale_items"."unit_price"),
	CONSTRAINT "chk_sale_items_catalog_unit_price1_nonneg" CHECK("__new_sale_items"."catalog_unit_price1" >= 0),
	CONSTRAINT "chk_sale_items_catalog_unit_price1_2dec" CHECK(round("__new_sale_items"."catalog_unit_price1", 2) = "__new_sale_items"."catalog_unit_price1"),
	CONSTRAINT "chk_sale_items_catalog_unit_price2_nonneg" CHECK("__new_sale_items"."catalog_unit_price2" >= 0),
	CONSTRAINT "chk_sale_items_catalog_unit_price2_2dec" CHECK(round("__new_sale_items"."catalog_unit_price2", 2) = "__new_sale_items"."catalog_unit_price2"),
	CONSTRAINT "chk_sale_items_catalog_unit_price3_nonneg" CHECK("__new_sale_items"."catalog_unit_price3" >= 0),
	CONSTRAINT "chk_sale_items_catalog_unit_price3_2dec" CHECK(round("__new_sale_items"."catalog_unit_price3", 2) = "__new_sale_items"."catalog_unit_price3"),
	CONSTRAINT "chk_sale_items_tax_nonneg" CHECK("__new_sale_items"."tax_amount" >= 0),
	CONSTRAINT "chk_sale_items_tax_2dec" CHECK(round("__new_sale_items"."tax_amount", 2) = "__new_sale_items"."tax_amount"),
	CONSTRAINT "chk_sale_items_cost_nonneg" CHECK("__new_sale_items"."cost_at_sale" >= 0),
	CONSTRAINT "chk_sale_items_cost_2dec" CHECK(round("__new_sale_items"."cost_at_sale", 2) = "__new_sale_items"."cost_at_sale"),
	CONSTRAINT "chk_sale_items_total_nonneg" CHECK("__new_sale_items"."total" >= 0),
	CONSTRAINT "chk_sale_items_total_2dec" CHECK(round("__new_sale_items"."total", 2) = "__new_sale_items"."total"),
	CONSTRAINT "chk_sale_items_restaurant_modifier_nonneg" CHECK("__new_sale_items"."restaurant_modifier_amount" >= 0),
	CONSTRAINT "chk_sale_items_restaurant_modifier_2dec" CHECK(round("__new_sale_items"."restaurant_modifier_amount", 2) = "__new_sale_items"."restaurant_modifier_amount"),
	CONSTRAINT "chk_sale_items_discount_2dec" CHECK(round("__new_sale_items"."discount", 2) = "__new_sale_items"."discount"),
	CONSTRAINT "chk_sale_items_exchange_rate_positive" CHECK("__new_sale_items"."exchange_rate_at_sale" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_sale_items`("id", "sale_id", "product_id", "product_name_snapshot", "product_sku_snapshot", "tracks_stock_snapshot", "quantity", "unit_price", "catalog_unit_price1", "catalog_unit_price2", "catalog_unit_price3", "unit_id", "unit_equivalence", "unit_standard_code", "discount", "manual_discount_rate", "tax_rate", "tax_kind", "tax_amount", "cost_at_sale", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "notes", "restaurant_modifier_amount") SELECT "id", "sale_id", "product_id", "product_name_snapshot", "product_sku_snapshot", "tracks_stock_snapshot", "quantity", "unit_price", "catalog_unit_price1", "catalog_unit_price2", "catalog_unit_price3", "unit_id", "unit_equivalence", "unit_standard_code", "discount", "manual_discount_rate", "tax_rate", "tax_kind", "tax_amount", "cost_at_sale", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "notes", 0 FROM `sale_items`;--> statement-breakpoint
DROP TABLE `sale_items`;--> statement-breakpoint
ALTER TABLE `__new_sale_items` RENAME TO `sale_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sale_items_sale` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_items_product` ON `sale_items` (`product_id`);
--> statement-breakpoint
-- Adopt only the operational state that can be reconstructed without
-- inventing visits, diners, courses or rounds: one open service per table and
-- one open check per table-backed legacy draft that is still financially open.
-- A resumed draft has suspended_at = NULL but still owns its reserved stock and
-- physical table; omitting it would create hidden occupancy after upgrade.
-- Historical completed sales do not encode service boundaries, so they
-- intentionally remain unmodelled.
INSERT OR IGNORE INTO `restaurant_services` (
	`id`, `tenant_id`, `site_id`, `table_id`, `status`, `guest_count`,
	`opened_by`, `opened_at`, `version`, `created_at`, `updated_at`
)
SELECT
	'legacy-service:' || s.`tenant_id` || ':' || s.`table_id`,
	s.`tenant_id`,
	rt.`site_id`,
	s.`table_id`,
	'open',
	NULL,
	(
		SELECT s0.`created_by`
		FROM `sales` s0
		WHERE s0.`tenant_id` = s.`tenant_id`
			AND s0.`table_id` = s.`table_id`
			AND s0.`status` = 'draft'
		ORDER BY COALESCE(s0.`suspended_at`, s0.`created_at`), s0.`id`
		LIMIT 1
	),
	MIN(COALESCE(s.`suspended_at`, s.`created_at`)),
	1,
	MIN(COALESCE(s.`suspended_at`, s.`created_at`)),
	MIN(COALESCE(s.`suspended_at`, s.`created_at`))
FROM `sales` s
INNER JOIN `restaurant_tables` rt
	ON rt.`id` = s.`table_id` AND rt.`tenant_id` = s.`tenant_id`
INNER JOIN `tenants` t ON t.`id` = s.`tenant_id`
WHERE s.`status` = 'draft'
	AND s.`table_id` IS NOT NULL
	AND rt.`is_active` = 1
	AND json_extract(
		CASE WHEN json_valid(t.`settings`) THEN t.`settings` ELSE '{}' END,
		'$.modules.dine-in'
	) = 1
GROUP BY s.`tenant_id`, s.`table_id`, rt.`site_id`;--> statement-breakpoint
INSERT OR IGNORE INTO `restaurant_checks` (
	`id`, `tenant_id`, `service_id`, `sale_id`, `label`, `status`,
	`opened_by`, `opened_at`, `version`, `created_at`, `updated_at`
)
SELECT
	'legacy-check:' || s.`id`,
	s.`tenant_id`,
	'legacy-service:' || s.`tenant_id` || ':' || s.`table_id`,
	s.`id`,
	s.`suspended_label`,
	'open',
	s.`created_by`,
	COALESCE(s.`suspended_at`, s.`created_at`),
	1,
	COALESCE(s.`suspended_at`, s.`created_at`),
	COALESCE(s.`suspended_at`, s.`created_at`)
FROM `sales` s
INNER JOIN `restaurant_services` rs
	ON rs.`id` = 'legacy-service:' || s.`tenant_id` || ':' || s.`table_id`
	AND rs.`tenant_id` = s.`tenant_id`
WHERE s.`status` = 'draft'
	AND s.`table_id` IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `restaurant_check_lines` (
	`id`, `tenant_id`, `check_id`, `sale_item_id`, `round_id`,
	`course_id`, `diner_id`, `created_at`
)
SELECT
	'legacy-check-line:' || si.`id`,
	s.`tenant_id`,
	'legacy-check:' || s.`id`,
	si.`id`,
	NULL,
	NULL,
	NULL,
	COALESCE(s.`suspended_at`, s.`created_at`)
FROM `sale_items` si
INNER JOIN `sales` s ON s.`id` = si.`sale_id`
INNER JOIN `restaurant_checks` rc
	ON rc.`sale_id` = s.`id` AND rc.`tenant_id` = s.`tenant_id`
WHERE s.`status` = 'draft'
	AND s.`table_id` IS NOT NULL;
