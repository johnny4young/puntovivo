CREATE TABLE `provider_payable_invoice_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `provider_payable_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_provider_payable_invoice_purchases_tenant` ON `provider_payable_invoice_purchases` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_provider_payable_invoice_purchases_invoice` ON `provider_payable_invoice_purchases` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_payable_invoice_purchases_purchase` ON `provider_payable_invoice_purchases` (`tenant_id`,`purchase_id`);--> statement-breakpoint
-- Backfill the bridge from every legacy single-purchase invoice so the bridge
-- becomes the complete source of truth from this migration onward.
INSERT INTO `provider_payable_invoice_purchases` (`id`, `tenant_id`, `invoice_id`, `purchase_id`, `created_at`)
SELECT lower(hex(randomblob(21))), `tenant_id`, `id`, `purchase_id`, `created_at`
FROM `provider_payable_invoices`
WHERE `purchase_id` IS NOT NULL;
