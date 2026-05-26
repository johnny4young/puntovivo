-- ENG-176b — Currency seam on transactional tables + complete fiscal
-- CHECK coverage.
--
-- ENG-176a (Step-a + Step-b) closed the `>= 0` and
-- `round(col, 2) = col` invariants on 17 monetary tables but left
-- three gaps:
--
--   1. No `currency_code` per row on `sales` / `sale_items` /
--      `quotations` / `quotation_items` / `products` / `customers`.
--      The whole storage layer assumed everything was in the tenant's
--      default currency (hard-coded ISO=2-decimal). Blocks ENG-156
--      (multi-currency operations) and ENG-161 (NFe Brazil).
--   2. `tenants.default_currency_code` did not exist as a flat column
--      — the value lived in `tenants.settings` JSON and
--      `tenant_locale_settings.currency_override` / `country_code` →
--      `country_catalog.default_currency_code`. App code had to
--      resolve through those layers on every monetary write.
--   3. `fiscal_documents`, `fiscal_document_items`, and
--      `payment_outbox` carried no CHECK invariants. The Drizzle
--      snapshot chain skipped these three tables (added by raw SQL
--      migrations outside the journal), so 0035 / 0036 could not
--      emit a clean recreation. ENG-176b recreates them at the same
--      time as the currency seam.
--
-- This migration:
--
--   * Recreates `tenants` with `default_currency_code TEXT NOT NULL`
--     FK to `currency_catalog`. Backfills via COALESCE chain:
--       1) `tenant_locale_settings.currency_override` if not null
--       2) `country_catalog.default_currency_code` joined through
--          `tenant_locale_settings.country_code`
--       3) `json_extract(settings, '$.currency')` from legacy JSON
--       4) 'COP' as project default fallback.
--   * Recreates `products`, `sales`, `sale_items`, `quotations`,
--     `quotation_items` with `currency_code` (NOT NULL, FK, defaults
--     to tenant) and `customers` with `credit_limit_currency_code`
--     (nullable, FK).
--   * Recreates `sales`, `sale_items`, `quotations`, `quotation_items`
--     with two extra columns required for ENG-156 multi-currency:
--     `exchange_rate_at_sale REAL NOT NULL DEFAULT 1.0` and
--     `settle_currency_code TEXT` (nullable). Adds CHECK
--     `exchange_rate_at_sale > 0`.
--   * Recreates `fiscal_documents`, `fiscal_document_items`, and
--     `payment_outbox` to attach both `_nonneg` and `_2dec` CHECK
--     invariants that the snapshot chain prevented landing in
--     ENG-176a Step-a/Step-b.
--
-- All recreations wrap in `PRAGMA foreign_keys = OFF/ON` to defer FK
-- validation while shuffling table identities. `currency_catalog`
-- and `country_catalog` already exist (created by 0003). They may be
-- empty at migration time on a fresh install — `seedLocaleCatalogs`
-- populates them after migrations finish, and SQLite does not
-- re-check FKs at PRAGMA toggle time, so the deferred validation is
-- safe.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`settings` text DEFAULT '{}',
	`default_currency_code` text DEFAULT 'COP' NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`default_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tenants`("id", "name", "slug", "settings", "default_currency_code", "is_active", "created_at", "updated_at") SELECT t."id", t."name", t."slug", t."settings", COALESCE((SELECT tls.currency_override FROM tenant_locale_settings tls WHERE tls.tenant_id = t.id AND tls.currency_override IS NOT NULL), (SELECT cc.default_currency_code FROM tenant_locale_settings tls JOIN country_catalog cc ON cc.code = tls.country_code WHERE tls.tenant_id = t.id), json_extract(t."settings", '$.currency'), 'COP'), t."is_active", t."created_at", t."updated_at" FROM `tenants` t;--> statement-breakpoint
