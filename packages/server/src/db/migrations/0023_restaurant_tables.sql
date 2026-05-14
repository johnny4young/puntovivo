-- ENG-039b — restaurant_tables: per-site catalog of physical tables.
--
-- Foundation slice for the restaurant vertical (ENG-039 umbrella).
-- ENG-039a shipped a free-text suspendedLabel; this migration adds the
-- persistent catalog future slices (open/seat/transfer/split, KDS,
-- table-scoped permissions) read from. The dropdown on
-- VoiceOrderingScreen resolves the picked row's `name` into the
-- existing `sales.suspendedLabel` text column — no FK yet.
--
-- The partial-unique index on (tenant_id, site_id, name) WHERE
-- is_active = 1 is hand-appended below because Drizzle's SQLite
-- dialect cannot emit the WHERE clause. `IF NOT EXISTS` keeps the
-- statement idempotent under the ENG-002 migration shim so a DB that
-- already carries the index does not reject the migration.

CREATE TABLE IF NOT EXISTS `restaurant_tables` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `site_id` text NOT NULL REFERENCES `sites`(`id`),
  `name` text NOT NULL,
  `seat_count` integer,
  `area` text,
  `notes` text,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_restaurant_tables_tenant_site`
  ON `restaurant_tables` (`tenant_id`, `site_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_restaurant_tables_unique_active_name`
  ON `restaurant_tables` (`tenant_id`, `site_id`, `name`)
  WHERE `is_active` = 1;
