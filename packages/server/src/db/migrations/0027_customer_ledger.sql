-- ENG-089 — customer_ledger_entries: signed-delta receivable ledger
-- per (tenant, customer). Phase 5 extension promoted to active
-- backlog. ENG-090 will start writing sale rows from the credit
-- payment flow; ENG-NNN UI lands a customer detail panel that
-- consumes the listing + computed balance.
--
-- IF NOT EXISTS keeps the statement idempotent against the ENG-002
-- adoption shim so a DB that already carries the table does not
-- reject the migration.

CREATE TABLE IF NOT EXISTS `customer_ledger_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `customer_id` text NOT NULL REFERENCES `customers`(`id`),
  `occurred_at` text NOT NULL DEFAULT (datetime('now')),
  `kind` text NOT NULL,
  `amount` real NOT NULL,
  `reference_sale_id` text REFERENCES `sales`(`id`),
  `note` text,
  `created_by` text REFERENCES `users`(`id`),
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_customer_ledger_tenant_customer_occurred`
  ON `customer_ledger_entries` (`tenant_id`, `customer_id`, `occurred_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_customer_ledger_tenant_kind`
  ON `customer_ledger_entries` (`tenant_id`, `kind`);
