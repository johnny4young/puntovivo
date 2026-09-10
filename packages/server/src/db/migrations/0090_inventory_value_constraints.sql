-- Temporarily remove only the external FTS triggers that reference products.
-- Keeping normal ALTER semantics lets SQLite rewrite generated CHECK qualifiers.
DROP TRIGGER IF EXISTS `pharmacy_profiles_search_fts_ai`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `pharmacy_profiles_search_fts_au`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `pharmacy_profiles_search_fts_ad`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`description` text,
	`category_id` text,
	`price` real DEFAULT 0 NOT NULL,
	`price2` real DEFAULT 0 NOT NULL,
	`price3` real DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`margin_percent1` real DEFAULT 0 NOT NULL,
	`margin_percent2` real DEFAULT 0 NOT NULL,
	`margin_percent3` real DEFAULT 0 NOT NULL,
	`margin_amount1` real DEFAULT 0 NOT NULL,
	`margin_amount2` real DEFAULT 0 NOT NULL,
	`margin_amount3` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_kind` text DEFAULT 'iva' NOT NULL,
	`vat_rate_id` text,
	`provider_id` text,
	`location_id` text,
	`initial_cost` real DEFAULT 0 NOT NULL,
	`inventory_value_cents` integer,
	`cogs_value_cents` integer,
	`valuation_quantity` real,
	`valuation_version` integer DEFAULT 0 NOT NULL,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`min_stock` real DEFAULT 0 NOT NULL,
	`sell_by_fraction` integer DEFAULT false NOT NULL,
	`fraction_step` real,
	`fraction_minimum` real,
	`tracks_stock` integer DEFAULT true NOT NULL,
	`tracks_lots` integer DEFAULT false NOT NULL,
	`tracks_serials` integer DEFAULT false NOT NULL,
	`catalog_type` text DEFAULT 'standard' NOT NULL,
	`variant_parent_id` text,
	`variant_axes` text,
	`variant_values` text,
	`variant_signature` text,
	`is_active` integer DEFAULT true,
	`barcode` text,
	`image_url` text,
	`embedding` text,
	`embedding_blob` blob,
	`embedding_model` text,
	`embedded_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vat_rate_id`) REFERENCES `vat_rates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_parent_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_products_inventory_value_cents_safe_integer" CHECK("__new_products"."inventory_value_cents" IS NULL OR (typeof("__new_products"."inventory_value_cents") = 'integer' AND "__new_products"."inventory_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_products_cogs_value_cents_safe_integer" CHECK("__new_products"."cogs_value_cents" IS NULL OR (typeof("__new_products"."cogs_value_cents") = 'integer' AND "__new_products"."cogs_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_products_valuation_version_safe_integer" CHECK("__new_products"."valuation_version" IS NULL OR (typeof("__new_products"."valuation_version") = 'integer' AND "__new_products"."valuation_version" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_products_valuation_quantity_finite_quantity" CHECK("__new_products"."valuation_quantity" IS NULL OR (typeof("__new_products"."valuation_quantity") IN ('integer', 'real') AND "__new_products"."valuation_quantity" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_products_valuation_basis_0" CHECK(("__new_products"."inventory_value_cents" IS NULL AND "__new_products"."cogs_value_cents" IS NULL AND "__new_products"."valuation_quantity" IS NULL) OR ("__new_products"."inventory_value_cents" IS NOT NULL AND "__new_products"."cogs_value_cents" IS NOT NULL AND "__new_products"."valuation_quantity" IS NOT NULL)),
	CONSTRAINT "chk_products_empty_value" CHECK("__new_products"."valuation_quantity" IS NULL OR "__new_products"."valuation_quantity" <> 0 OR ("__new_products"."inventory_value_cents" = 0 AND "__new_products"."cogs_value_cents" = 0)),
	CONSTRAINT "chk_products_price_nonneg" CHECK("__new_products"."price" >= 0),
	CONSTRAINT "chk_products_price_2dec" CHECK(round("__new_products"."price", 2) = "__new_products"."price"),
	CONSTRAINT "chk_products_price2_nonneg" CHECK("__new_products"."price2" >= 0),
	CONSTRAINT "chk_products_price2_2dec" CHECK(round("__new_products"."price2", 2) = "__new_products"."price2"),
	CONSTRAINT "chk_products_price3_nonneg" CHECK("__new_products"."price3" >= 0),
	CONSTRAINT "chk_products_price3_2dec" CHECK(round("__new_products"."price3", 2) = "__new_products"."price3"),
	CONSTRAINT "chk_products_cost_nonneg" CHECK("__new_products"."cost" >= 0),
	CONSTRAINT "chk_products_cost_2dec" CHECK(round("__new_products"."cost", 2) = "__new_products"."cost"),
	CONSTRAINT "chk_products_margin1_nonneg" CHECK("__new_products"."margin_amount1" >= 0),
	CONSTRAINT "chk_products_margin1_2dec" CHECK(round("__new_products"."margin_amount1", 2) = "__new_products"."margin_amount1"),
	CONSTRAINT "chk_products_margin2_nonneg" CHECK("__new_products"."margin_amount2" >= 0),
	CONSTRAINT "chk_products_margin2_2dec" CHECK(round("__new_products"."margin_amount2", 2) = "__new_products"."margin_amount2"),
	CONSTRAINT "chk_products_margin3_nonneg" CHECK("__new_products"."margin_amount3" >= 0),
	CONSTRAINT "chk_products_margin3_2dec" CHECK(round("__new_products"."margin_amount3", 2) = "__new_products"."margin_amount3"),
	CONSTRAINT "chk_products_init_cost_nonneg" CHECK("__new_products"."initial_cost" >= 0),
	CONSTRAINT "chk_products_init_cost_2dec" CHECK(round("__new_products"."initial_cost", 2) = "__new_products"."initial_cost")
);
--> statement-breakpoint
INSERT INTO `__new_products`(rowid, "id", "tenant_id", "name", "sku", "description", "category_id", "price", "price2", "price3", "cost", "margin_percent1", "margin_percent2", "margin_percent3", "margin_amount1", "margin_amount2", "margin_amount3", "tax_rate", "tax_kind", "vat_rate_id", "provider_id", "location_id", "initial_cost", "inventory_value_cents", "cogs_value_cents", "valuation_quantity", "valuation_version", "currency_code", "min_stock", "sell_by_fraction", "fraction_step", "fraction_minimum", "tracks_stock", "tracks_lots", "tracks_serials", "catalog_type", "variant_parent_id", "variant_axes", "variant_values", "variant_signature", "is_active", "barcode", "image_url", "embedding", "embedding_blob", "embedding_model", "embedded_at", "version", "sync_status", "sync_version", "created_at", "updated_at") SELECT rowid, "id", "tenant_id", "name", "sku", "description", "category_id", "price", "price2", "price3", "cost", "margin_percent1", "margin_percent2", "margin_percent3", "margin_amount1", "margin_amount2", "margin_amount3", "tax_rate", "tax_kind", "vat_rate_id", "provider_id", "location_id", "initial_cost", "inventory_value_cents", "cogs_value_cents", "valuation_quantity", "valuation_version", "currency_code", "min_stock", "sell_by_fraction", "fraction_step", "fraction_minimum", "tracks_stock", "tracks_lots", "tracks_serials", "catalog_type", "variant_parent_id", "variant_axes", "variant_values", "variant_signature", "is_active", "barcode", "image_url", "embedding", "embedding_blob", "embedding_model", "embedded_at", "version", "sync_status", "sync_version", "created_at", "updated_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_products_tenant` ON `products` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_products_sku` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_products_tenant_barcode` ON `products` (`tenant_id`,`barcode`);--> statement-breakpoint
CREATE INDEX `idx_products_category` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_products_provider` ON `products` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_products_vat_rate` ON `products` (`vat_rate_id`);--> statement-breakpoint
CREATE INDEX `idx_products_variant_parent` ON `products` (`tenant_id`,`variant_parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_tenant_sku` ON `products` (`tenant_id`,`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_variant_signature` ON `products` (`tenant_id`,`variant_parent_id`,`variant_signature`) WHERE "products"."variant_parent_id" is not null;--> statement-breakpoint
CREATE TABLE `__new_purchase_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_item_id` text NOT NULL,
	`inventory_lot_id` text NOT NULL,
	`lot_number_snapshot` text NOT NULL,
	`expires_at_snapshot` text,
	`base_quantity` real NOT NULL,
	`unit_cost` real NOT NULL,
	`total_cost_cents` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inventory_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_item_lots_total_cost_cents_safe_integer" CHECK("__new_purchase_item_lots"."total_cost_cents" IS NULL OR (typeof("__new_purchase_item_lots"."total_cost_cents") = 'integer' AND "__new_purchase_item_lots"."total_cost_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_purchase_item_lots_quantity_positive" CHECK("__new_purchase_item_lots"."base_quantity" > 0),
	CONSTRAINT "chk_purchase_item_lots_unit_cost_nonneg" CHECK("__new_purchase_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_purchase_item_lots_unit_cost_2dec" CHECK(round("__new_purchase_item_lots"."unit_cost", 2) = "__new_purchase_item_lots"."unit_cost")
);
--> statement-breakpoint
INSERT INTO `__new_purchase_item_lots`("id", "tenant_id", "purchase_item_id", "inventory_lot_id", "lot_number_snapshot", "expires_at_snapshot", "base_quantity", "unit_cost", "total_cost_cents", "created_at") SELECT "id", "tenant_id", "purchase_item_id", "inventory_lot_id", "lot_number_snapshot", "expires_at_snapshot", "base_quantity", "unit_cost", "total_cost_cents", "created_at" FROM `purchase_item_lots`;--> statement-breakpoint
DROP TABLE `purchase_item_lots`;--> statement-breakpoint
ALTER TABLE `__new_purchase_item_lots` RENAME TO `purchase_item_lots`;--> statement-breakpoint
CREATE INDEX `idx_purchase_item_lots_tenant` ON `purchase_item_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_item_lots_item` ON `purchase_item_lots` (`purchase_item_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_item_lots_lot` ON `purchase_item_lots` (`inventory_lot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_item_lots_item_lot` ON `purchase_item_lots` (`purchase_item_id`,`inventory_lot_id`);--> statement-breakpoint
CREATE TABLE `__new_purchase_items` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`product_id` text NOT NULL,
	`source_order_item_id` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_id` text NOT NULL,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`cost_per_unit` real DEFAULT 0 NOT NULL,
	`base_unit_cost` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`inventory_value_cents` integer,
	`cogs_value_cents` integer,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_items_inventory_value_cents_safe_integer" CHECK("__new_purchase_items"."inventory_value_cents" IS NULL OR (typeof("__new_purchase_items"."inventory_value_cents") = 'integer' AND "__new_purchase_items"."inventory_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_purchase_items_cogs_value_cents_safe_integer" CHECK("__new_purchase_items"."cogs_value_cents" IS NULL OR (typeof("__new_purchase_items"."cogs_value_cents") = 'integer' AND "__new_purchase_items"."cogs_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_purchase_items_valuation_basis_0" CHECK(("__new_purchase_items"."inventory_value_cents" IS NULL AND "__new_purchase_items"."cogs_value_cents" IS NULL) OR ("__new_purchase_items"."inventory_value_cents" IS NOT NULL AND "__new_purchase_items"."cogs_value_cents" IS NOT NULL)),
	CONSTRAINT "chk_purchase_items_cost_per_unit_nonneg" CHECK("__new_purchase_items"."cost_per_unit" >= 0),
	CONSTRAINT "chk_purchase_items_cost_per_unit_2dec" CHECK(round("__new_purchase_items"."cost_per_unit", 2) = "__new_purchase_items"."cost_per_unit"),
	CONSTRAINT "chk_purchase_items_base_cost_nonneg" CHECK("__new_purchase_items"."base_unit_cost" >= 0),
	CONSTRAINT "chk_purchase_items_base_cost_2dec" CHECK(round("__new_purchase_items"."base_unit_cost", 2) = "__new_purchase_items"."base_unit_cost"),
	CONSTRAINT "chk_purchase_items_total_nonneg" CHECK("__new_purchase_items"."total" >= 0),
	CONSTRAINT "chk_purchase_items_total_2dec" CHECK(round("__new_purchase_items"."total", 2) = "__new_purchase_items"."total")
);
--> statement-breakpoint
INSERT INTO `__new_purchase_items`("id", "purchase_id", "product_id", "source_order_item_id", "quantity", "unit_id", "unit_equivalence", "cost_per_unit", "base_unit_cost", "total", "inventory_value_cents", "cogs_value_cents") SELECT "id", "purchase_id", "product_id", "source_order_item_id", "quantity", "unit_id", "unit_equivalence", "cost_per_unit", "base_unit_cost", "total", "inventory_value_cents", "cogs_value_cents" FROM `purchase_items`;--> statement-breakpoint
DROP TABLE `purchase_items`;--> statement-breakpoint
ALTER TABLE `__new_purchase_items` RENAME TO `purchase_items`;--> statement-breakpoint
CREATE INDEX `idx_purchase_items_purchase` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_items_product` ON `purchase_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_items_source_order_item` ON `purchase_items` (`source_order_item_id`);--> statement-breakpoint
CREATE TABLE `__new_purchase_return_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_return_item_id` text NOT NULL,
	`purchase_item_lot_id` text NOT NULL,
	`inventory_lot_id` text NOT NULL,
	`base_quantity` real NOT NULL,
	`unit_cost` real NOT NULL,
	`total_cost_cents` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_return_item_id`) REFERENCES `purchase_return_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_item_lot_id`) REFERENCES `purchase_item_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_return_item_lots_total_cost_cents_safe_integer" CHECK("__new_purchase_return_item_lots"."total_cost_cents" IS NULL OR (typeof("__new_purchase_return_item_lots"."total_cost_cents") = 'integer' AND "__new_purchase_return_item_lots"."total_cost_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_purchase_return_item_lots_quantity_positive" CHECK("__new_purchase_return_item_lots"."base_quantity" > 0),
	CONSTRAINT "chk_purchase_return_item_lots_unit_cost_nonneg" CHECK("__new_purchase_return_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_purchase_return_item_lots_unit_cost_2dec" CHECK(round("__new_purchase_return_item_lots"."unit_cost", 2) = "__new_purchase_return_item_lots"."unit_cost")
);
--> statement-breakpoint
INSERT INTO `__new_purchase_return_item_lots`("id", "tenant_id", "purchase_return_item_id", "purchase_item_lot_id", "inventory_lot_id", "base_quantity", "unit_cost", "total_cost_cents", "created_at") SELECT "id", "tenant_id", "purchase_return_item_id", "purchase_item_lot_id", "inventory_lot_id", "base_quantity", "unit_cost", "total_cost_cents", "created_at" FROM `purchase_return_item_lots`;--> statement-breakpoint
DROP TABLE `purchase_return_item_lots`;--> statement-breakpoint
ALTER TABLE `__new_purchase_return_item_lots` RENAME TO `purchase_return_item_lots`;--> statement-breakpoint
CREATE INDEX `idx_purchase_return_item_lots_tenant` ON `purchase_return_item_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_item_lots_return_item` ON `purchase_return_item_lots` (`purchase_return_item_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_item_lots_purchase_lot` ON `purchase_return_item_lots` (`purchase_item_lot_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_item_lots_inventory_lot` ON `purchase_return_item_lots` (`inventory_lot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_return_item_lots_scope` ON `purchase_return_item_lots` (`purchase_return_item_id`,`purchase_item_lot_id`);--> statement-breakpoint
CREATE TABLE `__new_purchase_return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_return_id` text NOT NULL,
	`purchase_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_id` text NOT NULL,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`cost_per_unit` real DEFAULT 0 NOT NULL,
	`base_unit_cost` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`inventory_value_cents` integer,
	`cogs_value_cents` integer,
	FOREIGN KEY (`purchase_return_id`) REFERENCES `purchase_returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_return_items_inventory_value_cents_safe_integer" CHECK("__new_purchase_return_items"."inventory_value_cents" IS NULL OR (typeof("__new_purchase_return_items"."inventory_value_cents") = 'integer' AND "__new_purchase_return_items"."inventory_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_purchase_return_items_cogs_value_cents_safe_integer" CHECK("__new_purchase_return_items"."cogs_value_cents" IS NULL OR (typeof("__new_purchase_return_items"."cogs_value_cents") = 'integer' AND "__new_purchase_return_items"."cogs_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_purchase_return_items_valuation_basis_0" CHECK(("__new_purchase_return_items"."inventory_value_cents" IS NULL AND "__new_purchase_return_items"."cogs_value_cents" IS NULL) OR ("__new_purchase_return_items"."inventory_value_cents" IS NOT NULL AND "__new_purchase_return_items"."cogs_value_cents" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_purchase_return_items`("id", "purchase_return_id", "purchase_item_id", "product_id", "quantity", "unit_id", "unit_equivalence", "cost_per_unit", "base_unit_cost", "total", "inventory_value_cents", "cogs_value_cents") SELECT "id", "purchase_return_id", "purchase_item_id", "product_id", "quantity", "unit_id", "unit_equivalence", "cost_per_unit", "base_unit_cost", "total", "inventory_value_cents", "cogs_value_cents" FROM `purchase_return_items`;--> statement-breakpoint
DROP TABLE `purchase_return_items`;--> statement-breakpoint
ALTER TABLE `__new_purchase_return_items` RENAME TO `purchase_return_items`;--> statement-breakpoint
CREATE INDEX `idx_purchase_return_items_return` ON `purchase_return_items` (`purchase_return_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_items_purchase_item` ON `purchase_return_items` (`purchase_item_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_items_product` ON `purchase_return_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_sale_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`total_cost_cents` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_item_lots_total_cost_cents_safe_integer" CHECK("__new_sale_item_lots"."total_cost_cents" IS NULL OR (typeof("__new_sale_item_lots"."total_cost_cents") = 'integer' AND "__new_sale_item_lots"."total_cost_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_sale_item_lots_unit_cost_nonneg" CHECK("__new_sale_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_sale_item_lots_unit_cost_2dec" CHECK(round("__new_sale_item_lots"."unit_cost", 2) = "__new_sale_item_lots"."unit_cost")
);
--> statement-breakpoint
INSERT INTO `__new_sale_item_lots`("id", "tenant_id", "sale_item_id", "lot_id", "quantity", "unit_cost", "total_cost_cents", "created_at") SELECT "id", "tenant_id", "sale_item_id", "lot_id", "quantity", "unit_cost", "total_cost_cents", "created_at" FROM `sale_item_lots`;--> statement-breakpoint
DROP TABLE `sale_item_lots`;--> statement-breakpoint
ALTER TABLE `__new_sale_item_lots` RENAME TO `sale_item_lots`;--> statement-breakpoint
CREATE INDEX `idx_sale_item_lots_tenant` ON `sale_item_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_lots_sale_item` ON `sale_item_lots` (`sale_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_lots_lot` ON `sale_item_lots` (`lot_id`);--> statement-breakpoint
CREATE TABLE `__new_sale_item_serials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`product_serial_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`cost_cents` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_serial_id`) REFERENCES `product_serials`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_item_serials_cost_cents_safe_integer" CHECK("__new_sale_item_serials"."cost_cents" IS NULL OR (typeof("__new_sale_item_serials"."cost_cents") = 'integer' AND "__new_sale_item_serials"."cost_cents" BETWEEN 0 AND 9007199254740991))
);
--> statement-breakpoint
INSERT INTO `__new_sale_item_serials`("id", "tenant_id", "sale_item_id", "product_serial_id", "serial_number", "cost_cents", "created_at") SELECT "id", "tenant_id", "sale_item_id", "product_serial_id", "serial_number", "cost_cents", "created_at" FROM `sale_item_serials`;--> statement-breakpoint
DROP TABLE `sale_item_serials`;--> statement-breakpoint
ALTER TABLE `__new_sale_item_serials` RENAME TO `sale_item_serials`;--> statement-breakpoint
CREATE INDEX `idx_sale_item_serials_tenant` ON `sale_item_serials` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_serials_sale_item` ON `sale_item_serials` (`sale_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_item_serials_product_serial` ON `sale_item_serials` (`product_serial_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_item_serials_line_serial` ON `sale_item_serials` (`tenant_id`,`sale_item_id`,`product_serial_id`);--> statement-breakpoint
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
	`inventory_cost_cents` integer,
	`cogs_cost_cents` integer,
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
	CONSTRAINT "chk_sale_items_inventory_cost_cents_safe_integer" CHECK("__new_sale_items"."inventory_cost_cents" IS NULL OR (typeof("__new_sale_items"."inventory_cost_cents") = 'integer' AND "__new_sale_items"."inventory_cost_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_sale_items_cogs_cost_cents_safe_integer" CHECK("__new_sale_items"."cogs_cost_cents" IS NULL OR (typeof("__new_sale_items"."cogs_cost_cents") = 'integer' AND "__new_sale_items"."cogs_cost_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_sale_items_valuation_basis_0" CHECK(("__new_sale_items"."inventory_cost_cents" IS NULL AND "__new_sale_items"."cogs_cost_cents" IS NULL) OR ("__new_sale_items"."inventory_cost_cents" IS NOT NULL AND "__new_sale_items"."cogs_cost_cents" IS NOT NULL)),
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
INSERT INTO `__new_sale_items`("id", "sale_id", "product_id", "product_name_snapshot", "product_sku_snapshot", "tracks_stock_snapshot", "quantity", "unit_price", "catalog_unit_price1", "catalog_unit_price2", "catalog_unit_price3", "unit_id", "unit_equivalence", "unit_standard_code", "discount", "manual_discount_rate", "tax_rate", "tax_kind", "tax_amount", "cost_at_sale", "inventory_cost_cents", "cogs_cost_cents", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "notes", "restaurant_modifier_amount") SELECT "id", "sale_id", "product_id", "product_name_snapshot", "product_sku_snapshot", "tracks_stock_snapshot", "quantity", "unit_price", "catalog_unit_price1", "catalog_unit_price2", "catalog_unit_price3", "unit_id", "unit_equivalence", "unit_standard_code", "discount", "manual_discount_rate", "tax_rate", "tax_kind", "tax_amount", "cost_at_sale", "inventory_cost_cents", "cogs_cost_cents", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "notes", "restaurant_modifier_amount" FROM `sale_items`;--> statement-breakpoint
DROP TABLE `sale_items`;--> statement-breakpoint
ALTER TABLE `__new_sale_items` RENAME TO `sale_items`;--> statement-breakpoint
CREATE INDEX `idx_sale_items_sale` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_items_product` ON `sale_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_sale_return_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_item_id` text NOT NULL,
	`sale_item_lot_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`total_cost_cents` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_item_id`) REFERENCES `sale_return_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_lot_id`) REFERENCES `sale_item_lots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_return_item_lots_total_cost_cents_safe_integer" CHECK("__new_sale_return_item_lots"."total_cost_cents" IS NULL OR (typeof("__new_sale_return_item_lots"."total_cost_cents") = 'integer' AND "__new_sale_return_item_lots"."total_cost_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_sale_return_lots_quantity_positive" CHECK("__new_sale_return_item_lots"."quantity" > 0),
	CONSTRAINT "chk_sale_return_lots_cost_nonneg" CHECK("__new_sale_return_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_sale_return_lots_cost_2dec" CHECK(round("__new_sale_return_item_lots"."unit_cost", 2) = "__new_sale_return_item_lots"."unit_cost")
);
--> statement-breakpoint
INSERT INTO `__new_sale_return_item_lots`("id", "tenant_id", "sale_return_item_id", "sale_item_lot_id", "lot_id", "quantity", "unit_cost", "total_cost_cents", "created_at") SELECT "id", "tenant_id", "sale_return_item_id", "sale_item_lot_id", "lot_id", "quantity", "unit_cost", "total_cost_cents", "created_at" FROM `sale_return_item_lots`;--> statement-breakpoint
DROP TABLE `sale_return_item_lots`;--> statement-breakpoint
ALTER TABLE `__new_sale_return_item_lots` RENAME TO `sale_return_item_lots`;--> statement-breakpoint
CREATE INDEX `idx_sale_return_lots_tenant_line` ON `sale_return_item_lots` (`tenant_id`,`sale_return_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_return_lots_original` ON `sale_return_item_lots` (`sale_item_lot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_lots_line_original` ON `sale_return_item_lots` (`sale_return_item_id`,`sale_item_lot_id`);--> statement-breakpoint
CREATE TABLE `__new_sale_return_item_serials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_item_id` text NOT NULL,
	`sale_item_serial_id` text NOT NULL,
	`product_serial_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`cost_cents` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_item_id`) REFERENCES `sale_return_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_serial_id`) REFERENCES `sale_item_serials`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_serial_id`) REFERENCES `product_serials`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_return_item_serials_cost_cents_safe_integer" CHECK("__new_sale_return_item_serials"."cost_cents" IS NULL OR (typeof("__new_sale_return_item_serials"."cost_cents") = 'integer' AND "__new_sale_return_item_serials"."cost_cents" BETWEEN 0 AND 9007199254740991))
);
--> statement-breakpoint
INSERT INTO `__new_sale_return_item_serials`("id", "tenant_id", "sale_return_item_id", "sale_item_serial_id", "product_serial_id", "serial_number", "cost_cents", "created_at") SELECT "id", "tenant_id", "sale_return_item_id", "sale_item_serial_id", "product_serial_id", "serial_number", "cost_cents", "created_at" FROM `sale_return_item_serials`;--> statement-breakpoint
DROP TABLE `sale_return_item_serials`;--> statement-breakpoint
ALTER TABLE `__new_sale_return_item_serials` RENAME TO `sale_return_item_serials`;--> statement-breakpoint
CREATE INDEX `idx_sale_return_serials_tenant_line` ON `sale_return_item_serials` (`tenant_id`,`sale_return_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_return_serials_original` ON `sale_return_item_serials` (`sale_item_serial_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_serials_once` ON `sale_return_item_serials` (`sale_item_serial_id`);--> statement-breakpoint
CREATE TABLE `__new_sale_return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name_snapshot` text,
	`product_sku_snapshot` text,
	`quantity` real NOT NULL,
	`base_quantity` real NOT NULL,
	`unit_price` real NOT NULL,
	`unit_equivalence` real NOT NULL,
	`unit_standard_code` text,
	`discount_rate` real DEFAULT 0 NOT NULL,
	`tax_kind` text DEFAULT 'iva' NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`cost_amount` real DEFAULT 0 NOT NULL,
	`inventory_cost_cents` integer,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_return_items_inventory_cost_cents_safe_integer" CHECK("__new_sale_return_items"."inventory_cost_cents" IS NULL OR (typeof("__new_sale_return_items"."inventory_cost_cents") = 'integer' AND "__new_sale_return_items"."inventory_cost_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_sale_return_items_quantity_positive" CHECK("__new_sale_return_items"."quantity" > 0),
	CONSTRAINT "chk_sale_return_items_base_quantity_positive" CHECK("__new_sale_return_items"."base_quantity" > 0),
	CONSTRAINT "chk_sale_return_items_equivalence_positive" CHECK("__new_sale_return_items"."unit_equivalence" > 0),
	CONSTRAINT "chk_sale_return_items_price_nonneg" CHECK("__new_sale_return_items"."unit_price" >= 0),
	CONSTRAINT "chk_sale_return_items_price_2dec" CHECK(round("__new_sale_return_items"."unit_price", 2) = "__new_sale_return_items"."unit_price"),
	CONSTRAINT "chk_sale_return_items_subtotal_nonneg" CHECK("__new_sale_return_items"."subtotal" >= 0),
	CONSTRAINT "chk_sale_return_items_subtotal_2dec" CHECK(round("__new_sale_return_items"."subtotal", 2) = "__new_sale_return_items"."subtotal"),
	CONSTRAINT "chk_sale_return_items_discount_nonneg" CHECK("__new_sale_return_items"."discount_amount" >= 0),
	CONSTRAINT "chk_sale_return_items_discount_2dec" CHECK(round("__new_sale_return_items"."discount_amount", 2) = "__new_sale_return_items"."discount_amount"),
	CONSTRAINT "chk_sale_return_items_tax_nonneg" CHECK("__new_sale_return_items"."tax_amount" >= 0),
	CONSTRAINT "chk_sale_return_items_tax_2dec" CHECK(round("__new_sale_return_items"."tax_amount", 2) = "__new_sale_return_items"."tax_amount"),
	CONSTRAINT "chk_sale_return_items_total_nonneg" CHECK("__new_sale_return_items"."total" >= 0),
	CONSTRAINT "chk_sale_return_items_total_2dec" CHECK(round("__new_sale_return_items"."total", 2) = "__new_sale_return_items"."total"),
	CONSTRAINT "chk_sale_return_items_cost_nonneg" CHECK("__new_sale_return_items"."cost_amount" >= 0),
	CONSTRAINT "chk_sale_return_items_cost_2dec" CHECK(round("__new_sale_return_items"."cost_amount", 2) = "__new_sale_return_items"."cost_amount")
);
--> statement-breakpoint
INSERT INTO `__new_sale_return_items`("id", "tenant_id", "sale_return_id", "sale_item_id", "product_id", "product_name_snapshot", "product_sku_snapshot", "quantity", "base_quantity", "unit_price", "unit_equivalence", "unit_standard_code", "discount_rate", "tax_kind", "tax_rate", "subtotal", "discount_amount", "tax_amount", "total", "cost_amount", "inventory_cost_cents", "currency_code", "created_at") SELECT "id", "tenant_id", "sale_return_id", "sale_item_id", "product_id", "product_name_snapshot", "product_sku_snapshot", "quantity", "base_quantity", "unit_price", "unit_equivalence", "unit_standard_code", "discount_rate", "tax_kind", "tax_rate", "subtotal", "discount_amount", "tax_amount", "total", "cost_amount", "inventory_cost_cents", "currency_code", "created_at" FROM `sale_return_items`;--> statement-breakpoint
DROP TABLE `sale_return_items`;--> statement-breakpoint
ALTER TABLE `__new_sale_return_items` RENAME TO `sale_return_items`;--> statement-breakpoint
CREATE INDEX `idx_sale_return_items_tenant_return` ON `sale_return_items` (`tenant_id`,`sale_return_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_return_items_sale_item` ON `sale_return_items` (`sale_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_items_return_line` ON `sale_return_items` (`sale_return_id`,`sale_item_id`);--> statement-breakpoint
CREATE TABLE `__new_inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`site_id` text,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`previous_stock` real NOT NULL,
	`new_stock` real NOT NULL,
	`inventory_value_delta_cents` integer,
	`cogs_value_delta_cents` integer,
	`reference` text,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_inventory_movements_inventory_value_delta_cents_safe_integer" CHECK("__new_inventory_movements"."inventory_value_delta_cents" IS NULL OR (typeof("__new_inventory_movements"."inventory_value_delta_cents") = 'integer' AND "__new_inventory_movements"."inventory_value_delta_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_movements_cogs_value_delta_cents_safe_integer" CHECK("__new_inventory_movements"."cogs_value_delta_cents" IS NULL OR (typeof("__new_inventory_movements"."cogs_value_delta_cents") = 'integer' AND "__new_inventory_movements"."cogs_value_delta_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_movements_valuation_basis_0" CHECK(("__new_inventory_movements"."inventory_value_delta_cents" IS NULL AND "__new_inventory_movements"."cogs_value_delta_cents" IS NULL) OR ("__new_inventory_movements"."inventory_value_delta_cents" IS NOT NULL AND "__new_inventory_movements"."cogs_value_delta_cents" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_inventory_movements`("id", "tenant_id", "product_id", "site_id", "type", "quantity", "previous_stock", "new_stock", "inventory_value_delta_cents", "cogs_value_delta_cents", "reference", "notes", "created_by", "sync_status", "sync_version", "created_at") SELECT "id", "tenant_id", "product_id", "site_id", "type", "quantity", "previous_stock", "new_stock", "inventory_value_delta_cents", "cogs_value_delta_cents", "reference", "notes", "created_by", "sync_status", "sync_version", "created_at" FROM `inventory_movements`;--> statement-breakpoint
DROP TABLE `inventory_movements`;--> statement-breakpoint
ALTER TABLE `__new_inventory_movements` RENAME TO `inventory_movements`;--> statement-breakpoint
CREATE INDEX `idx_inventory_tenant` ON `inventory_movements` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_product` ON `inventory_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_created_by` ON `inventory_movements` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_inventory_movements_tenant_created` ON `inventory_movements` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_movements_tenant_site_created` ON `inventory_movements` (`tenant_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_inventory_count_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`line_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`code` text NOT NULL,
	`expected_quantity` real NOT NULL,
	`expected_status` text NOT NULL,
	`expected_custody_version` integer NOT NULL,
	`expected_value_cents` integer,
	`applied_value_before_cents` integer,
	`applied_value_delta_cents` integer,
	`expires_at` text,
	`unit_cost` real NOT NULL,
	`stock_status_before_missing` text,
	`counted_quantity` real,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`line_id`) REFERENCES `inventory_count_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_inventory_count_identities_expected_value_cents_safe_integer" CHECK("__new_inventory_count_identities"."expected_value_cents" IS NULL OR (typeof("__new_inventory_count_identities"."expected_value_cents") = 'integer' AND "__new_inventory_count_identities"."expected_value_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_count_identities_applied_value_before_cents_safe_integer" CHECK("__new_inventory_count_identities"."applied_value_before_cents" IS NULL OR (typeof("__new_inventory_count_identities"."applied_value_before_cents") = 'integer' AND "__new_inventory_count_identities"."applied_value_before_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_count_identities_applied_value_delta_cents_safe_integer" CHECK("__new_inventory_count_identities"."applied_value_delta_cents" IS NULL OR (typeof("__new_inventory_count_identities"."applied_value_delta_cents") = 'integer' AND "__new_inventory_count_identities"."applied_value_delta_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_count_identities_valuation_basis_0" CHECK(("__new_inventory_count_identities"."applied_value_before_cents" IS NULL AND "__new_inventory_count_identities"."applied_value_delta_cents" IS NULL) OR ("__new_inventory_count_identities"."applied_value_before_cents" IS NOT NULL AND "__new_inventory_count_identities"."applied_value_delta_cents" IS NOT NULL)),
	CONSTRAINT "inventory_count_identities_kind" CHECK("__new_inventory_count_identities"."kind" IN ('lots', 'serials')),
	CONSTRAINT "inventory_count_identities_quantity" CHECK("__new_inventory_count_identities"."expected_quantity" >= 0 AND ("__new_inventory_count_identities"."counted_quantity" IS NULL OR "__new_inventory_count_identities"."counted_quantity" >= 0)),
	CONSTRAINT "inventory_count_identities_serial_unit" CHECK("__new_inventory_count_identities"."kind" != 'serials' OR ("__new_inventory_count_identities"."expected_quantity" IN (0, 1) AND ("__new_inventory_count_identities"."counted_quantity" IS NULL OR "__new_inventory_count_identities"."counted_quantity" IN (0, 1))))
);
--> statement-breakpoint
INSERT INTO `__new_inventory_count_identities`("id", "tenant_id", "line_id", "kind", "source_id", "code", "expected_quantity", "expected_status", "expected_custody_version", "expected_value_cents", "applied_value_before_cents", "applied_value_delta_cents", "expires_at", "unit_cost", "stock_status_before_missing", "counted_quantity", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "line_id", "kind", "source_id", "code", "expected_quantity", "expected_status", "expected_custody_version", "expected_value_cents", "applied_value_before_cents", "applied_value_delta_cents", "expires_at", "unit_cost", "stock_status_before_missing", "counted_quantity", "sync_status", "sync_version", "created_at", "updated_at" FROM `inventory_count_identities`;--> statement-breakpoint
DROP TABLE `inventory_count_identities`;--> statement-breakpoint
ALTER TABLE `__new_inventory_count_identities` RENAME TO `inventory_count_identities`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_identities_source` ON `inventory_count_identities` (`tenant_id`,`line_id`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_identities_code` ON `inventory_count_identities` (`tenant_id`,`line_id`,`code`);--> statement-breakpoint
CREATE TABLE `__new_inventory_count_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`session_id` text NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`tracking_mode` text DEFAULT 'aggregate' NOT NULL,
	`expected_quantity` real NOT NULL,
	`expected_balance_version` integer DEFAULT 0 NOT NULL,
	`counted_quantity` real,
	`discrepancy` real,
	`unit_cost_snapshot` real DEFAULT 0 NOT NULL,
	`expected_valuation_version` integer,
	`expected_valuation_quantity` real,
	`expected_inventory_value_cents` integer,
	`expected_cogs_value_cents` integer,
	`cogs_unit_cost_snapshot` real,
	`counted_by` text,
	`counted_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `inventory_count_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_inventory_count_lines_expected_inventory_value_cents_safe_integer" CHECK("__new_inventory_count_lines"."expected_inventory_value_cents" IS NULL OR (typeof("__new_inventory_count_lines"."expected_inventory_value_cents") = 'integer' AND "__new_inventory_count_lines"."expected_inventory_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_count_lines_expected_cogs_value_cents_safe_integer" CHECK("__new_inventory_count_lines"."expected_cogs_value_cents" IS NULL OR (typeof("__new_inventory_count_lines"."expected_cogs_value_cents") = 'integer' AND "__new_inventory_count_lines"."expected_cogs_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_count_lines_expected_valuation_version_safe_integer" CHECK("__new_inventory_count_lines"."expected_valuation_version" IS NULL OR (typeof("__new_inventory_count_lines"."expected_valuation_version") = 'integer' AND "__new_inventory_count_lines"."expected_valuation_version" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_count_lines_expected_valuation_quantity_finite_quantity" CHECK("__new_inventory_count_lines"."expected_valuation_quantity" IS NULL OR (typeof("__new_inventory_count_lines"."expected_valuation_quantity") IN ('integer', 'real') AND "__new_inventory_count_lines"."expected_valuation_quantity" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_inventory_count_lines_valuation_basis_0" CHECK(("__new_inventory_count_lines"."expected_inventory_value_cents" IS NULL AND "__new_inventory_count_lines"."expected_cogs_value_cents" IS NULL AND "__new_inventory_count_lines"."expected_valuation_quantity" IS NULL AND "__new_inventory_count_lines"."expected_valuation_version" IS NULL AND "__new_inventory_count_lines"."cogs_unit_cost_snapshot" IS NULL) OR ("__new_inventory_count_lines"."expected_inventory_value_cents" IS NOT NULL AND "__new_inventory_count_lines"."expected_cogs_value_cents" IS NOT NULL AND "__new_inventory_count_lines"."expected_valuation_quantity" IS NOT NULL AND "__new_inventory_count_lines"."expected_valuation_version" IS NOT NULL AND "__new_inventory_count_lines"."cogs_unit_cost_snapshot" IS NOT NULL)),
	CONSTRAINT "inventory_count_lines_counted_nonnegative" CHECK("__new_inventory_count_lines"."counted_quantity" IS NULL OR "__new_inventory_count_lines"."counted_quantity" >= 0),
	CONSTRAINT "inventory_count_lines_cost_nonnegative" CHECK("__new_inventory_count_lines"."unit_cost_snapshot" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_inventory_count_lines`("id", "tenant_id", "session_id", "product_id", "unit_id", "tracking_mode", "expected_quantity", "expected_balance_version", "counted_quantity", "discrepancy", "unit_cost_snapshot", "expected_valuation_version", "expected_valuation_quantity", "expected_inventory_value_cents", "expected_cogs_value_cents", "cogs_unit_cost_snapshot", "counted_by", "counted_at", "version", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "session_id", "product_id", "unit_id", "tracking_mode", "expected_quantity", "expected_balance_version", "counted_quantity", "discrepancy", "unit_cost_snapshot", "expected_valuation_version", "expected_valuation_quantity", "expected_inventory_value_cents", "expected_cogs_value_cents", "cogs_unit_cost_snapshot", "counted_by", "counted_at", "version", "sync_status", "sync_version", "created_at", "updated_at" FROM `inventory_count_lines`;--> statement-breakpoint
DROP TABLE `inventory_count_lines`;--> statement-breakpoint
ALTER TABLE `__new_inventory_count_lines` RENAME TO `inventory_count_lines`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_lines_session_product` ON `inventory_count_lines` (`tenant_id`,`session_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_lines_tenant_product` ON `inventory_count_lines` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_count_lines_session` ON `inventory_count_lines` (`session_id`);--> statement-breakpoint
CREATE TABLE `__new_transfer_order_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transfer_order_item_id` text NOT NULL,
	`source_lot_id` text NOT NULL,
	`destination_lot_id` text,
	`lot_number_snapshot` text NOT NULL,
	`expires_at_snapshot` text,
	`source_status_snapshot` text NOT NULL,
	`quantity` real NOT NULL,
	`received_quantity` real,
	`unit_cost` real NOT NULL,
	`shipped_value_cents` integer,
	`received_value_cents` integer,
	`destination_previous_value_cents` integer,
	`destination_previous_valuation_quantity` real,
	`destination_resulting_value_cents` integer,
	`destination_resulting_valuation_version` integer,
	`destination_lot_was_created` integer,
	`destination_previous_on_hand` real,
	`destination_previous_unit_cost` real,
	`destination_previous_status` text,
	`destination_resulting_on_hand` real,
	`destination_resulting_unit_cost` real,
	`destination_resulting_status` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_order_item_id`) REFERENCES `transfer_order_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_transfer_order_item_lots_shipped_value_cents_safe_integer" CHECK("__new_transfer_order_item_lots"."shipped_value_cents" IS NULL OR (typeof("__new_transfer_order_item_lots"."shipped_value_cents") = 'integer' AND "__new_transfer_order_item_lots"."shipped_value_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_item_lots_received_value_cents_safe_integer" CHECK("__new_transfer_order_item_lots"."received_value_cents" IS NULL OR (typeof("__new_transfer_order_item_lots"."received_value_cents") = 'integer' AND "__new_transfer_order_item_lots"."received_value_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_item_lots_destination_previous_value_cents_safe_integer" CHECK("__new_transfer_order_item_lots"."destination_previous_value_cents" IS NULL OR (typeof("__new_transfer_order_item_lots"."destination_previous_value_cents") = 'integer' AND "__new_transfer_order_item_lots"."destination_previous_value_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_item_lots_destination_resulting_value_cents_safe_integer" CHECK("__new_transfer_order_item_lots"."destination_resulting_value_cents" IS NULL OR (typeof("__new_transfer_order_item_lots"."destination_resulting_value_cents") = 'integer' AND "__new_transfer_order_item_lots"."destination_resulting_value_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_item_lots_destination_resulting_valuation_version_safe_integer" CHECK("__new_transfer_order_item_lots"."destination_resulting_valuation_version" IS NULL OR (typeof("__new_transfer_order_item_lots"."destination_resulting_valuation_version") = 'integer' AND "__new_transfer_order_item_lots"."destination_resulting_valuation_version" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_item_lots_destination_previous_valuation_quantity_finite_quantity" CHECK("__new_transfer_order_item_lots"."destination_previous_valuation_quantity" IS NULL OR (typeof("__new_transfer_order_item_lots"."destination_previous_valuation_quantity") IN ('integer', 'real') AND "__new_transfer_order_item_lots"."destination_previous_valuation_quantity" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_transfer_order_item_lots_quantity_positive" CHECK("__new_transfer_order_item_lots"."quantity" > 0),
	CONSTRAINT "chk_transfer_order_item_lots_received_range" CHECK("__new_transfer_order_item_lots"."received_quantity" IS NULL OR ("__new_transfer_order_item_lots"."received_quantity" >= 0 AND "__new_transfer_order_item_lots"."received_quantity" <= "__new_transfer_order_item_lots"."quantity")),
	CONSTRAINT "chk_transfer_order_item_lots_destination_snapshot" CHECK(("__new_transfer_order_item_lots"."received_quantity" IS NULL AND "__new_transfer_order_item_lots"."destination_lot_id" IS NULL AND "__new_transfer_order_item_lots"."destination_lot_was_created" IS NULL AND "__new_transfer_order_item_lots"."destination_previous_on_hand" IS NULL AND "__new_transfer_order_item_lots"."destination_previous_unit_cost" IS NULL AND "__new_transfer_order_item_lots"."destination_previous_status" IS NULL AND "__new_transfer_order_item_lots"."destination_resulting_on_hand" IS NULL AND "__new_transfer_order_item_lots"."destination_resulting_unit_cost" IS NULL AND "__new_transfer_order_item_lots"."destination_resulting_status" IS NULL) OR ("__new_transfer_order_item_lots"."received_quantity" = 0 AND "__new_transfer_order_item_lots"."destination_lot_id" IS NULL AND "__new_transfer_order_item_lots"."destination_lot_was_created" IS NULL AND "__new_transfer_order_item_lots"."destination_previous_on_hand" IS NULL AND "__new_transfer_order_item_lots"."destination_previous_unit_cost" IS NULL AND "__new_transfer_order_item_lots"."destination_previous_status" IS NULL AND "__new_transfer_order_item_lots"."destination_resulting_on_hand" IS NULL AND "__new_transfer_order_item_lots"."destination_resulting_unit_cost" IS NULL AND "__new_transfer_order_item_lots"."destination_resulting_status" IS NULL) OR ("__new_transfer_order_item_lots"."received_quantity" > 0 AND "__new_transfer_order_item_lots"."destination_lot_id" IS NOT NULL AND "__new_transfer_order_item_lots"."destination_lot_was_created" IS NOT NULL AND "__new_transfer_order_item_lots"."destination_resulting_on_hand" IS NOT NULL AND "__new_transfer_order_item_lots"."destination_resulting_unit_cost" IS NOT NULL AND "__new_transfer_order_item_lots"."destination_resulting_status" IS NOT NULL AND (("__new_transfer_order_item_lots"."destination_lot_was_created" = 1 AND "__new_transfer_order_item_lots"."destination_previous_on_hand" IS NULL AND "__new_transfer_order_item_lots"."destination_previous_unit_cost" IS NULL AND "__new_transfer_order_item_lots"."destination_previous_status" IS NULL) OR ("__new_transfer_order_item_lots"."destination_lot_was_created" = 0 AND "__new_transfer_order_item_lots"."destination_previous_on_hand" IS NOT NULL AND "__new_transfer_order_item_lots"."destination_previous_unit_cost" IS NOT NULL AND "__new_transfer_order_item_lots"."destination_previous_status" IS NOT NULL)))),
	CONSTRAINT "chk_transfer_order_item_lots_unit_cost_nonneg" CHECK("__new_transfer_order_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_transfer_order_item_lots_unit_cost_2dec" CHECK(round("__new_transfer_order_item_lots"."unit_cost", 2) = "__new_transfer_order_item_lots"."unit_cost"),
	CONSTRAINT "chk_transfer_order_item_lots_destination_previous_on_hand_nonnegative" CHECK("__new_transfer_order_item_lots"."destination_previous_on_hand" IS NULL OR "__new_transfer_order_item_lots"."destination_previous_on_hand" >= 0),
	CONSTRAINT "chk_transfer_order_item_lots_destination_resulting_on_hand_nonnegative" CHECK("__new_transfer_order_item_lots"."destination_resulting_on_hand" IS NULL OR "__new_transfer_order_item_lots"."destination_resulting_on_hand" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_transfer_order_item_lots`("id", "tenant_id", "transfer_order_item_id", "source_lot_id", "destination_lot_id", "lot_number_snapshot", "expires_at_snapshot", "source_status_snapshot", "quantity", "received_quantity", "unit_cost", "shipped_value_cents", "received_value_cents", "destination_previous_value_cents", "destination_previous_valuation_quantity", "destination_resulting_value_cents", "destination_resulting_valuation_version", "destination_lot_was_created", "destination_previous_on_hand", "destination_previous_unit_cost", "destination_previous_status", "destination_resulting_on_hand", "destination_resulting_unit_cost", "destination_resulting_status", "created_at", "updated_at") SELECT "id", "tenant_id", "transfer_order_item_id", "source_lot_id", "destination_lot_id", "lot_number_snapshot", "expires_at_snapshot", "source_status_snapshot", "quantity", "received_quantity", "unit_cost", "shipped_value_cents", "received_value_cents", "destination_previous_value_cents", "destination_previous_valuation_quantity", "destination_resulting_value_cents", "destination_resulting_valuation_version", "destination_lot_was_created", "destination_previous_on_hand", "destination_previous_unit_cost", "destination_previous_status", "destination_resulting_on_hand", "destination_resulting_unit_cost", "destination_resulting_status", "created_at", "updated_at" FROM `transfer_order_item_lots`;--> statement-breakpoint
DROP TABLE `transfer_order_item_lots`;--> statement-breakpoint
ALTER TABLE `__new_transfer_order_item_lots` RENAME TO `transfer_order_item_lots`;--> statement-breakpoint
CREATE INDEX `idx_transfer_order_item_lots_tenant` ON `transfer_order_item_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_order_item_lots_item` ON `transfer_order_item_lots` (`transfer_order_item_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_order_item_lots_source` ON `transfer_order_item_lots` (`source_lot_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_order_item_lots_destination` ON `transfer_order_item_lots` (`destination_lot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transfer_order_item_lots_item_source` ON `transfer_order_item_lots` (`transfer_order_item_id`,`source_lot_id`);--> statement-breakpoint
CREATE TABLE `__new_transfer_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`received_quantity` real,
	`destination_resulting_balance_version` integer,
	`shipped_inventory_value_cents` integer,
	`shipped_cogs_value_cents` integer,
	`received_inventory_value_cents` integer,
	`received_cogs_value_cents` integer,
	`resulting_valuation_version` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`transfer_order_id`) REFERENCES `transfer_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_transfer_order_items_shipped_inventory_value_cents_safe_integer" CHECK("__new_transfer_order_items"."shipped_inventory_value_cents" IS NULL OR (typeof("__new_transfer_order_items"."shipped_inventory_value_cents") = 'integer' AND "__new_transfer_order_items"."shipped_inventory_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_items_shipped_cogs_value_cents_safe_integer" CHECK("__new_transfer_order_items"."shipped_cogs_value_cents" IS NULL OR (typeof("__new_transfer_order_items"."shipped_cogs_value_cents") = 'integer' AND "__new_transfer_order_items"."shipped_cogs_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_items_received_inventory_value_cents_safe_integer" CHECK("__new_transfer_order_items"."received_inventory_value_cents" IS NULL OR (typeof("__new_transfer_order_items"."received_inventory_value_cents") = 'integer' AND "__new_transfer_order_items"."received_inventory_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_items_received_cogs_value_cents_safe_integer" CHECK("__new_transfer_order_items"."received_cogs_value_cents" IS NULL OR (typeof("__new_transfer_order_items"."received_cogs_value_cents") = 'integer' AND "__new_transfer_order_items"."received_cogs_value_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_items_resulting_valuation_version_safe_integer" CHECK("__new_transfer_order_items"."resulting_valuation_version" IS NULL OR (typeof("__new_transfer_order_items"."resulting_valuation_version") = 'integer' AND "__new_transfer_order_items"."resulting_valuation_version" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_transfer_order_items_valuation_basis_0" CHECK(("__new_transfer_order_items"."shipped_inventory_value_cents" IS NULL AND "__new_transfer_order_items"."shipped_cogs_value_cents" IS NULL) OR ("__new_transfer_order_items"."shipped_inventory_value_cents" IS NOT NULL AND "__new_transfer_order_items"."shipped_cogs_value_cents" IS NOT NULL)),
	CONSTRAINT "chk_transfer_order_items_valuation_basis_1" CHECK(("__new_transfer_order_items"."received_inventory_value_cents" IS NULL AND "__new_transfer_order_items"."received_cogs_value_cents" IS NULL) OR ("__new_transfer_order_items"."received_inventory_value_cents" IS NOT NULL AND "__new_transfer_order_items"."received_cogs_value_cents" IS NOT NULL)),
	CONSTRAINT "chk_transfer_order_items_destination_version_nonnegative" CHECK("__new_transfer_order_items"."destination_resulting_balance_version" IS NULL OR "__new_transfer_order_items"."destination_resulting_balance_version" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_transfer_order_items`("id", "transfer_order_id", "product_id", "quantity", "received_quantity", "destination_resulting_balance_version", "shipped_inventory_value_cents", "shipped_cogs_value_cents", "received_inventory_value_cents", "received_cogs_value_cents", "resulting_valuation_version", "created_at") SELECT "id", "transfer_order_id", "product_id", "quantity", "received_quantity", "destination_resulting_balance_version", "shipped_inventory_value_cents", "shipped_cogs_value_cents", "received_inventory_value_cents", "received_cogs_value_cents", "resulting_valuation_version", "created_at" FROM `transfer_order_items`;--> statement-breakpoint
DROP TABLE `transfer_order_items`;--> statement-breakpoint
ALTER TABLE `__new_transfer_order_items` RENAME TO `transfer_order_items`;--> statement-breakpoint
CREATE INDEX `idx_transfer_order_items_order` ON `transfer_order_items` (`transfer_order_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_order_items_product` ON `transfer_order_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_inventory_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lot_number` text NOT NULL,
	`expires_at` text,
	`on_hand` real DEFAULT 0 NOT NULL,
	`custody_version` integer DEFAULT 0 NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`carrying_value_cents` integer,
	`valuation_quantity` real,
	`valuation_version` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`received_at` text DEFAULT (datetime('now')) NOT NULL,
	`notes` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_inventory_lots_carrying_value_cents_safe_integer" CHECK("__new_inventory_lots"."carrying_value_cents" IS NULL OR (typeof("__new_inventory_lots"."carrying_value_cents") = 'integer' AND "__new_inventory_lots"."carrying_value_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_lots_valuation_version_safe_integer" CHECK("__new_inventory_lots"."valuation_version" IS NULL OR (typeof("__new_inventory_lots"."valuation_version") = 'integer' AND "__new_inventory_lots"."valuation_version" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_lots_valuation_quantity_finite_quantity" CHECK("__new_inventory_lots"."valuation_quantity" IS NULL OR (typeof("__new_inventory_lots"."valuation_quantity") IN ('integer', 'real') AND "__new_inventory_lots"."valuation_quantity" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_inventory_lots_valuation_basis_0" CHECK(("__new_inventory_lots"."carrying_value_cents" IS NULL AND "__new_inventory_lots"."valuation_quantity" IS NULL) OR ("__new_inventory_lots"."carrying_value_cents" IS NOT NULL AND "__new_inventory_lots"."valuation_quantity" IS NOT NULL)),
	CONSTRAINT "chk_inventory_lots_empty_value" CHECK("__new_inventory_lots"."valuation_quantity" IS NULL OR "__new_inventory_lots"."valuation_quantity" <> 0 OR ("__new_inventory_lots"."carrying_value_cents" = 0)),
	CONSTRAINT "chk_inventory_lots_unit_cost_nonneg" CHECK("__new_inventory_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_inventory_lots_unit_cost_2dec" CHECK(round("__new_inventory_lots"."unit_cost", 2) = "__new_inventory_lots"."unit_cost")
);
--> statement-breakpoint
INSERT INTO `__new_inventory_lots`("id", "tenant_id", "site_id", "product_id", "lot_number", "expires_at", "on_hand", "custody_version", "unit_cost", "carrying_value_cents", "valuation_quantity", "valuation_version", "status", "received_at", "notes", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "site_id", "product_id", "lot_number", "expires_at", "on_hand", "custody_version", "unit_cost", "carrying_value_cents", "valuation_quantity", "valuation_version", "status", "received_at", "notes", "sync_status", "sync_version", "created_at", "updated_at" FROM `inventory_lots`;--> statement-breakpoint
DROP TABLE `inventory_lots`;--> statement-breakpoint
ALTER TABLE `__new_inventory_lots` RENAME TO `inventory_lots`;--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_tenant` ON `inventory_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_site` ON `inventory_lots` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_product` ON `inventory_lots` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_fefo` ON `inventory_lots` (`tenant_id`,`site_id`,`product_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_lots_expires` ON `inventory_lots` (`tenant_id`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_lots_scope` ON `inventory_lots` (`tenant_id`,`site_id`,`product_id`,`lot_number`);--> statement-breakpoint
CREATE TABLE `__new_inventory_transformation_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transformation_id` text NOT NULL,
	`recipe_output_id` text,
	`product_id` text NOT NULL,
	`lot_id` text,
	`lot_number_snapshot` text,
	`expires_at_snapshot` text,
	`role` text NOT NULL,
	`base_quantity` real NOT NULL,
	`allocation_weight` real NOT NULL,
	`allocated_cost` real NOT NULL,
	`unit_cost` real NOT NULL,
	`previous_product_cost` real NOT NULL,
	`previous_product_initial_cost` real NOT NULL,
	`resulting_product_cost` real NOT NULL,
	`resulting_product_initial_cost` real NOT NULL,
	`resulting_product_sync_version` integer NOT NULL,
	`resulting_balance_version` integer NOT NULL,
	`resulting_valuation_version` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transformation_id`) REFERENCES `inventory_transformations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_output_id`) REFERENCES `inventory_transformation_recipe_outputs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_inventory_transformation_outputs_resulting_valuation_version_safe_integer" CHECK("__new_inventory_transformation_outputs"."resulting_valuation_version" IS NULL OR (typeof("__new_inventory_transformation_outputs"."resulting_valuation_version") = 'integer' AND "__new_inventory_transformation_outputs"."resulting_valuation_version" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_inventory_transformation_outputs_lot_snapshot" CHECK(("__new_inventory_transformation_outputs"."lot_id" IS NULL AND "__new_inventory_transformation_outputs"."lot_number_snapshot" IS NULL AND "__new_inventory_transformation_outputs"."expires_at_snapshot" IS NULL) OR ("__new_inventory_transformation_outputs"."lot_id" IS NOT NULL AND "__new_inventory_transformation_outputs"."lot_number_snapshot" IS NOT NULL)),
	CONSTRAINT "chk_inventory_transformation_outputs_quantity_positive" CHECK("__new_inventory_transformation_outputs"."base_quantity" > 0),
	CONSTRAINT "chk_inventory_transformation_outputs_weight_positive" CHECK("__new_inventory_transformation_outputs"."allocation_weight" > 0),
	CONSTRAINT "chk_inventory_transformation_outputs_allocated_cost_nonneg" CHECK("__new_inventory_transformation_outputs"."allocated_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_allocated_cost_2dec" CHECK(round("__new_inventory_transformation_outputs"."allocated_cost", 2) = "__new_inventory_transformation_outputs"."allocated_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_unit_cost_nonneg" CHECK("__new_inventory_transformation_outputs"."unit_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_unit_cost_2dec" CHECK(round("__new_inventory_transformation_outputs"."unit_cost", 2) = "__new_inventory_transformation_outputs"."unit_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_previous_cost_nonneg" CHECK("__new_inventory_transformation_outputs"."previous_product_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_previous_cost_2dec" CHECK(round("__new_inventory_transformation_outputs"."previous_product_cost", 2) = "__new_inventory_transformation_outputs"."previous_product_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_previous_initial_cost_nonneg" CHECK("__new_inventory_transformation_outputs"."previous_product_initial_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_previous_initial_cost_2dec" CHECK(round("__new_inventory_transformation_outputs"."previous_product_initial_cost", 2) = "__new_inventory_transformation_outputs"."previous_product_initial_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_resulting_cost_nonneg" CHECK("__new_inventory_transformation_outputs"."resulting_product_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_resulting_cost_2dec" CHECK(round("__new_inventory_transformation_outputs"."resulting_product_cost", 2) = "__new_inventory_transformation_outputs"."resulting_product_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_resulting_initial_cost_nonneg" CHECK("__new_inventory_transformation_outputs"."resulting_product_initial_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_resulting_initial_cost_2dec" CHECK(round("__new_inventory_transformation_outputs"."resulting_product_initial_cost", 2) = "__new_inventory_transformation_outputs"."resulting_product_initial_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_product_version_nonnegative" CHECK("__new_inventory_transformation_outputs"."resulting_product_sync_version" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_balance_version_nonnegative" CHECK("__new_inventory_transformation_outputs"."resulting_balance_version" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_inventory_transformation_outputs`("id", "tenant_id", "transformation_id", "recipe_output_id", "product_id", "lot_id", "lot_number_snapshot", "expires_at_snapshot", "role", "base_quantity", "allocation_weight", "allocated_cost", "unit_cost", "previous_product_cost", "previous_product_initial_cost", "resulting_product_cost", "resulting_product_initial_cost", "resulting_product_sync_version", "resulting_balance_version", "resulting_valuation_version", "created_at") SELECT "id", "tenant_id", "transformation_id", "recipe_output_id", "product_id", "lot_id", "lot_number_snapshot", "expires_at_snapshot", "role", "base_quantity", "allocation_weight", "allocated_cost", "unit_cost", "previous_product_cost", "previous_product_initial_cost", "resulting_product_cost", "resulting_product_initial_cost", "resulting_product_sync_version", "resulting_balance_version", "resulting_valuation_version", "created_at" FROM `inventory_transformation_outputs`;--> statement-breakpoint
DROP TABLE `inventory_transformation_outputs`;--> statement-breakpoint
ALTER TABLE `__new_inventory_transformation_outputs` RENAME TO `inventory_transformation_outputs`;--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_outputs_tenant` ON `inventory_transformation_outputs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_outputs_transformation` ON `inventory_transformation_outputs` (`transformation_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_outputs_product` ON `inventory_transformation_outputs` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_outputs_lot` ON `inventory_transformation_outputs` (`lot_id`);
--> statement-breakpoint
-- Drizzle cannot express these existing triggers. Product rowids are preserved
-- in the copy above, so FTS keys and pharmacy projections remain unchanged.
CREATE TRIGGER IF NOT EXISTS `products_search_fts_ai`
AFTER INSERT ON products
WHEN new.catalog_type <> 'variant_parent'
BEGIN
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  ) VALUES (
    new.rowid, new.id, new.tenant_id,
    't' || lower(hex(cast(new.tenant_id AS blob))),
    new.name, new.sku, coalesce(new.barcode, ''), coalesce(new.description, ''),
    '', '', '', ''
  );
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `products_search_fts_ad`
AFTER DELETE ON products
WHEN old.catalog_type <> 'variant_parent'
BEGIN
  DELETE FROM `product_search_fts` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `products_search_fts_au`
AFTER UPDATE OF id, tenant_id, name, sku, barcode, description, catalog_type ON products
BEGIN
  DELETE FROM `product_search_fts` WHERE rowid = old.rowid;
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  )
  SELECT
    new.rowid, new.id, new.tenant_id,
    't' || lower(hex(cast(new.tenant_id AS blob))),
    new.name, new.sku, coalesce(new.barcode, ''), coalesce(new.description, ''),
    coalesce(pp.active_ingredient, ''), coalesce(pp.generic_name, ''),
    coalesce(pp.manufacturer, ''), coalesce(pp.sanitary_registration, '')
  FROM (SELECT 1) seed
  LEFT JOIN pharmacy_product_profiles pp
    ON pp.product_id = new.id AND pp.tenant_id = new.tenant_id
  WHERE new.catalog_type <> 'variant_parent';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `pharmacy_profiles_search_fts_ai`
AFTER INSERT ON pharmacy_product_profiles
BEGIN
  DELETE FROM `product_search_fts`
  WHERE rowid = (SELECT rowid FROM products WHERE id = new.product_id AND tenant_id = new.tenant_id);
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  )
  SELECT
    p.rowid, p.id, p.tenant_id,
    't' || lower(hex(cast(p.tenant_id AS blob))),
    p.name, p.sku, coalesce(p.barcode, ''), coalesce(p.description, ''),
    coalesce(new.active_ingredient, ''), coalesce(new.generic_name, ''),
    coalesce(new.manufacturer, ''), coalesce(new.sanitary_registration, '')
  FROM products p
  WHERE p.id = new.product_id AND p.tenant_id = new.tenant_id
    AND p.catalog_type <> 'variant_parent';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `pharmacy_profiles_search_fts_au`
AFTER UPDATE OF product_id, tenant_id, active_ingredient, generic_name, manufacturer, sanitary_registration
ON pharmacy_product_profiles
BEGIN
  DELETE FROM `product_search_fts`
  WHERE rowid IN (
    SELECT rowid FROM products
    WHERE (id = old.product_id AND tenant_id = old.tenant_id)
       OR (id = new.product_id AND tenant_id = new.tenant_id)
  );
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  )
  SELECT
    p.rowid, p.id, p.tenant_id,
    't' || lower(hex(cast(p.tenant_id AS blob))),
    p.name, p.sku, coalesce(p.barcode, ''), coalesce(p.description, ''),
    coalesce(new.active_ingredient, ''), coalesce(new.generic_name, ''),
    coalesce(new.manufacturer, ''), coalesce(new.sanitary_registration, '')
  FROM products p
  WHERE p.id = new.product_id AND p.tenant_id = new.tenant_id
    AND p.catalog_type <> 'variant_parent';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `pharmacy_profiles_search_fts_ad`
AFTER DELETE ON pharmacy_product_profiles
BEGIN
  DELETE FROM `product_search_fts`
  WHERE rowid = (SELECT rowid FROM products WHERE id = old.product_id AND tenant_id = old.tenant_id);
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  )
  SELECT
    p.rowid, p.id, p.tenant_id,
    't' || lower(hex(cast(p.tenant_id AS blob))),
    p.name, p.sku, coalesce(p.barcode, ''), coalesce(p.description, ''),
    '', '', '', ''
  FROM products p
  WHERE p.id = old.product_id AND p.tenant_id = old.tenant_id
    AND p.catalog_type <> 'variant_parent';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_lots_advance_custody_version
AFTER UPDATE OF tenant_id, site_id, product_id, lot_number, expires_at, on_hand, unit_cost, status, received_at, carrying_value_cents, valuation_quantity ON inventory_lots
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.site_id IS NOT OLD.site_id OR NEW.product_id IS NOT OLD.product_id OR NEW.lot_number IS NOT OLD.lot_number OR NEW.expires_at IS NOT OLD.expires_at OR NEW.on_hand IS NOT OLD.on_hand OR NEW.unit_cost IS NOT OLD.unit_cost OR NEW.status IS NOT OLD.status OR NEW.received_at IS NOT OLD.received_at OR NEW.carrying_value_cents IS NOT OLD.carrying_value_cents OR NEW.valuation_quantity IS NOT OLD.valuation_quantity
BEGIN
  UPDATE inventory_lots SET custody_version = OLD.custody_version + 1 WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_lots_advance_valuation_version
AFTER UPDATE OF on_hand, unit_cost, carrying_value_cents, valuation_quantity ON inventory_lots
WHEN NEW.on_hand IS NOT OLD.on_hand OR NEW.unit_cost IS NOT OLD.unit_cost OR NEW.carrying_value_cents IS NOT OLD.carrying_value_cents OR NEW.valuation_quantity IS NOT OLD.valuation_quantity
BEGIN
  UPDATE inventory_lots SET valuation_version = OLD.valuation_version + 1 WHERE id = NEW.id;
END;
