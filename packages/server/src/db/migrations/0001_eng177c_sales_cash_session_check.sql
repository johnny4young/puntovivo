PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	CONSTRAINT "chk_sales_exchange_rate_positive" CHECK("__new_sales"."exchange_rate_at_sale" > 0),
	CONSTRAINT "chk_sales_cash_session_or_draft" CHECK("__new_sales"."cash_session_id" IS NOT NULL OR "__new_sales"."status" = 'draft')
);
--> statement-breakpoint
INSERT INTO `__new_sales`("id", "tenant_id", "sale_number", "customer_id", "table_id", "subtotal", "tax_amount", "discount_amount", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "tip_amount", "tip_method", "service_charge_amount", "service_charge_rate", "payment_method", "payment_status", "status", "cash_session_id", "notes", "created_by", "suspended_at", "suspended_by", "suspended_label", "reprint_count", "last_reprinted_at", "last_reprinted_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "sale_number", "customer_id", "table_id", "subtotal", "tax_amount", "discount_amount", "total", "currency_code", "exchange_rate_at_sale", "settle_currency_code", "tip_amount", "tip_method", "service_charge_amount", "service_charge_rate", "payment_method", "payment_status", "status", "cash_session_id", "notes", "created_by", "suspended_at", "suspended_by", "suspended_label", "reprint_count", "last_reprinted_at", "last_reprinted_by", "sync_status", "sync_version", "created_at", "updated_at" FROM `sales`;--> statement-breakpoint
DROP TABLE `sales`;--> statement-breakpoint
ALTER TABLE `__new_sales` RENAME TO `sales`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sales_tenant` ON `sales` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_tenant_created` ON `sales` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sales_customer` ON `sales` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_cash_session` ON `sales` (`cash_session_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_created_by` ON `sales` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_sales_suspended_by` ON `sales` (`suspended_by`);--> statement-breakpoint
CREATE INDEX `idx_sales_tenant_table` ON `sales` (`tenant_id`,`table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_tenant_number` ON `sales` (`tenant_id`,`sale_number`);