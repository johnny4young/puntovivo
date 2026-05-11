-- ENG-038 — payment_outbox: LATAM payment rails foundation.
--
-- Sits next to sync_outbox / fiscal_outbox / hardware_outbox /
-- webhook_outbox with the kernel-projection shape (status / attempts /
-- next_retry_at / claim_token / locked_at). v1 ships the contract,
-- deterministic rails and reconciliation reads; real provider workers
-- and credentials land in follow-up slices.

CREATE TABLE IF NOT EXISTS `payment_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `sale_payment_id` text REFERENCES `sale_payments`(`id`) ON DELETE SET NULL,
  `rail_id` text NOT NULL,
  `kind` text NOT NULL DEFAULT 'charge',
  `status` text NOT NULL DEFAULT 'queued',
  `amount` real NOT NULL,
  `currency_code` text NOT NULL DEFAULT 'COP',
  `reference` text NOT NULL,
  `provider_transaction_id` text,
  `payload` text NOT NULL DEFAULT '{}',
  `payload_version` integer NOT NULL DEFAULT 1,
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
CREATE INDEX IF NOT EXISTS `idx_payment_outbox_tenant_status_retry`
  ON `payment_outbox` (`tenant_id`, `status`, `next_retry_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payment_outbox_tenant_created`
  ON `payment_outbox` (`tenant_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payment_outbox_sale_payment`
  ON `payment_outbox` (`sale_payment_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payment_outbox_rail_status`
  ON `payment_outbox` (`tenant_id`, `rail_id`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_payment_outbox_idempotent`
  ON `payment_outbox` (`tenant_id`, `rail_id`, `kind`, `idempotency_key`)
  WHERE `idempotency_key` IS NOT NULL;
