PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sale_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` real NOT NULL,
	`reference` text,
	`loyalty_points` integer,
	`confirmation_status` text,
	`confirmation_source` text,
	`confirmed_by` text,
	`confirmed_at` text,
	`destination_snapshot` text,
	`transfer_destination_id` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_payments_confirmation_transfer_only" CHECK(("__new_sale_payments"."method" = 'transfer') OR ("__new_sale_payments"."confirmation_status" IS NULL)),
	CONSTRAINT "chk_sale_payments_amount_2dec" CHECK(round("__new_sale_payments"."amount", 2) = "__new_sale_payments"."amount"),
	CONSTRAINT "chk_sale_payments_loyalty_points" CHECK(("__new_sale_payments"."method" = 'loyalty' AND "__new_sale_payments"."loyalty_points" IS NOT NULL AND "__new_sale_payments"."loyalty_points" > 0) OR ("__new_sale_payments"."method" <> 'loyalty' AND "__new_sale_payments"."loyalty_points" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_sale_payments`("id", "tenant_id", "sale_id", "method", "amount", "reference", "loyalty_points", "confirmation_status", "confirmation_source", "confirmed_by", "confirmed_at", "destination_snapshot", "transfer_destination_id", "sync_status", "sync_version", "created_at") SELECT "id", "tenant_id", "sale_id", "method", "amount", "reference", "loyalty_points", NULL, NULL, NULL, NULL, NULL, NULL, "sync_status", "sync_version", "created_at" FROM `sale_payments`;--> statement-breakpoint
DROP TABLE `sale_payments`;--> statement-breakpoint
ALTER TABLE `__new_sale_payments` RENAME TO `sale_payments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sale_payments_tenant` ON `sale_payments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_payments_sale` ON `sale_payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_payments_method` ON `sale_payments` (`method`);--> statement-breakpoint
CREATE INDEX `idx_sale_payments_transfer_destination` ON `sale_payments` (`tenant_id`,`transfer_destination_id`);