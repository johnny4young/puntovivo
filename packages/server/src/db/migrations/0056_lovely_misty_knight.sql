CREATE TABLE `promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`discount_pct` real NOT NULL,
	`site_id` text,
	`product_id` text,
	`category_id` text,
	`customer_id` text,
	`min_quantity` real DEFAULT 1 NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`combinable` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_price_suggestion_id` text,
	`source_lot_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_promotions_discount" CHECK("promotions"."discount_pct" > 0 AND "promotions"."discount_pct" <= 100),
	CONSTRAINT "chk_promotions_min_quantity" CHECK("promotions"."min_quantity" > 0),
	CONSTRAINT "chk_promotions_target_kind" CHECK("promotions"."product_id" IS NULL OR "promotions"."category_id" IS NULL),
	CONSTRAINT "chk_promotions_window" CHECK("promotions"."starts_at" IS NULL OR "promotions"."ends_at" IS NULL OR "promotions"."starts_at" < "promotions"."ends_at"),
	CONSTRAINT "chk_promotions_version" CHECK("promotions"."version" > 0),
	CONSTRAINT "chk_promotions_expiry_source" CHECK("promotions"."source" <> 'expiry' OR ("promotions"."source_price_suggestion_id" IS NOT NULL AND "promotions"."source_lot_id" IS NOT NULL AND "promotions"."product_id" IS NOT NULL AND "promotions"."site_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_promotions_tenant_status_window` ON `promotions` (`tenant_id`,`status`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `idx_promotions_tenant_product` ON `promotions` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_promotions_tenant_category` ON `promotions` (`tenant_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `idx_promotions_tenant_customer` ON `promotions` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_promotions_expiry_suggestion` ON `promotions` (`tenant_id`,`source_price_suggestion_id`) WHERE "promotions"."source" = 'expiry' and "promotions"."source_price_suggestion_id" is not null;--> statement-breakpoint
CREATE TABLE `sale_item_promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`promotion_id` text NOT NULL,
	`promotion_version` integer NOT NULL,
	`name_snapshot` text NOT NULL,
	`discount_pct` real NOT NULL,
	`discount_amount` real NOT NULL,
	`priority` integer NOT NULL,
	`combinable` integer NOT NULL,
	`position` integer NOT NULL,
	`source` text NOT NULL,
	`source_lot_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_item_promotions_discount_pct" CHECK("sale_item_promotions"."discount_pct" > 0 AND "sale_item_promotions"."discount_pct" <= 100),
	CONSTRAINT "chk_sale_item_promotions_discount_amount" CHECK("sale_item_promotions"."discount_amount" >= 0 AND round("sale_item_promotions"."discount_amount", 2) = "sale_item_promotions"."discount_amount"),
	CONSTRAINT "chk_sale_item_promotions_position" CHECK("sale_item_promotions"."position" >= 0),
	CONSTRAINT "chk_sale_item_promotions_version" CHECK("sale_item_promotions"."promotion_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_sale_item_promotions_tenant_line` ON `sale_item_promotions` (`tenant_id`,`sale_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_item_promotions_line_position` ON `sale_item_promotions` (`sale_item_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_item_promotions_line_rule` ON `sale_item_promotions` (`sale_item_id`,`promotion_id`);--> statement-breakpoint
ALTER TABLE `loyalty_movements` ADD `sale_payment_id` text;--> statement-breakpoint
ALTER TABLE `loyalty_movements` ADD `source_movement_id` text;--> statement-breakpoint
ALTER TABLE `loyalty_movements` ADD `value_per_point` real;--> statement-breakpoint
ALTER TABLE `loyalty_movements` ADD `money_amount` real;--> statement-breakpoint
ALTER TABLE `loyalty_movements` ADD `currency_code` text;--> statement-breakpoint
ALTER TABLE `sale_payments` ADD `loyalty_points` integer;--> statement-breakpoint
ALTER TABLE `sale_return_payment_allocations` ADD `loyalty_points` integer;--> statement-breakpoint
ALTER TABLE `store_credit_movements` ADD `sale_payment_id` text;--> statement-breakpoint
ALTER TABLE `store_credit_movements` ADD `source_movement_id` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_loyalty_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text NOT NULL,
	`sale_id` text,
	`sale_return_id` text,
	`sale_payment_id` text,
	`source_movement_id` text,
	`kind` text NOT NULL,
	`points` integer NOT NULL,
	`rate_at_earn` real,
	`value_per_point` real,
	`money_amount` real,
	`currency_code` text,
	`note` text,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `loyalty_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_loyalty_movements_sign" CHECK(("__new_loyalty_movements"."kind" IN ('earn', 'restore') AND "__new_loyalty_movements"."points" > 0) OR ("__new_loyalty_movements"."kind" IN ('redeem', 'revert') AND "__new_loyalty_movements"."points" < 0) OR ("__new_loyalty_movements"."kind" = 'adjust' AND "__new_loyalty_movements"."points" <> 0)),
	CONSTRAINT "chk_loyalty_movements_redemption_snapshot" CHECK(("__new_loyalty_movements"."kind" IN ('redeem', 'restore') AND "__new_loyalty_movements"."value_per_point" IS NOT NULL AND "__new_loyalty_movements"."value_per_point" > 0 AND "__new_loyalty_movements"."money_amount" IS NOT NULL AND "__new_loyalty_movements"."money_amount" >= 0 AND "__new_loyalty_movements"."currency_code" IS NOT NULL) OR ("__new_loyalty_movements"."kind" NOT IN ('redeem', 'restore') AND "__new_loyalty_movements"."value_per_point" IS NULL AND "__new_loyalty_movements"."money_amount" IS NULL AND "__new_loyalty_movements"."currency_code" IS NULL)),
	CONSTRAINT "chk_loyalty_movements_value_per_point_nonneg" CHECK("__new_loyalty_movements"."value_per_point" >= 0),
	CONSTRAINT "chk_loyalty_movements_value_per_point_2dec" CHECK(round("__new_loyalty_movements"."value_per_point", 2) = "__new_loyalty_movements"."value_per_point"),
	CONSTRAINT "chk_loyalty_movements_money_amount_nonneg" CHECK("__new_loyalty_movements"."money_amount" >= 0),
	CONSTRAINT "chk_loyalty_movements_money_amount_2dec" CHECK(round("__new_loyalty_movements"."money_amount", 2) = "__new_loyalty_movements"."money_amount")
);
--> statement-breakpoint
INSERT INTO `__new_loyalty_movements`("id", "tenant_id", "account_id", "sale_id", "sale_return_id", "sale_payment_id", "source_movement_id", "kind", "points", "rate_at_earn", "value_per_point", "money_amount", "currency_code", "note", "created_by", "created_at") SELECT "id", "tenant_id", "account_id", "sale_id", "sale_return_id", "sale_payment_id", "source_movement_id", "kind", "points", "rate_at_earn", "value_per_point", "money_amount", "currency_code", "note", "created_by", "created_at" FROM `loyalty_movements`;--> statement-breakpoint
DROP TABLE `loyalty_movements`;--> statement-breakpoint
ALTER TABLE `__new_loyalty_movements` RENAME TO `loyalty_movements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_loyalty_movements_account` ON `loyalty_movements` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_loyalty_movements_tenant_sale` ON `loyalty_movements` (`tenant_id`,`sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loyalty_movements_sale_earn` ON `loyalty_movements` (`account_id`,`sale_id`) WHERE "loyalty_movements"."kind" = 'earn';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loyalty_movements_payment_redeem` ON `loyalty_movements` (`tenant_id`,`sale_payment_id`) WHERE "loyalty_movements"."kind" = 'redeem' and "loyalty_movements"."sale_payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loyalty_movements_return_source` ON `loyalty_movements` (`tenant_id`,`sale_return_id`,`source_movement_id`,`kind`) WHERE "loyalty_movements"."sale_return_id" is not null and "loyalty_movements"."source_movement_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loyalty_movements_void_source` ON `loyalty_movements` (`tenant_id`,`sale_id`,`source_movement_id`,`kind`) WHERE "loyalty_movements"."sale_return_id" is null and "loyalty_movements"."source_movement_id" is not null;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `manual_discount_rate` real;--> statement-breakpoint
CREATE TABLE `__new_sale_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` real NOT NULL,
	`reference` text,
	`loyalty_points` integer,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_sale_payments_amount_2dec" CHECK(round("__new_sale_payments"."amount", 2) = "__new_sale_payments"."amount"),
	CONSTRAINT "chk_sale_payments_loyalty_points" CHECK(("__new_sale_payments"."method" = 'loyalty' AND "__new_sale_payments"."loyalty_points" IS NOT NULL AND "__new_sale_payments"."loyalty_points" > 0) OR ("__new_sale_payments"."method" <> 'loyalty' AND "__new_sale_payments"."loyalty_points" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_sale_payments`("id", "tenant_id", "sale_id", "method", "amount", "reference", "loyalty_points", "sync_status", "sync_version", "created_at") SELECT "id", "tenant_id", "sale_id", "method", "amount", "reference", "loyalty_points", "sync_status", "sync_version", "created_at" FROM `sale_payments`;--> statement-breakpoint
DROP TABLE `sale_payments`;--> statement-breakpoint
ALTER TABLE `__new_sale_payments` RENAME TO `sale_payments`;--> statement-breakpoint
CREATE INDEX `idx_sale_payments_tenant` ON `sale_payments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_payments_sale` ON `sale_payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_payments_method` ON `sale_payments` (`method`);--> statement-breakpoint
CREATE TABLE `__new_sale_return_payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_return_id` text NOT NULL,
	`sale_payment_id` text,
	`original_method` text NOT NULL,
	`destination` text NOT NULL,
	`amount` real NOT NULL,
	`loyalty_points` integer,
	`external_reference` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_payment_id`) REFERENCES `sale_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_sale_return_allocations_amount_nonneg" CHECK("__new_sale_return_payment_allocations"."amount" >= 0),
	CONSTRAINT "chk_sale_return_allocations_amount_2dec" CHECK(round("__new_sale_return_payment_allocations"."amount", 2) = "__new_sale_return_payment_allocations"."amount"),
	CONSTRAINT "chk_sale_return_allocations_loyalty_points" CHECK(("__new_sale_return_payment_allocations"."destination" = 'loyalty' AND "__new_sale_return_payment_allocations"."loyalty_points" IS NOT NULL AND "__new_sale_return_payment_allocations"."loyalty_points" >= 0) OR ("__new_sale_return_payment_allocations"."destination" <> 'loyalty' AND "__new_sale_return_payment_allocations"."loyalty_points" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_sale_return_payment_allocations`("id", "tenant_id", "sale_return_id", "sale_payment_id", "original_method", "destination", "amount", "loyalty_points", "external_reference", "created_at") SELECT "id", "tenant_id", "sale_return_id", "sale_payment_id", "original_method", "destination", "amount", "loyalty_points", "external_reference", "created_at" FROM `sale_return_payment_allocations`;--> statement-breakpoint
DROP TABLE `sale_return_payment_allocations`;--> statement-breakpoint
ALTER TABLE `__new_sale_return_payment_allocations` RENAME TO `sale_return_payment_allocations`;--> statement-breakpoint
CREATE INDEX `idx_sale_return_allocations_tenant_return` ON `sale_return_payment_allocations` (`tenant_id`,`sale_return_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_return_allocations_payment` ON `sale_return_payment_allocations` (`sale_payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_return_allocations_return_payment` ON `sale_return_payment_allocations` (`sale_return_id`,`sale_payment_id`);--> statement-breakpoint
ALTER TABLE `price_suggestions` ADD `promotion_id` text;--> statement-breakpoint
CREATE TABLE `__new_store_credit_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`sale_return_id` text,
	`sale_id` text,
	`sale_payment_id` text,
	`source_movement_id` text,
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
	CONSTRAINT "chk_store_credit_movements_sign" CHECK(("__new_store_credit_movements"."kind" IN ('issue', 'revert') AND "__new_store_credit_movements"."amount" > 0) OR ("__new_store_credit_movements"."kind" = 'redeem' AND "__new_store_credit_movements"."amount" < 0) OR ("__new_store_credit_movements"."kind" = 'adjust' AND "__new_store_credit_movements"."amount" <> 0)),
	CONSTRAINT "chk_store_credit_movements_amount_2dec" CHECK(round("__new_store_credit_movements"."amount", 2) = "__new_store_credit_movements"."amount"),
	CONSTRAINT "chk_store_credit_movements_balance_nonneg" CHECK("__new_store_credit_movements"."balance_after" >= 0),
	CONSTRAINT "chk_store_credit_movements_balance_2dec" CHECK(round("__new_store_credit_movements"."balance_after", 2) = "__new_store_credit_movements"."balance_after")
);
--> statement-breakpoint
INSERT INTO `__new_store_credit_movements`("id", "tenant_id", "account_id", "customer_id", "sale_return_id", "sale_id", "sale_payment_id", "source_movement_id", "kind", "amount", "balance_after", "currency_code", "note", "created_by", "created_at") SELECT "id", "tenant_id", "account_id", "customer_id", "sale_return_id", "sale_id", "sale_payment_id", "source_movement_id", "kind", "amount", "balance_after", "currency_code", "note", "created_by", "created_at" FROM `store_credit_movements`;--> statement-breakpoint
DROP TABLE `store_credit_movements`;--> statement-breakpoint
ALTER TABLE `__new_store_credit_movements` RENAME TO `store_credit_movements`;--> statement-breakpoint
CREATE INDEX `idx_store_credit_movements_tenant_account` ON `store_credit_movements` (`tenant_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `idx_store_credit_movements_customer` ON `store_credit_movements` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_store_credit_movements_return_issue` ON `store_credit_movements` (`tenant_id`,`sale_return_id`) WHERE "store_credit_movements"."kind" = 'issue' and "store_credit_movements"."sale_return_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_store_credit_movements_payment_redeem` ON `store_credit_movements` (`tenant_id`,`sale_payment_id`) WHERE "store_credit_movements"."kind" = 'redeem' and "store_credit_movements"."sale_payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_store_credit_movements_return_source` ON `store_credit_movements` (`tenant_id`,`sale_return_id`,`source_movement_id`,`kind`) WHERE "store_credit_movements"."sale_return_id" is not null and "store_credit_movements"."source_movement_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_store_credit_movements_void_source` ON `store_credit_movements` (`tenant_id`,`sale_id`,`source_movement_id`,`kind`) WHERE "store_credit_movements"."sale_return_id" is null and "store_credit_movements"."source_movement_id" is not null;
