CREATE TABLE `sale_exchanges` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_id` text NOT NULL,
	`replacement_sale_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`replacement_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sale_exchanges_tenant` ON `sale_exchanges` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_exchanges_return` ON `sale_exchanges` (`sale_return_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_exchanges_replacement` ON `sale_exchanges` (`replacement_sale_id`);--> statement-breakpoint
CREATE TABLE `sale_return_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_item_id` text NOT NULL,
	`sale_item_lot_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_item_id`) REFERENCES `sale_return_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_lot_id`) REFERENCES `sale_item_lots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_return_lots_quantity_positive" CHECK("sale_return_item_lots"."quantity" > 0),
	CONSTRAINT "chk_sale_return_lots_cost_nonneg" CHECK("sale_return_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_sale_return_lots_cost_2dec" CHECK(round("sale_return_item_lots"."unit_cost", 2) = "sale_return_item_lots"."unit_cost")
);
--> statement-breakpoint
CREATE INDEX `idx_sale_return_lots_tenant_line` ON `sale_return_item_lots` (`tenant_id`,`sale_return_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_return_lots_original` ON `sale_return_item_lots` (`sale_item_lot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_lots_line_original` ON `sale_return_item_lots` (`sale_return_item_id`,`sale_item_lot_id`);--> statement-breakpoint
CREATE TABLE `sale_return_item_serials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_item_id` text NOT NULL,
	`sale_item_serial_id` text NOT NULL,
	`product_serial_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_item_id`) REFERENCES `sale_return_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_serial_id`) REFERENCES `sale_item_serials`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_serial_id`) REFERENCES `product_serials`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_sale_return_serials_tenant_line` ON `sale_return_item_serials` (`tenant_id`,`sale_return_item_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_return_serials_original` ON `sale_return_item_serials` (`sale_item_serial_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_serials_once` ON `sale_return_item_serials` (`sale_item_serial_id`);--> statement-breakpoint
CREATE TABLE `sale_return_item_tax_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_item_id` text NOT NULL,
	`component_key` text NOT NULL,
	`vat_rate_id` text,
	`tax_kind` text NOT NULL,
	`tax_rate` real NOT NULL,
	`taxable_amount` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_item_id`) REFERENCES `sale_return_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vat_rate_id`) REFERENCES `vat_rates`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_return_tax_position" CHECK("sale_return_item_tax_components"."position" between 0 and 3),
	CONSTRAINT "chk_sale_return_tax_rate" CHECK("sale_return_item_tax_components"."tax_rate" >= 0 and "sale_return_item_tax_components"."tax_rate" <= 100),
	CONSTRAINT "chk_sale_return_tax_base_nonneg" CHECK("sale_return_item_tax_components"."taxable_amount" >= 0),
	CONSTRAINT "chk_sale_return_tax_base_2dec" CHECK(round("sale_return_item_tax_components"."taxable_amount", 2) = "sale_return_item_tax_components"."taxable_amount"),
	CONSTRAINT "chk_sale_return_tax_amount_nonneg" CHECK("sale_return_item_tax_components"."tax_amount" >= 0),
	CONSTRAINT "chk_sale_return_tax_amount_2dec" CHECK(round("sale_return_item_tax_components"."tax_amount", 2) = "sale_return_item_tax_components"."tax_amount")
);
--> statement-breakpoint
CREATE INDEX `idx_sale_return_tax_tenant_line` ON `sale_return_item_tax_components` (`tenant_id`,`sale_return_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_tax_key` ON `sale_return_item_tax_components` (`sale_return_item_id`,`component_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_tax_position` ON `sale_return_item_tax_components` (`sale_return_item_id`,`position`);--> statement-breakpoint
CREATE TABLE `sale_return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name_snapshot` text NOT NULL,
	`product_sku_snapshot` text NOT NULL,
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
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_return_items_quantity_positive" CHECK("sale_return_items"."quantity" > 0),
	CONSTRAINT "chk_sale_return_items_base_quantity_positive" CHECK("sale_return_items"."base_quantity" > 0),
	CONSTRAINT "chk_sale_return_items_equivalence_positive" CHECK("sale_return_items"."unit_equivalence" > 0),
	CONSTRAINT "chk_sale_return_items_price_nonneg" CHECK("sale_return_items"."unit_price" >= 0),
	CONSTRAINT "chk_sale_return_items_price_2dec" CHECK(round("sale_return_items"."unit_price", 2) = "sale_return_items"."unit_price"),
	CONSTRAINT "chk_sale_return_items_subtotal_nonneg" CHECK("sale_return_items"."subtotal" >= 0),
	CONSTRAINT "chk_sale_return_items_subtotal_2dec" CHECK(round("sale_return_items"."subtotal", 2) = "sale_return_items"."subtotal"),
	CONSTRAINT "chk_sale_return_items_discount_nonneg" CHECK("sale_return_items"."discount_amount" >= 0),
	CONSTRAINT "chk_sale_return_items_discount_2dec" CHECK(round("sale_return_items"."discount_amount", 2) = "sale_return_items"."discount_amount"),
	CONSTRAINT "chk_sale_return_items_tax_nonneg" CHECK("sale_return_items"."tax_amount" >= 0),
	CONSTRAINT "chk_sale_return_items_tax_2dec" CHECK(round("sale_return_items"."tax_amount", 2) = "sale_return_items"."tax_amount"),
	CONSTRAINT "chk_sale_return_items_total_nonneg" CHECK("sale_return_items"."total" >= 0),
	CONSTRAINT "chk_sale_return_items_total_2dec" CHECK(round("sale_return_items"."total", 2) = "sale_return_items"."total"),
	CONSTRAINT "chk_sale_return_items_cost_nonneg" CHECK("sale_return_items"."cost_amount" >= 0),
	CONSTRAINT "chk_sale_return_items_cost_2dec" CHECK(round("sale_return_items"."cost_amount", 2) = "sale_return_items"."cost_amount")
);
--> statement-breakpoint
CREATE INDEX `idx_sale_return_items_tenant_return` ON `sale_return_items` (`tenant_id`,`sale_return_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_return_items_sale_item` ON `sale_return_items` (`sale_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_items_return_line` ON `sale_return_items` (`sale_return_id`,`sale_item_id`);--> statement-breakpoint
CREATE TABLE `sale_return_payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_id` text NOT NULL,
	`sale_payment_id` text,
	`original_method` text NOT NULL,
	`destination` text NOT NULL,
	`amount` real NOT NULL,
	`external_reference` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_payment_id`) REFERENCES `sale_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_return_allocations_amount_nonneg" CHECK("sale_return_payment_allocations"."amount" >= 0),
	CONSTRAINT "chk_sale_return_allocations_amount_2dec" CHECK(round("sale_return_payment_allocations"."amount", 2) = "sale_return_payment_allocations"."amount")
);
--> statement-breakpoint
CREATE INDEX `idx_sale_return_allocations_tenant_return` ON `sale_return_payment_allocations` (`tenant_id`,`sale_return_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_return_allocations_payment` ON `sale_return_payment_allocations` (`sale_payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_allocations_return_payment` ON `sale_return_payment_allocations` (`sale_return_id`,`sale_payment_id`);--> statement-breakpoint
CREATE TABLE `store_credit_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`balance` real DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_store_credit_accounts_balance_nonneg" CHECK("store_credit_accounts"."balance" >= 0),
	CONSTRAINT "chk_store_credit_accounts_balance_2dec" CHECK(round("store_credit_accounts"."balance", 2) = "store_credit_accounts"."balance")
);
--> statement-breakpoint
CREATE INDEX `idx_store_credit_accounts_tenant_customer` ON `store_credit_accounts` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_store_credit_accounts_currency` ON `store_credit_accounts` (`tenant_id`,`customer_id`,`currency_code`);--> statement-breakpoint
CREATE TABLE `store_credit_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`sale_return_id` text,
	`sale_id` text,
	`kind` text NOT NULL,
	`amount` real NOT NULL,
	`balance_after` real NOT NULL,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `store_credit_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_store_credit_movements_amount_2dec" CHECK(round("store_credit_movements"."amount", 2) = "store_credit_movements"."amount"),
	CONSTRAINT "chk_store_credit_movements_balance_nonneg" CHECK("store_credit_movements"."balance_after" >= 0),
	CONSTRAINT "chk_store_credit_movements_balance_2dec" CHECK(round("store_credit_movements"."balance_after", 2) = "store_credit_movements"."balance_after")
);
--> statement-breakpoint
CREATE INDEX `idx_store_credit_movements_tenant_account` ON `store_credit_movements` (`tenant_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `idx_store_credit_movements_customer` ON `store_credit_movements` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_store_credit_movements_return_issue` ON `store_credit_movements` (`tenant_id`,`sale_return_id`) WHERE "store_credit_movements"."kind" = 'issue' and "store_credit_movements"."sale_return_id" is not null;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sale_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`destination` text DEFAULT 'original' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tip_amount` real DEFAULT 0 NOT NULL,
	`service_charge_amount` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`refund_amount` real DEFAULT 0 NOT NULL,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`reason` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_returns_subtotal_nonneg" CHECK("__new_sale_returns"."subtotal" >= 0),
	CONSTRAINT "chk_sale_returns_subtotal_2dec" CHECK(round("__new_sale_returns"."subtotal", 2) = "__new_sale_returns"."subtotal"),
	CONSTRAINT "chk_sale_returns_tip_nonneg" CHECK("__new_sale_returns"."tip_amount" >= 0),
	CONSTRAINT "chk_sale_returns_tip_2dec" CHECK(round("__new_sale_returns"."tip_amount", 2) = "__new_sale_returns"."tip_amount"),
	CONSTRAINT "chk_sale_returns_service_charge_nonneg" CHECK("__new_sale_returns"."service_charge_amount" >= 0),
	CONSTRAINT "chk_sale_returns_service_charge_2dec" CHECK(round("__new_sale_returns"."service_charge_amount", 2) = "__new_sale_returns"."service_charge_amount"),
	CONSTRAINT "chk_sale_returns_discount_nonneg" CHECK("__new_sale_returns"."discount_amount" >= 0),
	CONSTRAINT "chk_sale_returns_discount_2dec" CHECK(round("__new_sale_returns"."discount_amount", 2) = "__new_sale_returns"."discount_amount"),
	CONSTRAINT "chk_sale_returns_tax_nonneg" CHECK("__new_sale_returns"."tax_amount" >= 0),
	CONSTRAINT "chk_sale_returns_tax_2dec" CHECK(round("__new_sale_returns"."tax_amount", 2) = "__new_sale_returns"."tax_amount"),
	CONSTRAINT "chk_sale_returns_refund_nonneg" CHECK("__new_sale_returns"."refund_amount" >= 0),
	CONSTRAINT "chk_sale_returns_refund_2dec" CHECK(round("__new_sale_returns"."refund_amount", 2) = "__new_sale_returns"."refund_amount")
);
--> statement-breakpoint
INSERT INTO `__new_sale_returns`("id", "tenant_id", "sale_id", "destination", "subtotal", "tip_amount", "service_charge_amount", "discount_amount", "tax_amount", "refund_amount", "currency_code", "reason", "created_by", "sync_status", "sync_version", "created_at", "updated_at")
SELECT r."id", r."tenant_id", r."sale_id", 'original', COALESCE(s."subtotal", r."refund_amount"), COALESCE(s."tip_amount", 0), COALESCE(s."service_charge_amount", 0), COALESCE(s."discount_amount", 0), COALESCE(s."tax_amount", 0), r."refund_amount", COALESCE(s."currency_code", 'COP'), r."reason", r."created_by", r."sync_status", r."sync_version", r."created_at", r."updated_at"
FROM `sale_returns` r
LEFT JOIN `sales` s ON s."id" = r."sale_id" AND s."tenant_id" = r."tenant_id";--> statement-breakpoint
DROP TABLE `sale_returns`;--> statement-breakpoint
ALTER TABLE `__new_sale_returns` RENAME TO `sale_returns`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sale_returns_tenant` ON `sale_returns` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_returns_sale` ON `sale_returns` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_returns_created_by` ON `sale_returns` (`created_by`);--> statement-breakpoint
ALTER TABLE `loyalty_movements` ADD `sale_return_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loyalty_movements_return_revert` ON `loyalty_movements` (`tenant_id`,`sale_return_id`) WHERE "loyalty_movements"."kind" = 'revert' and "loyalty_movements"."sale_return_id" is not null;--> statement-breakpoint
-- Before this migration a return was necessarily a single full-ticket return.
-- Freeze those historical lines now so every later reader can remain fail-closed
-- instead of reconstructing a refund from mutable catalog or sale state.
INSERT INTO `sale_return_items` (
	`id`, `tenant_id`, `sale_return_id`, `sale_item_id`, `product_id`,
	`product_name_snapshot`, `product_sku_snapshot`, `quantity`, `base_quantity`,
	`unit_price`, `unit_equivalence`, `unit_standard_code`, `discount_rate`,
	`tax_kind`, `tax_rate`, `subtotal`, `discount_amount`, `tax_amount`, `total`,
	`cost_amount`, `currency_code`, `created_at`
)
SELECT
	'legacy-return-item:' || r.`id` || ':' || si.`id`,
	r.`tenant_id`, r.`id`, si.`id`, si.`product_id`,
	COALESCE(si.`product_name_snapshot`, p.`name`),
	COALESCE(si.`product_sku_snapshot`, p.`sku`),
	si.`quantity`, si.`quantity` * si.`unit_equivalence`, si.`unit_price`,
	si.`unit_equivalence`, si.`unit_standard_code`, si.`discount`, si.`tax_kind`,
	si.`tax_rate`, round(si.`total` - si.`tax_amount`, 2),
	round(si.`unit_price` * si.`quantity` * si.`discount` / 100.0, 2),
	si.`tax_amount`, si.`total`,
	round(si.`cost_at_sale` * si.`quantity` * si.`unit_equivalence`, 2),
	si.`currency_code`, r.`created_at`
FROM `sale_returns` r
JOIN `sale_items` si ON si.`sale_id` = r.`sale_id`
JOIN `products` p ON p.`id` = si.`product_id` AND p.`tenant_id` = r.`tenant_id`;--> statement-breakpoint
INSERT INTO `sale_return_item_tax_components` (
	`id`, `tenant_id`, `sale_return_item_id`, `component_key`, `vat_rate_id`,
	`tax_kind`, `tax_rate`, `taxable_amount`, `tax_amount`, `position`, `created_at`
)
SELECT
	'legacy-return-tax:' || r.`id` || ':' || tc.`id`,
	r.`tenant_id`, ri.`id`, tc.`component_key`, tc.`vat_rate_id`, tc.`tax_kind`,
	tc.`tax_rate`, tc.`taxable_amount`, tc.`tax_amount`, tc.`position`, r.`created_at`
FROM `sale_returns` r
JOIN `sale_return_items` ri ON ri.`sale_return_id` = r.`id` AND ri.`tenant_id` = r.`tenant_id`
JOIN `sale_item_tax_components` tc ON tc.`sale_item_id` = ri.`sale_item_id` AND tc.`tenant_id` = r.`tenant_id`;--> statement-breakpoint
INSERT INTO `sale_return_item_tax_components` (
	`id`, `tenant_id`, `sale_return_item_id`, `component_key`, `vat_rate_id`,
	`tax_kind`, `tax_rate`, `taxable_amount`, `tax_amount`, `position`, `created_at`
)
SELECT
	'legacy-return-tax:' || r.`id` || ':' || ri.`sale_item_id`,
	r.`tenant_id`, ri.`id`,
	'legacy:' || ri.`tax_kind` || ':' || printf('%.6f', ri.`tax_rate`),
	NULL, ri.`tax_kind`, ri.`tax_rate`, ri.`subtotal`, ri.`tax_amount`, 0, r.`created_at`
FROM `sale_returns` r
JOIN `sale_return_items` ri ON ri.`sale_return_id` = r.`id` AND ri.`tenant_id` = r.`tenant_id`
WHERE NOT EXISTS (
	SELECT 1 FROM `sale_return_item_tax_components` rtc
	WHERE rtc.`sale_return_item_id` = ri.`id` AND rtc.`tenant_id` = r.`tenant_id`
);--> statement-breakpoint
INSERT INTO `sale_return_item_lots` (
	`id`, `tenant_id`, `sale_return_item_id`, `sale_item_lot_id`, `lot_id`,
	`quantity`, `unit_cost`, `created_at`
)
SELECT
	'legacy-return-lot:' || r.`id` || ':' || sil.`id`,
	r.`tenant_id`, ri.`id`, sil.`id`, sil.`lot_id`, sil.`quantity`, sil.`unit_cost`, r.`created_at`
FROM `sale_returns` r
JOIN `sale_return_items` ri ON ri.`sale_return_id` = r.`id` AND ri.`tenant_id` = r.`tenant_id`
JOIN `sale_item_lots` sil ON sil.`sale_item_id` = ri.`sale_item_id` AND sil.`tenant_id` = r.`tenant_id`;--> statement-breakpoint
INSERT INTO `sale_return_item_serials` (
	`id`, `tenant_id`, `sale_return_item_id`, `sale_item_serial_id`,
	`product_serial_id`, `serial_number`, `created_at`
)
SELECT
	'legacy-return-serial:' || r.`id` || ':' || sis.`id`,
	r.`tenant_id`, ri.`id`, sis.`id`, sis.`product_serial_id`, sis.`serial_number`, r.`created_at`
FROM `sale_returns` r
JOIN `sale_return_items` ri ON ri.`sale_return_id` = r.`id` AND ri.`tenant_id` = r.`tenant_id`
JOIN `sale_item_serials` sis ON sis.`sale_item_id` = ri.`sale_item_id` AND sis.`tenant_id` = r.`tenant_id`;--> statement-breakpoint
INSERT INTO `sale_return_payment_allocations` (
	`id`, `tenant_id`, `sale_return_id`, `sale_payment_id`, `original_method`,
	`destination`, `amount`, `external_reference`, `created_at`
)
SELECT
	'legacy-return-payment:' || r.`id` || ':' || sp.`id`,
	r.`tenant_id`, r.`id`, sp.`id`, sp.`method`,
	CASE WHEN sp.`method` = 'credit' THEN 'receivable'
	     WHEN sp.`method` = 'cash' THEN 'cash'
	     ELSE 'external' END,
	sp.`amount`, NULL, r.`created_at`
FROM `sale_returns` r
JOIN `sale_payments` sp ON sp.`sale_id` = r.`sale_id` AND sp.`tenant_id` = r.`tenant_id`;--> statement-breakpoint
INSERT INTO `sale_return_payment_allocations` (
	`id`, `tenant_id`, `sale_return_id`, `sale_payment_id`, `original_method`,
	`destination`, `amount`, `external_reference`, `created_at`
)
SELECT
	'legacy-return-payment:' || r.`id`, r.`tenant_id`, r.`id`, NULL,
	s.`payment_method`,
	CASE WHEN s.`payment_method` = 'credit' THEN 'receivable'
	     WHEN s.`payment_method` = 'cash' THEN 'cash'
	     ELSE 'external' END,
	r.`refund_amount`, NULL, r.`created_at`
FROM `sale_returns` r
JOIN `sales` s ON s.`id` = r.`sale_id` AND s.`tenant_id` = r.`tenant_id`
WHERE NOT EXISTS (
	SELECT 1 FROM `sale_payments` sp
	WHERE sp.`sale_id` = r.`sale_id` AND sp.`tenant_id` = r.`tenant_id`
);
