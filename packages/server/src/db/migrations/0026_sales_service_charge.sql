-- ENG-039d3 — restaurant service charge / propina sugerida columns on sales.
--
-- Sibling slice of ENG-039d (tip). Service charge is the MANDATORY twin of
-- the voluntary tip: a per-tenant percentage (`tenants.settings.restaurant.
-- serviceChargeRate`) that auto-applies to every checkout for restaurant
-- mode tenants. `service_charge_amount` is the resolved currency value
-- (typically `subtotal × rate / 100`) and rolls into `total` after tax
-- + tip so multi-tender Σ validation stays unchanged. `service_charge_rate`
-- records the percentage that was active when the sale was finalized so
-- reporting + audit can reconstruct it.
--
-- Existing rows backfill to (0, NULL): retail tenants who never configure
-- a restaurant rate pass through with zero impact.

ALTER TABLE `sales` ADD COLUMN `service_charge_amount` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `service_charge_rate` real;
