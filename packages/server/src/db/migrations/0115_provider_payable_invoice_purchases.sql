CREATE TABLE `provider_payable_invoice_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `provider_payable_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_provider_payable_invoice_purchases_tenant` ON `provider_payable_invoice_purchases` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_provider_payable_invoice_purchases_invoice` ON `provider_payable_invoice_purchases` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_payable_invoice_purchases_purchase` ON `provider_payable_invoice_purchases` (`tenant_id`,`purchase_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_payable_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`site_id` text NOT NULL,
	`purchase_id` text,
	`kind` text NOT NULL,
	`document_number` text NOT NULL,
	`issued_at` text NOT NULL,
	`due_at` text NOT NULL,
	`amount` real NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_provider_payable_invoices_amount_positive" CHECK("__new_provider_payable_invoices"."amount" > 0),
	CONSTRAINT "chk_provider_payable_invoices_amount_2dec" CHECK(round("__new_provider_payable_invoices"."amount", 2) = "__new_provider_payable_invoices"."amount"),
	CONSTRAINT "chk_provider_payable_invoices_tax_nonneg" CHECK("__new_provider_payable_invoices"."tax_amount" >= 0),
	CONSTRAINT "chk_provider_payable_invoices_tax_2dec" CHECK(round("__new_provider_payable_invoices"."tax_amount", 2) = "__new_provider_payable_invoices"."tax_amount")
);
--> statement-breakpoint
INSERT INTO `__new_provider_payable_invoices`("id", "tenant_id", "provider_id", "site_id", "purchase_id", "kind", "document_number", "issued_at", "due_at", "amount", "notes", "created_by", "sync_status", "sync_version", "created_at") SELECT "id", "tenant_id", "provider_id", "site_id", "purchase_id", "kind", "document_number", "issued_at", "due_at", "amount", "notes", "created_by", "sync_status", "sync_version", "created_at" FROM `provider_payable_invoices`;--> statement-breakpoint
DROP TABLE `provider_payable_invoices`;--> statement-breakpoint
ALTER TABLE `__new_provider_payable_invoices` RENAME TO `provider_payable_invoices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_provider_payable_invoices_tenant_provider_due` ON `provider_payable_invoices` (`tenant_id`,`provider_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_provider_payable_invoices_purchase` ON `provider_payable_invoices` (`purchase_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_payable_invoices_provider_document` ON `provider_payable_invoices` (`tenant_id`,`provider_id`,`document_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_payable_invoices_purchase_unique` ON `provider_payable_invoices` (`tenant_id`,`purchase_id`) WHERE "provider_payable_invoices"."purchase_id" IS NOT NULL;--> statement-breakpoint
-- Backfill the bridge from legacy single-purchase invoices with deterministic
-- IDs so independent replicas derive byte-identical link rows.
INSERT OR IGNORE INTO `provider_payable_invoice_purchases` (`id`, `tenant_id`, `invoice_id`, `purchase_id`, `sync_status`, `sync_version`, `created_at`)
SELECT 'legacy-payable-link:' || `id` || ':' || `purchase_id`, `tenant_id`, `id`, `purchase_id`, 'pending', 1, `created_at`
FROM `provider_payable_invoices`
WHERE `purchase_id` IS NOT NULL;