DROP TABLE `tenants`;--> statement-breakpoint
ALTER TABLE `__new_tenants` RENAME TO `tenants`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tenants_slug` ON `tenants` (`slug`);--> statement-breakpoint
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
	`currency_code` text DEFAULT 'COP' NOT NULL,
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
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
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
INSERT INTO `__new_products`("id", "tenant_id", "name", "sku", "description", "category_id", "price", "price2", "price3", "cost", "margin_percent1", "margin_percent2", "margin_percent3", "margin_amount1", "margin_amount2", "margin_amount3", "tax_rate", "vat_rate_id", "provider_id", "location_id", "initial_cost", "currency_code", "stock", "min_stock", "sell_by_fraction", "fraction_step", "fraction_minimum", "is_active", "barcode", "image_url", "embedding", "embedding_model", "embedded_at", "sync_status", "sync_version", "created_at", "updated_at") SELECT p."id", p."tenant_id", p."name", p."sku", p."description", p."category_id", p."price", p."price2", p."price3", p."cost", p."margin_percent1", p."margin_percent2", p."margin_percent3", p."margin_amount1", p."margin_amount2", p."margin_amount3", p."tax_rate", p."vat_rate_id", p."provider_id", p."location_id", p."initial_cost", COALESCE((SELECT t.default_currency_code FROM tenants t WHERE t.id = p.tenant_id), 'COP'), p."stock", p."min_stock", p."sell_by_fraction", p."fraction_step", p."fraction_minimum", p."is_active", p."barcode", p."image_url", p."embedding", p."embedding_model", p."embedded_at", p."sync_status", p."sync_version", p."created_at", p."updated_at" FROM `products` p;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE INDEX `idx_products_tenant` ON `products` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_products_sku` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_products_barcode` ON `products` (`barcode`);--> statement-breakpoint
CREATE INDEX `idx_products_category` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_products_provider` ON `products` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_products_vat_rate` ON `products` (`vat_rate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_tenant_sku` ON `products` (`tenant_id`,`sku`);--> statement-breakpoint
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
	`credit_limit_currency_code` text,
	`is_active` integer DEFAULT true,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_limit_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_customers_credit_limit_nonneg" CHECK("__new_customers"."credit_limit" >= 0),
	CONSTRAINT "chk_customers_credit_limit_2dec" CHECK(round("__new_customers"."credit_limit", 2) = "__new_customers"."credit_limit")
);
--> statement-breakpoint
INSERT INTO `__new_customers`("id", "tenant_id", "name", "email", "phone", "address", "city", "state", "postal_code", "country", "tax_id", "identification_type_id", "person_type_id", "regime_type_id", "client_type_id", "commercial_activity_id", "notes", "credit_limit", "credit_limit_currency_code", "is_active", "sync_status", "sync_version", "created_at", "updated_at") SELECT c."id", c."tenant_id", c."name", c."email", c."phone", c."address", c."city", c."state", c."postal_code", c."country", c."tax_id", c."identification_type_id", c."person_type_id", c."regime_type_id", c."client_type_id", c."commercial_activity_id", c."notes", c."credit_limit", CASE WHEN c."credit_limit" > 0 THEN COALESCE((SELECT t.default_currency_code FROM tenants t WHERE t.id = c.tenant_id), 'COP') ELSE NULL END, c."is_active", c."sync_status", c."sync_version", c."created_at", c."updated_at" FROM `customers` c;--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;--> statement-breakpoint
CREATE INDEX `idx_customers_tenant` ON `customers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_customers_email` ON `customers` (`email`);--> statement-breakpoint
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
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`exchange_rate_at_sale` real DEFAULT 1 NOT NULL,
	`settle_currency_code` text,
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
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settle_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
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
	CONSTRAINT "chk_sales_discount_2dec" CHECK(round("__new_sales"."discount_amount", 2) = "__new_sales"."discount_amount"),
	CONSTRAINT "chk_sales_exchange_rate_positive" CHECK("__new_sales"."exchange_rate_at_sale" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_sales`("id", "tenant_id", "sale_number", "customer_id", "table_id", "subtotal", "tax_amount", "discount_amount", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "tip_amount", "tip_method", "service_charge_amount", "service_charge_rate", "payment_method", "payment_status", "status", "cash_session_id", "notes", "created_by", "suspended_at", "suspended_by", "suspended_label", "reprint_count", "last_reprinted_at", "last_reprinted_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT s."id", s."tenant_id", s."sale_number", s."customer_id", s."table_id", s."subtotal", s."tax_amount", s."discount_amount", s."total", COALESCE((SELECT t.default_currency_code FROM tenants t WHERE t.id = s.tenant_id), 'COP'), 1, NULL, s."tip_amount", s."tip_method", s."service_charge_amount", s."service_charge_rate", s."payment_method", s."payment_status", s."status", s."cash_session_id", s."notes", s."created_by", s."suspended_at", s."suspended_by", s."suspended_label", s."reprint_count", s."last_reprinted_at", s."last_reprinted_by", s."sync_status", s."sync_version", s."created_at", s."updated_at" FROM `sales` s;--> statement-breakpoint
DROP TABLE `sales`;--> statement-breakpoint
ALTER TABLE `__new_sales` RENAME TO `sales`;--> statement-breakpoint
CREATE INDEX `idx_sales_tenant` ON `sales` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_customer` ON `sales` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_cash_session` ON `sales` (`cash_session_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_created_by` ON `sales` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_sales_suspended_by` ON `sales` (`suspended_by`);--> statement-breakpoint
CREATE INDEX `idx_sales_tenant_table` ON `sales` (`tenant_id`,`table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_tenant_number` ON `sales` (`tenant_id`,`sale_number`);--> statement-breakpoint
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
INSERT INTO `__new_sale_items`("id", "sale_id", "product_id", "quantity", "unit_price", "unit_id", "unit_equivalence", "discount", "tax_rate", "tax_amount", "cost_at_sale", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "notes") SELECT si."id", si."sale_id", si."product_id", si."quantity", si."unit_price", si."unit_id", si."unit_equivalence", si."discount", si."tax_rate", si."tax_amount", si."cost_at_sale", si."total", COALESCE((SELECT s.currency_code FROM sales s WHERE s.id = si.sale_id), 'COP'), COALESCE((SELECT s.exchange_rate_at_sale FROM sales s WHERE s.id = si.sale_id), 1), (SELECT s.settle_currency_code FROM sales s WHERE s.id = si.sale_id), si."notes" FROM `sale_items` si;--> statement-breakpoint
DROP TABLE `sale_items`;--> statement-breakpoint
ALTER TABLE `__new_sale_items` RENAME TO `sale_items`;--> statement-breakpoint
CREATE INDEX `idx_sale_items_sale` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_items_product` ON `sale_items` (`product_id`);--> statement-breakpoint
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
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`exchange_rate_at_sale` real DEFAULT 1 NOT NULL,
	`settle_currency_code` text,
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
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settle_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_quotations_subtotal_nonneg" CHECK("__new_quotations"."subtotal" >= 0),
	CONSTRAINT "chk_quotations_subtotal_2dec" CHECK(round("__new_quotations"."subtotal", 2) = "__new_quotations"."subtotal"),
	CONSTRAINT "chk_quotations_tax_nonneg" CHECK("__new_quotations"."tax_amount" >= 0),
	CONSTRAINT "chk_quotations_tax_2dec" CHECK(round("__new_quotations"."tax_amount", 2) = "__new_quotations"."tax_amount"),
	CONSTRAINT "chk_quotations_total_nonneg" CHECK("__new_quotations"."total" >= 0),
	CONSTRAINT "chk_quotations_total_2dec" CHECK(round("__new_quotations"."total", 2) = "__new_quotations"."total"),
	CONSTRAINT "chk_quotations_discount_2dec" CHECK(round("__new_quotations"."discount_amount", 2) = "__new_quotations"."discount_amount"),
	CONSTRAINT "chk_quotations_exchange_rate_positive" CHECK("__new_quotations"."exchange_rate_at_sale" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_quotations`("id", "tenant_id", "site_id", "quotation_number", "customer_id", "status", "subtotal", "tax_amount", "discount_amount", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "valid_until", "notes", "created_by", "status_changed_at", "status_changed_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT q."id", q."tenant_id", q."site_id", q."quotation_number", q."customer_id", q."status", q."subtotal", q."tax_amount", q."discount_amount", q."total", COALESCE((SELECT t.default_currency_code FROM tenants t WHERE t.id = q.tenant_id), 'COP'), 1, NULL, q."valid_until", q."notes", q."created_by", q."status_changed_at", q."status_changed_by", q."sync_status", q."sync_version", q."created_at", q."updated_at" FROM `quotations` q;--> statement-breakpoint
DROP TABLE `quotations`;--> statement-breakpoint
ALTER TABLE `__new_quotations` RENAME TO `quotations`;--> statement-breakpoint
CREATE INDEX `idx_quotations_tenant` ON `quotations` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_site` ON `quotations` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_customer` ON `quotations` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_status` ON `quotations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_quotations_created_by` ON `quotations` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotations_tenant_number` ON `quotations` (`tenant_id`,`quotation_number`);--> statement-breakpoint
CREATE INDEX `idx_quotations_tenant_status_valid_until` ON `quotations` (`tenant_id`,`status`,`valid_until`);--> statement-breakpoint
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
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`exchange_rate_at_sale` real DEFAULT 1 NOT NULL,
	`settle_currency_code` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settle_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_quotation_items_unit_price_nonneg" CHECK("__new_quotation_items"."unit_price" >= 0),
	CONSTRAINT "chk_quotation_items_unit_price_2dec" CHECK(round("__new_quotation_items"."unit_price", 2) = "__new_quotation_items"."unit_price"),
	CONSTRAINT "chk_quotation_items_tax_nonneg" CHECK("__new_quotation_items"."tax_amount" >= 0),
	CONSTRAINT "chk_quotation_items_tax_2dec" CHECK(round("__new_quotation_items"."tax_amount", 2) = "__new_quotation_items"."tax_amount"),
	CONSTRAINT "chk_quotation_items_total_nonneg" CHECK("__new_quotation_items"."total" >= 0),
	CONSTRAINT "chk_quotation_items_total_2dec" CHECK(round("__new_quotation_items"."total", 2) = "__new_quotation_items"."total"),
	CONSTRAINT "chk_quotation_items_discount_2dec" CHECK(round("__new_quotation_items"."discount", 2) = "__new_quotation_items"."discount"),
	CONSTRAINT "chk_quotation_items_exchange_rate_positive" CHECK("__new_quotation_items"."exchange_rate_at_sale" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_quotation_items`("id", "quotation_id", "product_id", "quantity", "unit_price", "discount", "tax_rate", "tax_amount", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "created_at") SELECT qi."id", qi."quotation_id", qi."product_id", qi."quantity", qi."unit_price", qi."discount", qi."tax_rate", qi."tax_amount", qi."total", COALESCE((SELECT q.currency_code FROM quotations q WHERE q.id = qi.quotation_id), 'COP'), COALESCE((SELECT q.exchange_rate_at_sale FROM quotations q WHERE q.id = qi.quotation_id), 1), (SELECT q.settle_currency_code FROM quotations q WHERE q.id = qi.quotation_id), qi."created_at" FROM `quotation_items` qi;--> statement-breakpoint
DROP TABLE `quotation_items`;--> statement-breakpoint
ALTER TABLE `__new_quotation_items` RENAME TO `quotation_items`;--> statement-breakpoint
CREATE INDEX `idx_quotation_items_quotation` ON `quotation_items` (`quotation_id`);--> statement-breakpoint
CREATE INDEX `idx_quotation_items_product` ON `quotation_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_fiscal_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`resolution_id` text NOT NULL,
	`consecutive` integer NOT NULL,
	`document_number` text NOT NULL,
	`cufe` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`customer_id` text,
	`buyer_tax_id` text NOT NULL,
	`buyer_tax_id_type_code` text NOT NULL,
	`buyer_name` text NOT NULL,
	`buyer_email` text,
	`buyer_address` text,
	`buyer_city` text,
	`buyer_department` text,
	`buyer_country` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`currency_code` text NOT NULL,
	`locale_code` text NOT NULL,
	`original_cufe` text,
	`reason_code` text,
	`provider_id` text NOT NULL,
	`provider_response` text,
	`xml_ref` text,
	`retries` integer DEFAULT 0 NOT NULL,
	`emitted_by_user_id` text NOT NULL,
	`emitted_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolution_id`) REFERENCES `fiscal_numbering_resolutions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_tax_id_type_code`) REFERENCES `dian_identification_types`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`emitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fiscal_documents_subtotal_nonneg" CHECK("__new_fiscal_documents"."subtotal" >= 0),
	CONSTRAINT "chk_fiscal_documents_subtotal_2dec" CHECK(round("__new_fiscal_documents"."subtotal", 2) = "__new_fiscal_documents"."subtotal"),
	CONSTRAINT "chk_fiscal_documents_tax_nonneg" CHECK("__new_fiscal_documents"."tax_amount" >= 0),
	CONSTRAINT "chk_fiscal_documents_tax_2dec" CHECK(round("__new_fiscal_documents"."tax_amount", 2) = "__new_fiscal_documents"."tax_amount"),
	CONSTRAINT "chk_fiscal_documents_discount_nonneg" CHECK("__new_fiscal_documents"."discount_amount" >= 0),
	CONSTRAINT "chk_fiscal_documents_discount_2dec" CHECK(round("__new_fiscal_documents"."discount_amount", 2) = "__new_fiscal_documents"."discount_amount"),
	CONSTRAINT "chk_fiscal_documents_total_nonneg" CHECK("__new_fiscal_documents"."total_amount" >= 0),
	CONSTRAINT "chk_fiscal_documents_total_2dec" CHECK(round("__new_fiscal_documents"."total_amount", 2) = "__new_fiscal_documents"."total_amount")
);
--> statement-breakpoint
UPDATE `fiscal_documents` SET `subtotal` = round(`subtotal`, 2) WHERE round(`subtotal`, 2) != `subtotal`;--> statement-breakpoint
UPDATE `fiscal_documents` SET `tax_amount` = round(`tax_amount`, 2) WHERE round(`tax_amount`, 2) != `tax_amount`;--> statement-breakpoint
UPDATE `fiscal_documents` SET `discount_amount` = round(`discount_amount`, 2) WHERE round(`discount_amount`, 2) != `discount_amount`;--> statement-breakpoint
UPDATE `fiscal_documents` SET `total_amount` = round(`total_amount`, 2) WHERE round(`total_amount`, 2) != `total_amount`;--> statement-breakpoint
INSERT INTO `__new_fiscal_documents`("id", "tenant_id", "source", "source_id", "kind", "resolution_id", "consecutive", "document_number", "cufe", "status", "customer_id", "buyer_tax_id", "buyer_tax_id_type_code", "buyer_name", "buyer_email", "buyer_address", "buyer_city", "buyer_department", "buyer_country", "subtotal", "tax_amount", "discount_amount", "total_amount", "currency_code", "locale_code", "original_cufe", "reason_code", "provider_id", "provider_response", "xml_ref", "retries", "emitted_by_user_id", "emitted_at", "updated_at") SELECT "id", "tenant_id", "source", "source_id", "kind", "resolution_id", "consecutive", "document_number", "cufe", "status", "customer_id", "buyer_tax_id", "buyer_tax_id_type_code", "buyer_name", "buyer_email", "buyer_address", "buyer_city", "buyer_department", "buyer_country", "subtotal", "tax_amount", "discount_amount", "total_amount", "currency_code", "locale_code", "original_cufe", "reason_code", "provider_id", "provider_response", "xml_ref", "retries", "emitted_by_user_id", "emitted_at", "updated_at" FROM `fiscal_documents`;--> statement-breakpoint
DROP TABLE `fiscal_documents`;--> statement-breakpoint
ALTER TABLE `__new_fiscal_documents` RENAME TO `fiscal_documents`;--> statement-breakpoint
CREATE INDEX `idx_fiscal_documents_tenant` ON `fiscal_documents` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_documents_source` ON `fiscal_documents` (`source`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_documents_cufe` ON `fiscal_documents` (`cufe`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_documents_tenant_doc` ON `fiscal_documents` (`tenant_id`,`document_number`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_documents_status` ON `fiscal_documents` (`status`);--> statement-breakpoint
CREATE TABLE `__new_fiscal_document_items` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_document_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`product_id` text,
	`product_name` text NOT NULL,
	`product_sku` text,
	`unit_measure_code` text DEFAULT 'EA' NOT NULL,
	`quantity` real NOT NULL,
	`unit_price` real NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`tax_category_code` text DEFAULT '01' NOT NULL,
	`line_total` real NOT NULL,
	FOREIGN KEY (`fiscal_document_id`) REFERENCES `fiscal_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_fiscal_document_items_unit_price_nonneg" CHECK("__new_fiscal_document_items"."unit_price" >= 0),
	CONSTRAINT "chk_fiscal_document_items_unit_price_2dec" CHECK(round("__new_fiscal_document_items"."unit_price", 2) = "__new_fiscal_document_items"."unit_price"),
	CONSTRAINT "chk_fiscal_document_items_discount_nonneg" CHECK("__new_fiscal_document_items"."discount_amount" >= 0),
	CONSTRAINT "chk_fiscal_document_items_discount_2dec" CHECK(round("__new_fiscal_document_items"."discount_amount", 2) = "__new_fiscal_document_items"."discount_amount"),
	CONSTRAINT "chk_fiscal_document_items_tax_nonneg" CHECK("__new_fiscal_document_items"."tax_amount" >= 0),
	CONSTRAINT "chk_fiscal_document_items_tax_2dec" CHECK(round("__new_fiscal_document_items"."tax_amount", 2) = "__new_fiscal_document_items"."tax_amount"),
	CONSTRAINT "chk_fiscal_document_items_total_nonneg" CHECK("__new_fiscal_document_items"."line_total" >= 0),
	CONSTRAINT "chk_fiscal_document_items_total_2dec" CHECK(round("__new_fiscal_document_items"."line_total", 2) = "__new_fiscal_document_items"."line_total")
);
--> statement-breakpoint
UPDATE `fiscal_document_items` SET `unit_price` = round(`unit_price`, 2) WHERE round(`unit_price`, 2) != `unit_price`;--> statement-breakpoint
UPDATE `fiscal_document_items` SET `discount_amount` = round(`discount_amount`, 2) WHERE round(`discount_amount`, 2) != `discount_amount`;--> statement-breakpoint
UPDATE `fiscal_document_items` SET `tax_amount` = round(`tax_amount`, 2) WHERE round(`tax_amount`, 2) != `tax_amount`;--> statement-breakpoint
UPDATE `fiscal_document_items` SET `line_total` = round(`line_total`, 2) WHERE round(`line_total`, 2) != `line_total`;--> statement-breakpoint
INSERT INTO `__new_fiscal_document_items`("id", "fiscal_document_id", "line_number", "product_id", "product_name", "product_sku", "unit_measure_code", "quantity", "unit_price", "discount_amount", "tax_rate", "tax_amount", "tax_category_code", "line_total") SELECT "id", "fiscal_document_id", "line_number", "product_id", "product_name", "product_sku", "unit_measure_code", "quantity", "unit_price", "discount_amount", "tax_rate", "tax_amount", "tax_category_code", "line_total" FROM `fiscal_document_items`;--> statement-breakpoint
DROP TABLE `fiscal_document_items`;--> statement-breakpoint
ALTER TABLE `__new_fiscal_document_items` RENAME TO `fiscal_document_items`;--> statement-breakpoint
CREATE INDEX `idx_fiscal_document_items_doc` ON `fiscal_document_items` (`fiscal_document_id`);--> statement-breakpoint
CREATE TABLE `__new_payment_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_payment_id` text,
	`rail_id` text NOT NULL,
	`kind` text DEFAULT 'charge' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`amount` real NOT NULL,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`reference` text NOT NULL,
	`provider_transaction_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`priority` real DEFAULT 0 NOT NULL,
	`claim_token` text,
	`locked_at` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_payment_id`) REFERENCES `sale_payments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_payment_outbox_amount_nonneg" CHECK("__new_payment_outbox"."amount" >= 0),
	CONSTRAINT "chk_payment_outbox_amount_2dec" CHECK(round("__new_payment_outbox"."amount", 2) = "__new_payment_outbox"."amount")
);
--> statement-breakpoint
UPDATE `payment_outbox` SET `amount` = round(`amount`, 2) WHERE round(`amount`, 2) != `amount`;--> statement-breakpoint
INSERT INTO `__new_payment_outbox`("id", "tenant_id", "sale_payment_id", "rail_id", "kind", "status", "amount", "currency_code", "reference", "provider_transaction_id", "payload", "payload_version", "attempts", "next_retry_at", "last_error", "priority", "claim_token", "locked_at", "idempotency_key", "created_at", "updated_at") SELECT "id", "tenant_id", "sale_payment_id", "rail_id", "kind", "status", "amount", "currency_code", "reference", "provider_transaction_id", "payload", "payload_version", "attempts", "next_retry_at", "last_error", "priority", "claim_token", "locked_at", "idempotency_key", "created_at", "updated_at" FROM `payment_outbox`;--> statement-breakpoint
DROP TABLE `payment_outbox`;--> statement-breakpoint
ALTER TABLE `__new_payment_outbox` RENAME TO `payment_outbox`;--> statement-breakpoint
CREATE INDEX `idx_payment_outbox_tenant_status_retry` ON `payment_outbox` (`tenant_id`,`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_payment_outbox_tenant_created` ON `payment_outbox` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payment_outbox_sale_payment` ON `payment_outbox` (`sale_payment_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_outbox_rail_status` ON `payment_outbox` (`tenant_id`,`rail_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_outbox_idempotent` ON `payment_outbox` (`tenant_id`,`rail_id`,`kind`,`idempotency_key`) WHERE `idempotency_key` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=ON;
