-- ENG-064b — drop the legacy `sync_queue` table.
--
-- The data migration in 0016_sync_contract_v1 backfilled the
-- pending rows that existed when ENG-064 applied. This migration
-- repeats that copy one final time before the drop so rows written
-- by the ENG-064 bridge build between 0016 and 0017 survive the
-- cutover. After this commit, writers route through `enqueueSync()`
-- and only write to `sync_outbox`.
--
-- If an adopted schema already removed `sync_queue`, create an
-- empty compatibility shell so the final SELECT is harmless and
-- the DROP remains idempotent. Fresh DBs still create the real
-- table in 0000 before 0016/0017 run.
CREATE TABLE IF NOT EXISTS `sync_queue` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `operation` text NOT NULL,
  `data` text,
  `local_version` integer,
  `attempts` integer,
  `last_error` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
INSERT OR IGNORE INTO `sync_outbox` (
  `id`,
  `tenant_id`,
  `status`,
  `entity_type`,
  `entity_id`,
  `operation`,
  `conflict_policy`,
  `payload`,
  `payload_version`,
  `attempts`,
  `last_error`,
  `priority`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `tenant_id`,
  'queued',
  `entity_type`,
  `entity_id`,
  `operation`,
  CASE
    WHEN `entity_type` IN (
      'sales', 'sale_items', 'sale_payments', 'sale_returns',
      'cash_sessions', 'cash_movements',
      'fiscal_documents', 'fiscal_document_items',
      'fiscal_numbering_resolutions', 'fiscal_certificates',
      'inventory_movements', 'inventory_balances', 'initial_inventory',
      'transfer_orders', 'transfer_order_items', 'stock_adjustments',
      'audit_logs',
      'orders', 'order_items',
      'purchases', 'purchase_returns', 'purchase_return_items'
    ) THEN 'manual'
    ELSE 'auto_lww'
  END,
  COALESCE(`data`, '{}'),
  COALESCE(`local_version`, 1),
  COALESCE(`attempts`, 0),
  `last_error`,
  0,
  `created_at`,
  `created_at`
FROM `sync_queue`
WHERE `id` NOT IN (SELECT `id` FROM `sync_outbox`);
--> statement-breakpoint
UPDATE `sync_outbox`
SET `conflict_policy` = 'manual'
WHERE `entity_type` IN (
  'sales', 'sale_items', 'sale_payments', 'sale_returns',
  'cash_sessions', 'cash_movements',
  'fiscal_documents', 'fiscal_document_items',
  'fiscal_numbering_resolutions', 'fiscal_certificates',
  'inventory_movements', 'inventory_balances', 'initial_inventory',
  'transfer_orders', 'transfer_order_items', 'stock_adjustments',
  'audit_logs',
  'orders', 'order_items',
  'purchases', 'purchase_returns', 'purchase_return_items'
);
--> statement-breakpoint
-- SQLite drops the table's auto-created indexes alongside it.
DROP TABLE IF EXISTS `sync_queue`;
