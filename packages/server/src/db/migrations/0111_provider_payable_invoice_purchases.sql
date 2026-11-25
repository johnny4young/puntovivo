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
-- Backfill the bridge from every legacy single-purchase invoice so the bridge
-- becomes the complete source of truth from this migration onward.
--
-- The id must be a function of the link itself, never of the machine that ran
-- the migration: two devices applying this against the same invoice would
-- otherwise mint two identities for one commercial fact and, once synced,
-- duplicate the link. Concatenating the invoice and purchase ids (the same
-- `prefix:left:right` shape the 0052/0059 legacy backfills use) makes every
-- replica derive byte-identical rows. Both ids on this table are app-generated
-- nanoid values (A-Z a-z 0-9 _ -), so ':' cannot appear inside one and two
-- distinct pairs cannot collapse into the same identity.
INSERT INTO `provider_payable_invoice_purchases` (`id`, `tenant_id`, `invoice_id`, `purchase_id`, `sync_status`, `sync_version`, `created_at`)
SELECT 'legacy-payable-link:' || `id` || ':' || `purchase_id`, `tenant_id`, `id`, `purchase_id`, 'pending', 1, `created_at`
FROM `provider_payable_invoices`
WHERE `purchase_id` IS NOT NULL;
