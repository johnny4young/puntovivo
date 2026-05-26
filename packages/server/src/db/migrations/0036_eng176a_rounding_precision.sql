-- ENG-176a-rounding (Step-b) — two-decimal precision invariant.
--
-- Step-a (migration 0035) shipped `chk_<col>_nonneg` across 17 monetary
-- tables but pulled back the precision invariant
-- (`chk_<col>_2dec`) because the application accumulated IEEE-754 drift
-- on legitimate tax-exclusive / line-accumulation flows. The Step-b
-- sweep added `roundMoney()` at every monetary write boundary
-- (completeSale, quotations, payment-worker, products/purchases/orders
-- tRPC routers, audit-log money snapshots) so the storage layer's
-- precision contract can be enforced. This migration recreates every
-- monetary table to attach the precision CHECK + extends to 7 signed
-- columns (discounts, cash_movements.amount, sale_payments.amount,
-- cash_sessions.over_short) that Step-a left without any CHECK.
--
-- The defensive UPDATE prelude rounds any historical drift in
-- signed columns (Step-a's prelude already rounded the always-positive
-- columns). After Step-a + Step-b ship together on the staging diff,
-- every fresh install carries both invariants. Existing prod installs
-- that adopted Step-a in a prior version inherit the precision CHECK
-- via this recreation; the application sweep guarantees no future
-- write trips it.

