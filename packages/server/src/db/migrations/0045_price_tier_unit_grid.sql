UPDATE `unit_x_product`
SET `is_base` = 1
WHERE `is_base` IS NULL
  AND `id` = (
    SELECT candidate.`id`
    FROM `unit_x_product` AS candidate
    WHERE candidate.`product_id` = `unit_x_product`.`product_id`
    ORDER BY candidate.`created_at`, candidate.`id`
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `unit_x_product` AS existing_base
    WHERE existing_base.`product_id` = `unit_x_product`.`product_id`
      AND existing_base.`is_base` = 1
  );--> statement-breakpoint
UPDATE `unit_x_product` SET `is_base` = 0 WHERE `is_base` IS NULL;--> statement-breakpoint
CREATE TABLE `__new_unit_x_product` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`equivalence` real DEFAULT 1 NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`price2` real DEFAULT 0 NOT NULL,
	`price3` real DEFAULT 0 NOT NULL,
	`is_base` integer DEFAULT false NOT NULL,
	`barcode` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_unit_x_product_price_nonneg" CHECK("__new_unit_x_product"."price" >= 0),
	CONSTRAINT "chk_unit_x_product_price_2dec" CHECK(round("__new_unit_x_product"."price", 2) = "__new_unit_x_product"."price"),
	CONSTRAINT "chk_unit_x_product_price2_nonneg" CHECK("__new_unit_x_product"."price2" >= 0),
	CONSTRAINT "chk_unit_x_product_price2_2dec" CHECK(round("__new_unit_x_product"."price2", 2) = "__new_unit_x_product"."price2"),
	CONSTRAINT "chk_unit_x_product_price3_nonneg" CHECK("__new_unit_x_product"."price3" >= 0),
	CONSTRAINT "chk_unit_x_product_price3_2dec" CHECK(round("__new_unit_x_product"."price3", 2) = "__new_unit_x_product"."price3")
);
--> statement-breakpoint
INSERT INTO `__new_unit_x_product`("id", "product_id", "unit_id", "equivalence", "price", "price2", "price3", "is_base", "barcode", "created_at", "updated_at") SELECT "id", "product_id", "unit_id", "equivalence", CASE WHEN "price" < 0 THEN "price" ELSE CAST("price" * 100 + 0.5 AS integer) / 100.0 END, 0, 0, "is_base", "barcode", "created_at", "updated_at" FROM `unit_x_product`;--> statement-breakpoint
DROP TABLE `unit_x_product`;--> statement-breakpoint
ALTER TABLE `__new_unit_x_product` RENAME TO `unit_x_product`;--> statement-breakpoint
CREATE INDEX `idx_unit_x_product_product` ON `unit_x_product` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_unit_x_product_unit` ON `unit_x_product` (`unit_id`);--> statement-breakpoint
CREATE INDEX `idx_unit_x_product_barcode_product` ON `unit_x_product` (`barcode`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_unit_x_product_scope` ON `unit_x_product` (`product_id`,`unit_id`);--> statement-breakpoint
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
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_kind` text DEFAULT 'iva' NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`cost_at_sale` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`exchange_rate_at_sale` real DEFAULT 1 NOT NULL,
	`settle_currency_code` text,
	`notes` text,
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
	CONSTRAINT "chk_sale_items_discount_2dec" CHECK(round("__new_sale_items"."discount", 2) = "__new_sale_items"."discount"),
	CONSTRAINT "chk_sale_items_exchange_rate_positive" CHECK("__new_sale_items"."exchange_rate_at_sale" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_sale_items`("id", "sale_id", "product_id", "product_name_snapshot", "product_sku_snapshot", "tracks_stock_snapshot", "quantity", "unit_price", "catalog_unit_price1", "catalog_unit_price2", "catalog_unit_price3", "unit_id", "unit_equivalence", "unit_standard_code", "discount", "tax_rate", "tax_kind", "tax_amount", "cost_at_sale", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "notes") SELECT "id", "sale_id", "product_id", "product_name_snapshot", "product_sku_snapshot", "tracks_stock_snapshot", "quantity", "unit_price", NULL, NULL, NULL, "unit_id", "unit_equivalence", "unit_standard_code", "discount", "tax_rate", "tax_kind", "tax_amount", "cost_at_sale", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "notes" FROM `sale_items`;--> statement-breakpoint
DROP TABLE `sale_items`;--> statement-breakpoint
ALTER TABLE `__new_sale_items` RENAME TO `sale_items`;--> statement-breakpoint
CREATE INDEX `idx_sale_items_sale` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_items_product` ON `sale_items` (`product_id`);--> statement-breakpoint
ALTER TABLE `quotations` ADD `price_tier` integer DEFAULT 1 NOT NULL;
