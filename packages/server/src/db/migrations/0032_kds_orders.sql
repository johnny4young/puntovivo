-- ENG-098 — kds_orders: kitchen display queue.
--
-- One row per (sale, station) pair, snapshotted from sales +
-- sale_items at suspend / complete time. `items_json` lets the
-- board read render without joining live sale state, and the
-- snapshot is rewritten by `refreshKdsOrderItems` whenever a
-- split or table change moves the source-of-truth rows around.
--
-- UNIQUE(tenant_id, sale_id, station) is the idempotency anchor
-- for `enqueueKdsOrder` — both `sales.suspend` and `completeSale`
-- post-tx hooks can fire, and only the first one creates a row.
-- The clause is portable so the ENG-002 migration shim does not
-- need a partial WHERE.
--
-- IF NOT EXISTS keeps the statement idempotent against DBs that
-- already received the table through the adoption shim.

CREATE TABLE IF NOT EXISTS `kds_orders` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `site_id` text NOT NULL REFERENCES `sites`(`id`),
  `sale_id` text NOT NULL REFERENCES `sales`(`id`) ON DELETE CASCADE,
  `table_id` text REFERENCES `restaurant_tables`(`id`),
  `table_label` text,
  `sale_number` text NOT NULL,
  `station` text NOT NULL DEFAULT 'main',
  `items_json` text NOT NULL,
  `notes` text,
  `status` text NOT NULL DEFAULT 'pending',
  `created_at` text NOT NULL,
  `ready_at` text,
  `ready_by_user_id` text REFERENCES `users`(`id`),
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_kds_orders_unique_sale_station`
  ON `kds_orders` (`tenant_id`, `sale_id`, `station`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_kds_orders_tenant_site_status`
  ON `kds_orders` (`tenant_id`, `site_id`, `status`);