UPDATE `cash_movements` SET `amount` = round(`amount`, 2) WHERE round(`amount`, 2) != `amount`;--> statement-breakpoint
UPDATE `sale_payments` SET `amount` = round(`amount`, 2) WHERE round(`amount`, 2) != `amount`;--> statement-breakpoint
UPDATE `sales` SET `discount_amount` = round(`discount_amount`, 2) WHERE round(`discount_amount`, 2) != `discount_amount`;--> statement-breakpoint
UPDATE `sale_items` SET `discount` = round(`discount`, 2) WHERE round(`discount`, 2) != `discount`;--> statement-breakpoint
UPDATE `quotations` SET `discount_amount` = round(`discount_amount`, 2) WHERE round(`discount_amount`, 2) != `discount_amount`;--> statement-breakpoint
UPDATE `quotation_items` SET `discount` = round(`discount`, 2) WHERE round(`discount`, 2) != `discount`;--> statement-breakpoint
UPDATE `cash_sessions` SET `over_short` = round(`over_short`, 2) WHERE `over_short` IS NOT NULL AND round(`over_short`, 2) != `over_short`;--> statement-breakpoint
UPDATE `cash_sessions` SET `actual_count` = round(`actual_count`, 2) WHERE `actual_count` IS NOT NULL AND round(`actual_count`, 2) != `actual_count`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`reference_id` text,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_cash_movements_amount_2dec" CHECK(round("__new_cash_movements"."amount", 2) = "__new_cash_movements"."amount")
);
--> statement-breakpoint
INSERT INTO `__new_cash_movements`("id", "tenant_id", "session_id", "type", "amount", "reference_id", "note", "created_by", "created_at") SELECT "id", "tenant_id", "session_id", "type", "amount", "reference_id", "note", "created_by", "created_at" FROM `cash_movements`;--> statement-breakpoint
DROP TABLE `cash_movements`;--> statement-breakpoint
ALTER TABLE `__new_cash_movements` RENAME TO `cash_movements`;--> statement-breakpoint
CREATE INDEX `idx_cash_movements_tenant` ON `cash_movements` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_movements_session` ON `cash_movements` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_movements_type` ON `cash_movements` (`type`);--> statement-breakpoint
CREATE INDEX `idx_cash_movements_created_by` ON `cash_movements` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_cash_movements_session_created` ON `cash_movements` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_cash_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`cashier_id` text NOT NULL,
	`register_name` text NOT NULL,
	`opening_float` real DEFAULT 0 NOT NULL,
	`opening_count_denominations` text NOT NULL,
	`expected_balance` real DEFAULT 0 NOT NULL,
	`actual_count` real,
	`actual_count_denominations` text,
	`over_short` real,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` text DEFAULT (datetime('now')) NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashier_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_cash_sessions_opening_nonneg" CHECK("__new_cash_sessions"."opening_float" >= 0),
	CONSTRAINT "chk_cash_sessions_opening_2dec" CHECK(round("__new_cash_sessions"."opening_float", 2) = "__new_cash_sessions"."opening_float"),
	CONSTRAINT "chk_cash_sessions_expected_nonneg" CHECK("__new_cash_sessions"."expected_balance" >= 0),
	CONSTRAINT "chk_cash_sessions_expected_2dec" CHECK(round("__new_cash_sessions"."expected_balance", 2) = "__new_cash_sessions"."expected_balance"),
	CONSTRAINT "chk_cash_sessions_over_short_2dec" CHECK(round("__new_cash_sessions"."over_short", 2) = "__new_cash_sessions"."over_short")
);
--> statement-breakpoint
INSERT INTO `__new_cash_sessions`("id", "tenant_id", "site_id", "cashier_id", "register_name", "opening_float", "opening_count_denominations", "expected_balance", "actual_count", "actual_count_denominations", "over_short", "status", "opened_at", "closed_at", "created_at", "updated_at") SELECT "id", "tenant_id", "site_id", "cashier_id", "register_name", "opening_float", "opening_count_denominations", "expected_balance", "actual_count", "actual_count_denominations", "over_short", "status", "opened_at", "closed_at", "created_at", "updated_at" FROM `cash_sessions`;--> statement-breakpoint
DROP TABLE `cash_sessions`;--> statement-breakpoint
ALTER TABLE `__new_cash_sessions` RENAME TO `cash_sessions`;--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_tenant` ON `cash_sessions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_site` ON `cash_sessions` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_cashier` ON `cash_sessions` (`cashier_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_status` ON `cash_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_site_status` ON `cash_sessions` (`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_register_status` ON `cash_sessions` (`site_id`,`register_name`,`status`);--> statement-breakpoint
CREATE TABLE `__new_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`address` text,
	`city` text,
	`state` text,
	`postal_code` text,
	`country` text,
	`tax_id` text,
	`identification_type_id` text,
	`person_type_id` text,
	`regime_type_id` text,
	`client_type_id` text,
	`commercial_activity_id` text,
	`notes` text,
	`credit_limit` real DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_customers_credit_limit_nonneg" CHECK("__new_customers"."credit_limit" >= 0),
	CONSTRAINT "chk_customers_credit_limit_2dec" CHECK(round("__new_customers"."credit_limit", 2) = "__new_customers"."credit_limit")
);
--> statement-breakpoint
INSERT INTO `__new_customers`("id", "tenant_id", "name", "email", "phone", "address", "city", "state", "postal_code", "country", "tax_id", "identification_type_id", "person_type_id", "regime_type_id", "client_type_id", "commercial_activity_id", "notes", "credit_limit", "is_active", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "name", "email", "phone", "address", "city", "state", "postal_code", "country", "tax_id", "identification_type_id", "person_type_id", "regime_type_id", "client_type_id", "commercial_activity_id", "notes", "credit_limit", "is_active", "sync_status", "sync_version", "created_at", "updated_at" FROM `customers`;--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;--> statement-breakpoint
CREATE INDEX `idx_customers_tenant` ON `customers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_customers_email` ON `customers` (`email`);--> statement-breakpoint
CREATE TABLE `__new_denomination_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`register_name` text NOT NULL,
	`label` text NOT NULL,
	`opening_float` real DEFAULT 0 NOT NULL,
	`denominations` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_denomination_templates_opening_nonneg" CHECK("__new_denomination_templates"."opening_float" >= 0),
	CONSTRAINT "chk_denomination_templates_opening_2dec" CHECK(round("__new_denomination_templates"."opening_float", 2) = "__new_denomination_templates"."opening_float")
);
--> statement-breakpoint
INSERT INTO `__new_denomination_templates`("id", "tenant_id", "site_id", "register_name", "label", "opening_float", "denominations", "sort_order", "is_active", "created_at", "updated_at") SELECT "id", "tenant_id", "site_id", "register_name", "label", "opening_float", "denominations", "sort_order", "is_active", "created_at", "updated_at" FROM `denomination_templates`;--> statement-breakpoint
DROP TABLE `denomination_templates`;--> statement-breakpoint
ALTER TABLE `__new_denomination_templates` RENAME TO `denomination_templates`;--> statement-breakpoint
CREATE INDEX `idx_denomination_templates_tenant` ON `denomination_templates` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_denomination_templates_site` ON `denomination_templates` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_denomination_templates_site_active` ON `denomination_templates` (`site_id`,`is_active`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_denomination_templates_site_register` ON `denomination_templates` (`site_id`,`register_name`);--> statement-breakpoint
CREATE TABLE `__new_initial_inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`site_id` text,
	`mode` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`normalized_quantity` real NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`previous_stock` real NOT NULL,
	`new_stock` real NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_initial_inventory_cost_nonneg" CHECK("__new_initial_inventory"."cost" >= 0),
	CONSTRAINT "chk_initial_inventory_cost_2dec" CHECK(round("__new_initial_inventory"."cost", 2) = "__new_initial_inventory"."cost")
);
--> statement-breakpoint
INSERT INTO `__new_initial_inventory`("id", "tenant_id", "product_id", "unit_id", "site_id", "mode", "quantity", "unit_equivalence", "normalized_quantity", "cost", "previous_stock", "new_stock", "notes", "created_by", "sync_status", "sync_version", "created_at") SELECT "id", "tenant_id", "product_id", "unit_id", "site_id", "mode", "quantity", "unit_equivalence", "normalized_quantity", "cost", "previous_stock", "new_stock", "notes", "created_by", "sync_status", "sync_version", "created_at" FROM `initial_inventory`;--> statement-breakpoint
DROP TABLE `initial_inventory`;--> statement-breakpoint
ALTER TABLE `__new_initial_inventory` RENAME TO `initial_inventory`;--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_tenant` ON `initial_inventory` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_product` ON `initial_inventory` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_unit` ON `initial_inventory` (`unit_id`);--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_site` ON `initial_inventory` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_created_by` ON `initial_inventory` (`created_by`);--> statement-breakpoint
CREATE TABLE `__new_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_id` text NOT NULL,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`cost_per_unit` real DEFAULT 0 NOT NULL,
	`base_unit_cost` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_order_items_cost_per_unit_nonneg" CHECK("__new_order_items"."cost_per_unit" >= 0),
	CONSTRAINT "chk_order_items_cost_per_unit_2dec" CHECK(round("__new_order_items"."cost_per_unit", 2) = "__new_order_items"."cost_per_unit"),
	CONSTRAINT "chk_order_items_base_cost_nonneg" CHECK("__new_order_items"."base_unit_cost" >= 0),
	CONSTRAINT "chk_order_items_base_cost_2dec" CHECK(round("__new_order_items"."base_unit_cost", 2) = "__new_order_items"."base_unit_cost"),
	CONSTRAINT "chk_order_items_total_nonneg" CHECK("__new_order_items"."total" >= 0),
	CONSTRAINT "chk_order_items_total_2dec" CHECK(round("__new_order_items"."total", 2) = "__new_order_items"."total")
);
--> statement-breakpoint
INSERT INTO `__new_order_items`("id", "order_id", "product_id", "quantity", "unit_id", "unit_equivalence", "cost_per_unit", "base_unit_cost", "total") SELECT "id", "order_id", "product_id", "quantity", "unit_id", "unit_equivalence", "cost_per_unit", "base_unit_cost", "total" FROM `order_items`;--> statement-breakpoint
DROP TABLE `order_items`;--> statement-breakpoint
ALTER TABLE `__new_order_items` RENAME TO `order_items`;--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_number` text NOT NULL,
	`provider_id` text NOT NULL,
	`site_id` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_orders_subtotal_nonneg" CHECK("__new_orders"."subtotal" >= 0),
	CONSTRAINT "chk_orders_subtotal_2dec" CHECK(round("__new_orders"."subtotal", 2) = "__new_orders"."subtotal"),
	CONSTRAINT "chk_orders_total_nonneg" CHECK("__new_orders"."total" >= 0),
	CONSTRAINT "chk_orders_total_2dec" CHECK(round("__new_orders"."total", 2) = "__new_orders"."total")
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "tenant_id", "order_number", "provider_id", "site_id", "status", "subtotal", "total", "notes", "created_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "order_number", "provider_id", "site_id", "status", "subtotal", "total", "notes", "created_by", "sync_status", "sync_version", "created_at", "updated_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
CREATE INDEX `idx_orders_tenant` ON `orders` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_provider` ON `orders` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_site` ON `orders` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_created_by` ON `orders` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_tenant_number` ON `orders` (`tenant_id`,`order_number`);--> statement-breakpoint
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
	`vat_rate_id` text,
	`provider_id` text,
	`location_id` text,
	`initial_cost` real DEFAULT 0 NOT NULL,
	`stock` real DEFAULT 0 NOT NULL,
	`min_stock` real DEFAULT 0 NOT NULL,
	`sell_by_fraction` integer DEFAULT false NOT NULL,
	`fraction_step` real,
	`fraction_minimum` real,
	`is_active` integer DEFAULT true,
	`barcode` text,
	`image_url` text,
	`embedding` text,
	`embedding_model` text,
	`embedded_at` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vat_rate_id`) REFERENCES `vat_rates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
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
INSERT INTO `__new_products`("id", "tenant_id", "name", "sku", "description", "category_id", "price", "price2", "price3", "cost", "margin_percent1", "margin_percent2", "margin_percent3", "margin_amount1", "margin_amount2", "margin_amount3", "tax_rate", "vat_rate_id", "provider_id", "location_id", "initial_cost", "stock", "min_stock", "sell_by_fraction", "fraction_step", "fraction_minimum", "is_active", "barcode", "image_url", "embedding", "embedding_model", "embedded_at", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "name", "sku", "description", "category_id", "price", "price2", "price3", "cost", "margin_percent1", "margin_percent2", "margin_percent3", "margin_amount1", "margin_amount2", "margin_amount3", "tax_rate", "vat_rate_id", "provider_id", "location_id", "initial_cost", "stock", "min_stock", "sell_by_fraction", "fraction_step", "fraction_minimum", "is_active", "barcode", "image_url", "embedding", "embedding_model", "embedded_at", "sync_status", "sync_version", "created_at", "updated_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE INDEX `idx_products_tenant` ON `products` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_products_sku` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_products_barcode` ON `products` (`barcode`);--> statement-breakpoint
CREATE INDEX `idx_products_category` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_products_provider` ON `products` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_products_vat_rate` ON `products` (`vat_rate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_tenant_sku` ON `products` (`tenant_id`,`sku`);--> statement-breakpoint
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
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_items_cost_per_unit_nonneg" CHECK("__new_purchase_items"."cost_per_unit" >= 0),
	CONSTRAINT "chk_purchase_items_cost_per_unit_2dec" CHECK(round("__new_purchase_items"."cost_per_unit", 2) = "__new_purchase_items"."cost_per_unit"),
	CONSTRAINT "chk_purchase_items_base_cost_nonneg" CHECK("__new_purchase_items"."base_unit_cost" >= 0),
	CONSTRAINT "chk_purchase_items_base_cost_2dec" CHECK(round("__new_purchase_items"."base_unit_cost", 2) = "__new_purchase_items"."base_unit_cost"),
	CONSTRAINT "chk_purchase_items_total_nonneg" CHECK("__new_purchase_items"."total" >= 0),
	CONSTRAINT "chk_purchase_items_total_2dec" CHECK(round("__new_purchase_items"."total", 2) = "__new_purchase_items"."total")
);
--> statement-breakpoint
INSERT INTO `__new_purchase_items`("id", "purchase_id", "product_id", "source_order_item_id", "quantity", "unit_id", "unit_equivalence", "cost_per_unit", "base_unit_cost", "total") SELECT "id", "purchase_id", "product_id", "source_order_item_id", "quantity", "unit_id", "unit_equivalence", "cost_per_unit", "base_unit_cost", "total" FROM `purchase_items`;--> statement-breakpoint
DROP TABLE `purchase_items`;--> statement-breakpoint
ALTER TABLE `__new_purchase_items` RENAME TO `purchase_items`;--> statement-breakpoint
CREATE INDEX `idx_purchase_items_purchase` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_items_product` ON `purchase_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_items_source_order_item` ON `purchase_items` (`source_order_item_id`);--> statement-breakpoint
CREATE TABLE `__new_purchase_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`return_amount` real DEFAULT 0 NOT NULL,
	`reason` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_returns_amount_nonneg" CHECK("__new_purchase_returns"."return_amount" >= 0),
	CONSTRAINT "chk_purchase_returns_amount_2dec" CHECK(round("__new_purchase_returns"."return_amount", 2) = "__new_purchase_returns"."return_amount")
);
--> statement-breakpoint
INSERT INTO `__new_purchase_returns`("id", "tenant_id", "purchase_id", "return_amount", "reason", "created_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "purchase_id", "return_amount", "reason", "created_by", "sync_status", "sync_version", "created_at", "updated_at" FROM `purchase_returns`;--> statement-breakpoint
DROP TABLE `purchase_returns`;--> statement-breakpoint
ALTER TABLE `__new_purchase_returns` RENAME TO `purchase_returns`;--> statement-breakpoint
CREATE INDEX `idx_purchase_returns_tenant` ON `purchase_returns` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_returns_purchase` ON `purchase_returns` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_returns_created_by` ON `purchase_returns` (`created_by`);--> statement-breakpoint
CREATE TABLE `__new_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_number` text NOT NULL,
	`provider_id` text NOT NULL,
	`order_id` text,
	`site_id` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchases_subtotal_nonneg" CHECK("__new_purchases"."subtotal" >= 0),
	CONSTRAINT "chk_purchases_subtotal_2dec" CHECK(round("__new_purchases"."subtotal", 2) = "__new_purchases"."subtotal"),
	CONSTRAINT "chk_purchases_total_nonneg" CHECK("__new_purchases"."total" >= 0),
	CONSTRAINT "chk_purchases_total_2dec" CHECK(round("__new_purchases"."total", 2) = "__new_purchases"."total")
);
--> statement-breakpoint
INSERT INTO `__new_purchases`("id", "tenant_id", "purchase_number", "provider_id", "order_id", "site_id", "status", "subtotal", "total", "notes", "created_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "purchase_number", "provider_id", "order_id", "site_id", "status", "subtotal", "total", "notes", "created_by", "sync_status", "sync_version", "created_at", "updated_at" FROM `purchases`;--> statement-breakpoint
DROP TABLE `purchases`;--> statement-breakpoint
ALTER TABLE `__new_purchases` RENAME TO `purchases`;--> statement-breakpoint
CREATE INDEX `idx_purchases_tenant` ON `purchases` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_provider` ON `purchases` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_order` ON `purchases` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_site` ON `purchases` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_created_by` ON `purchases` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchases_tenant_number` ON `purchases` (`tenant_id`,`purchase_number`);--> statement-breakpoint
CREATE TABLE `__new_quotation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`quotation_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_quotation_items_unit_price_nonneg" CHECK("__new_quotation_items"."unit_price" >= 0),
	CONSTRAINT "chk_quotation_items_unit_price_2dec" CHECK(round("__new_quotation_items"."unit_price", 2) = "__new_quotation_items"."unit_price"),
	CONSTRAINT "chk_quotation_items_tax_nonneg" CHECK("__new_quotation_items"."tax_amount" >= 0),
	CONSTRAINT "chk_quotation_items_tax_2dec" CHECK(round("__new_quotation_items"."tax_amount", 2) = "__new_quotation_items"."tax_amount"),
	CONSTRAINT "chk_quotation_items_total_nonneg" CHECK("__new_quotation_items"."total" >= 0),
	CONSTRAINT "chk_quotation_items_total_2dec" CHECK(round("__new_quotation_items"."total", 2) = "__new_quotation_items"."total"),
	CONSTRAINT "chk_quotation_items_discount_2dec" CHECK(round("__new_quotation_items"."discount", 2) = "__new_quotation_items"."discount")
);
--> statement-breakpoint
INSERT INTO `__new_quotation_items`("id", "quotation_id", "product_id", "quantity", "unit_price", "discount", "tax_rate", "tax_amount", "total", "created_at") SELECT "id", "quotation_id", "product_id", "quantity", "unit_price", "discount", "tax_rate", "tax_amount", "total", "created_at" FROM `quotation_items`;--> statement-breakpoint
DROP TABLE `quotation_items`;--> statement-breakpoint
ALTER TABLE `__new_quotation_items` RENAME TO `quotation_items`;--> statement-breakpoint
CREATE INDEX `idx_quotation_items_quotation` ON `quotation_items` (`quotation_id`);--> statement-breakpoint
CREATE INDEX `idx_quotation_items_product` ON `quotation_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_quotations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`quotation_number` text NOT NULL,
	`customer_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`valid_until` text,
	`notes` text,
	`created_by` text NOT NULL,
	`status_changed_at` text,
	`status_changed_by` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_quotations_subtotal_nonneg" CHECK("__new_quotations"."subtotal" >= 0),
	CONSTRAINT "chk_quotations_subtotal_2dec" CHECK(round("__new_quotations"."subtotal", 2) = "__new_quotations"."subtotal"),
	CONSTRAINT "chk_quotations_tax_nonneg" CHECK("__new_quotations"."tax_amount" >= 0),
	CONSTRAINT "chk_quotations_tax_2dec" CHECK(round("__new_quotations"."tax_amount", 2) = "__new_quotations"."tax_amount"),
	CONSTRAINT "chk_quotations_total_nonneg" CHECK("__new_quotations"."total" >= 0),
	CONSTRAINT "chk_quotations_total_2dec" CHECK(round("__new_quotations"."total", 2) = "__new_quotations"."total"),
	CONSTRAINT "chk_quotations_discount_2dec" CHECK(round("__new_quotations"."discount_amount", 2) = "__new_quotations"."discount_amount")
);
--> statement-breakpoint
INSERT INTO `__new_quotations`("id", "tenant_id", "site_id", "quotation_number", "customer_id", "status", "subtotal", "tax_amount", "discount_amount", "total", "valid_until", "notes", "created_by", "status_changed_at", "status_changed_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "site_id", "quotation_number", "customer_id", "status", "subtotal", "tax_amount", "discount_amount", "total", "valid_until", "notes", "created_by", "status_changed_at", "status_changed_by", "sync_status", "sync_version", "created_at", "updated_at" FROM `quotations`;--> statement-breakpoint
DROP TABLE `quotations`;--> statement-breakpoint
ALTER TABLE `__new_quotations` RENAME TO `quotations`;--> statement-breakpoint
CREATE INDEX `idx_quotations_tenant` ON `quotations` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_site` ON `quotations` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_customer` ON `quotations` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_status` ON `quotations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_quotations_created_by` ON `quotations` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotations_tenant_number` ON `quotations` (`tenant_id`,`quotation_number`);--> statement-breakpoint
CREATE INDEX `idx_quotations_tenant_status_valid_until` ON `quotations` (`tenant_id`,`status`,`valid_until`);--> statement-breakpoint
CREATE TABLE `__new_sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`unit_id` text,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`cost_at_sale` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`notes` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_items_unit_price_nonneg" CHECK("__new_sale_items"."unit_price" >= 0),
	CONSTRAINT "chk_sale_items_unit_price_2dec" CHECK(round("__new_sale_items"."unit_price", 2) = "__new_sale_items"."unit_price"),
	CONSTRAINT "chk_sale_items_tax_nonneg" CHECK("__new_sale_items"."tax_amount" >= 0),
	CONSTRAINT "chk_sale_items_tax_2dec" CHECK(round("__new_sale_items"."tax_amount", 2) = "__new_sale_items"."tax_amount"),
	CONSTRAINT "chk_sale_items_cost_nonneg" CHECK("__new_sale_items"."cost_at_sale" >= 0),
	CONSTRAINT "chk_sale_items_cost_2dec" CHECK(round("__new_sale_items"."cost_at_sale", 2) = "__new_sale_items"."cost_at_sale"),
	CONSTRAINT "chk_sale_items_total_nonneg" CHECK("__new_sale_items"."total" >= 0),
	CONSTRAINT "chk_sale_items_total_2dec" CHECK(round("__new_sale_items"."total", 2) = "__new_sale_items"."total"),
	CONSTRAINT "chk_sale_items_discount_2dec" CHECK(round("__new_sale_items"."discount", 2) = "__new_sale_items"."discount")
);
--> statement-breakpoint
INSERT INTO `__new_sale_items`("id", "sale_id", "product_id", "quantity", "unit_price", "unit_id", "unit_equivalence", "discount", "tax_rate", "tax_amount", "cost_at_sale", "total", "notes") SELECT "id", "sale_id", "product_id", "quantity", "unit_price", "unit_id", "unit_equivalence", "discount", "tax_rate", "tax_amount", "cost_at_sale", "total", "notes" FROM `sale_items`;--> statement-breakpoint
DROP TABLE `sale_items`;--> statement-breakpoint
ALTER TABLE `__new_sale_items` RENAME TO `sale_items`;--> statement-breakpoint
CREATE INDEX `idx_sale_items_sale` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_items_product` ON `sale_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_sale_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` real NOT NULL,
	`reference` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_sale_payments_amount_2dec" CHECK(round("__new_sale_payments"."amount", 2) = "__new_sale_payments"."amount")
);
--> statement-breakpoint
INSERT INTO `__new_sale_payments`("id", "tenant_id", "sale_id", "method", "amount", "reference", "sync_status", "sync_version", "created_at") SELECT "id", "tenant_id", "sale_id", "method", "amount", "reference", "sync_status", "sync_version", "created_at" FROM `sale_payments`;--> statement-breakpoint
DROP TABLE `sale_payments`;--> statement-breakpoint
ALTER TABLE `__new_sale_payments` RENAME TO `sale_payments`;--> statement-breakpoint
CREATE INDEX `idx_sale_payments_tenant` ON `sale_payments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_payments_sale` ON `sale_payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_payments_method` ON `sale_payments` (`method`);--> statement-breakpoint
CREATE TABLE `__new_sale_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`refund_amount` real DEFAULT 0 NOT NULL,
	`reason` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_returns_refund_nonneg" CHECK("__new_sale_returns"."refund_amount" >= 0),
	CONSTRAINT "chk_sale_returns_refund_2dec" CHECK(round("__new_sale_returns"."refund_amount", 2) = "__new_sale_returns"."refund_amount")
);
--> statement-breakpoint
INSERT INTO `__new_sale_returns`("id", "tenant_id", "sale_id", "refund_amount", "reason", "created_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "sale_id", "refund_amount", "reason", "created_by", "sync_status", "sync_version", "created_at", "updated_at" FROM `sale_returns`;--> statement-breakpoint
DROP TABLE `sale_returns`;--> statement-breakpoint
ALTER TABLE `__new_sale_returns` RENAME TO `sale_returns`;--> statement-breakpoint
CREATE INDEX `idx_sale_returns_tenant` ON `sale_returns` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_returns_sale` ON `sale_returns` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_returns_created_by` ON `sale_returns` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_returns_sale_unique` ON `sale_returns` (`sale_id`);--> statement-breakpoint
CREATE TABLE `__new_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_number` text NOT NULL,
	`customer_id` text,
	`table_id` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`tip_amount` real DEFAULT 0 NOT NULL,
	`tip_method` text,
	`service_charge_amount` real DEFAULT 0 NOT NULL,
	`service_charge_rate` real,
	`payment_method` text DEFAULT 'cash' NOT NULL,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`cash_session_id` text,
	`notes` text,
	`created_by` text NOT NULL,
	`suspended_at` text,
	`suspended_by` text,
	`suspended_label` text,
	`reprint_count` integer DEFAULT 0 NOT NULL,
	`last_reprinted_at` text,
	`last_reprinted_by` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suspended_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_reprinted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sales_subtotal_nonneg" CHECK("__new_sales"."subtotal" >= 0),
	CONSTRAINT "chk_sales_subtotal_2dec" CHECK(round("__new_sales"."subtotal", 2) = "__new_sales"."subtotal"),
	CONSTRAINT "chk_sales_tax_nonneg" CHECK("__new_sales"."tax_amount" >= 0),
	CONSTRAINT "chk_sales_tax_2dec" CHECK(round("__new_sales"."tax_amount", 2) = "__new_sales"."tax_amount"),
	CONSTRAINT "chk_sales_total_nonneg" CHECK("__new_sales"."total" >= 0),
	CONSTRAINT "chk_sales_total_2dec" CHECK(round("__new_sales"."total", 2) = "__new_sales"."total"),
	CONSTRAINT "chk_sales_tip_nonneg" CHECK("__new_sales"."tip_amount" >= 0),
	CONSTRAINT "chk_sales_tip_2dec" CHECK(round("__new_sales"."tip_amount", 2) = "__new_sales"."tip_amount"),
	CONSTRAINT "chk_sales_service_nonneg" CHECK("__new_sales"."service_charge_amount" >= 0),
	CONSTRAINT "chk_sales_service_2dec" CHECK(round("__new_sales"."service_charge_amount", 2) = "__new_sales"."service_charge_amount"),
	CONSTRAINT "chk_sales_discount_2dec" CHECK(round("__new_sales"."discount_amount", 2) = "__new_sales"."discount_amount")
);
--> statement-breakpoint
INSERT INTO `__new_sales`("id", "tenant_id", "sale_number", "customer_id", "table_id", "subtotal", "tax_amount", "discount_amount", "total", "tip_amount", "tip_method", "service_charge_amount", "service_charge_rate", "payment_method", "payment_status", "status", "cash_session_id", "notes", "created_by", "suspended_at", "suspended_by", "suspended_label", "reprint_count", "last_reprinted_at", "last_reprinted_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "sale_number", "customer_id", "table_id", "subtotal", "tax_amount", "discount_amount", "total", "tip_amount", "tip_method", "service_charge_amount", "service_charge_rate", "payment_method", "payment_status", "status", "cash_session_id", "notes", "created_by", "suspended_at", "suspended_by", "suspended_label", "reprint_count", "last_reprinted_at", "last_reprinted_by", "sync_status", "sync_version", "created_at", "updated_at" FROM `sales`;--> statement-breakpoint
DROP TABLE `sales`;--> statement-breakpoint
ALTER TABLE `__new_sales` RENAME TO `sales`;--> statement-breakpoint
CREATE INDEX `idx_sales_tenant` ON `sales` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_customer` ON `sales` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_cash_session` ON `sales` (`cash_session_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_created_by` ON `sales` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_sales_suspended_by` ON `sales` (`suspended_by`);--> statement-breakpoint
CREATE INDEX `idx_sales_tenant_table` ON `sales` (`tenant_id`,`table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_tenant_number` ON `sales` (`tenant_id`,`sale_number`);--> statement-breakpoint
PRAGMA foreign_keys=ON;