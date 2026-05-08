-- ENG-070 — webhook_outbox: 5th and final outbox per ADR-0003.
--
-- Sits next to sync_outbox / fiscal_outbox / hardware_outbox with the
-- kernel-projection shape (status / attempts / next_retry_at /
-- claim_token / locked_at). Carries one row per public event the
-- operation-journal projector translates from a successful critical
-- command (or that the fiscal worker emits when status flips to
-- 'accepted').
--
-- Status enum mirrors the other outboxes:
--   queued -> submitting -> delivered | failed | retrying -> dead_letter
-- ENG-070b drives the lifecycle when the HTTP delivery worker lands;
-- v1 only writes 'queued' rows.
--
-- Partial unique idx mirrors ENG-067b's hardware_outbox_idempotent
-- shape: when an `idempotency_key` is set (e.g. the operation_id from
-- the command envelope), a duplicate enqueue collapses to one row
-- instead of stacking. Rows without a key (the rare admin-triggered
-- replay path) stay independent.
--
-- All statements are `IF NOT EXISTS`-safe so the migration is
-- idempotent against DBs that already carry the target shape (the
-- ENG-002 adoption shim convention).

CREATE TABLE IF NOT EXISTS `webhook_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `event_type` text NOT NULL,
  `event_version` integer NOT NULL DEFAULT 1,
  `operation_event_id` text REFERENCES `operation_events`(`id`) ON DELETE SET NULL,
  `payload` text NOT NULL,
  `payload_version` integer NOT NULL DEFAULT 1,
  `status` text NOT NULL DEFAULT 'queued',
  `attempts` integer NOT NULL DEFAULT 0,
  `next_retry_at` text,
  `last_error` text,
  `priority` real NOT NULL DEFAULT 0,
  `claim_token` text,
  `locked_at` text,
  `idempotency_key` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_outbox_tenant_status_retry`
  ON `webhook_outbox` (`tenant_id`, `status`, `next_retry_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_webhook_outbox_tenant_created`
  ON `webhook_outbox` (`tenant_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_webhook_outbox_idempotent`
  ON `webhook_outbox` (`tenant_id`, `event_type`, `idempotency_key`)
  WHERE `idempotency_key` IS NOT NULL;
