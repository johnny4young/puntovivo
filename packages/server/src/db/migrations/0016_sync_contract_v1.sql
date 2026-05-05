-- ENG-064 — Sync contract v1.
--
-- Closes ADR-0003's promise of five purpose-specific outboxes. This
-- migration creates `sync_outbox` mirroring the kernel projection
-- already in use by `fiscal_outbox` (ENG-057) and `hardware_outbox`
-- (ENG-062) AND adds the per-entity contract columns ADR-0002 +
-- ADR-0004 lock in:
--
--   - entity_type / entity_id / operation        — the row identity
--   - payload_version                            — schema-drift guard
--   - idempotency_key + device_id                — command envelope link
--   - depends_on_operation_id                    — topological ordering hint
--   - conflict_policy                            — per ADR-0004 routing
--   - operation_event_id                         — operation_journal trail
--
-- Status enum: queued -> submitting -> synced | conflict
--                                  \-> retrying -> dead_letter
--
-- The legacy `sync_queue` table stays in place as a deprecated
-- read-only backstop. A one-shot data migration at the bottom of
-- this file copies its pending rows into `sync_outbox` so the
-- consumer doesn't lose work in flight. A follow-up ticket drops
-- `sync_queue` after a release cycle confirms no writer regressed.
--
-- Per-entity conflict_policy assignments come from the manifest at
-- `services/sync/contract.ts`, exhaustively keyed against the
-- ADR-0004 manual / auto_lww lists. Until the writer rewrite lands
-- in the same commit, we default migrated rows to `auto_lww` —
-- catalog and catalog-like rows are the bulk of any pending queue.
-- High-risk legacy rows (sales, cash, fiscal, inventory) get
-- explicitly retagged inline so the consumer respects ADR-0004.

CREATE TABLE IF NOT EXISTS `sync_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `status` text NOT NULL DEFAULT 'queued',
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `operation` text NOT NULL,
  `conflict_policy` text NOT NULL DEFAULT 'auto_lww',
  `payload` text NOT NULL,
  `payload_version` integer NOT NULL DEFAULT 1,
  `idempotency_key` text,
  `device_id` text REFERENCES `devices`(`id`) ON DELETE SET NULL,
  `depends_on_operation_id` text,
  `operation_event_id` text REFERENCES `operation_events`(`id`) ON DELETE SET NULL,
  `attempts` integer NOT NULL DEFAULT 0,
  `next_retry_at` text,
  `last_error` text,
  `priority` real NOT NULL DEFAULT 0,
  `claim_token` text,
  `locked_at` text,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sync_outbox_tenant_status_retry`
  ON `sync_outbox` (`tenant_id`, `status`, `next_retry_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sync_outbox_entity`
  ON `sync_outbox` (`entity_type`, `entity_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sync_outbox_tenant_created`
  ON `sync_outbox` (`tenant_id`, `created_at`);
--> statement-breakpoint
-- Coalesce duplicates at the queue layer when an idempotency_key
-- is present. Two enqueues for the same (tenant, entity_type,
-- entity_id, operation, idempotency_key) collapse to one row;
-- catalog writes without an idempotency_key are not deduped here
-- because they're idempotent on the consumer side anyway.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sync_outbox_idempotent`
  ON `sync_outbox` (`tenant_id`, `entity_type`, `entity_id`, `operation`, `idempotency_key`)
  WHERE `idempotency_key` IS NOT NULL;
--> statement-breakpoint
-- One-shot data migration: copy any pending sync_queue rows that
-- predate ENG-064 into the new outbox. Defaults: payload_version=1,
-- priority=0, conflict_policy='auto_lww'. The writer rewrite lands
-- in the same commit so future enqueues populate the contract
-- correctly; this migration only catches rows in flight at upgrade
-- time.
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
      'inventory_movements', 'inventory_balances',
      'transfer_orders', 'transfer_order_items', 'stock_adjustments',
      'audit_logs'
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
