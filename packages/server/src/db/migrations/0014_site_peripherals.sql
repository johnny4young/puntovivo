-- ENG-060 — Peripheral registry + hardware ports.
--
-- Per-site physical / virtual peripheral configuration. Each row
-- declares a `(kind, driver)` pair plus driver-specific JSON config.
-- The registry at `services/peripherals/registry.ts` resolves the
-- active row by `(tenant_id, site_id, kind)` and dispatches to the
-- appropriate adapter via `driver`.
--
-- ENG-060 ships two default drivers: `system` (printer, wraps the
-- existing webContents.print() IPC path with no behavior change) and
-- `manual` (payment terminal, formalizes today's "cashier types the
-- auth code" path). ENG-061 (scanner pipeline), ENG-062 (ESC/POS +
-- cash drawer), and the gated ENG-063 (Bold/Wompi/MercadoPago) add
-- new drivers without touching this table.
--
-- See `docs/HARDWARE-POS.md §Peripheral configuration schema` for the
-- full design spec. The partial unique enforces "at most one active
-- peripheral per kind per site"; toggling is_active=0 on the previous
-- row is the migration path when an operator swaps drivers.

CREATE TABLE IF NOT EXISTS `site_peripherals` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `site_id` text NOT NULL REFERENCES `sites`(`id`),
  `kind` text NOT NULL,
  `driver` text NOT NULL,
  `config_json` text NOT NULL DEFAULT '{}',
  `display_name` text,
  `is_active` integer NOT NULL DEFAULT 1,
  `last_tested_at` text,
  `last_test_result` text,
  `last_test_details` text,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_site_peripherals_tenant_site_kind`
  ON `site_peripherals` (`tenant_id`, `site_id`, `kind`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_site_peripherals_tenant_kind`
  ON `site_peripherals` (`tenant_id`, `kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_site_peripherals_active_per_kind`
  ON `site_peripherals` (`tenant_id`, `site_id`, `kind`)
  WHERE `is_active` = 1;
