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
INSERT INTO `__new_sale_returns`("id", "tenant_id", "sale_id", "destination", "subtotal", "tip_amount", "service_charge_amount", "discount_amount", "tax_amount", "refund_amount", "currency_code", "reason", "created_by", "sync_status", "sync_version", "created_at", "updated_at") SELECT "id", "tenant_id", "sale_id", "destination", "subtotal", "tip_amount", "service_charge_amount", "discount_amount", "tax_amount", "refund_amount", "currency_code", "reason", "created_by", "sync_status", "sync_version", "created_at", "updated_at" FROM `sale_returns`;--> statement-breakpoint
DROP TABLE `sale_returns`;--> statement-breakpoint
ALTER TABLE `__new_sale_returns` RENAME TO `sale_returns`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sale_returns_tenant` ON `sale_returns` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_returns_sale` ON `sale_returns` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_returns_created_by` ON `sale_returns` (`created_by`);