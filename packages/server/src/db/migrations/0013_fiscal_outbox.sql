-- ENG-057 — Fiscal outbox + contingency engine.
--
-- First concrete consumer of the outbox kernel that ENG-053 shipped.
-- Lives next to `fiscal_documents` which remains the source of truth
-- for each comprobante; the outbox row tracks the
-- communication-with-provider lifecycle:
--
--   queued -> submitting -> accepted | rejected | contingency
--                       \-> retrying -> dead_letter
--
-- The fiscal worker (`services/fiscal/fiscal-worker.ts`) drives state
-- transitions and mirrors the verdict back to `fiscal_documents.status`
-- so existing consumers (close-shift pending checks, FiscalContingencyIndicator,
-- `reports.fiscal.list`) keep working without joining this table.
--
-- See `docs/architecture/0003-outbox-taxonomy.md` §Fiscal outbox for
-- the full lifecycle + retry policy contract. See
-- `docs/architecture/patterns/outbox-kernel.md` for the canonical
-- `createOutboxKernel` invocation example.

CREATE TABLE IF NOT EXISTS `fiscal_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `status` text NOT NULL DEFAULT 'queued',
  `kind` text NOT NULL DEFAULT 'emit',
  `fiscal_document_id` text REFERENCES `fiscal_documents`(`id`) ON DELETE SET NULL,
  `provider_id` text,
  `cufe` text,
  `payload` text NOT NULL,
  `payload_version` integer NOT NULL DEFAULT 1,
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
CREATE INDEX IF NOT EXISTS `idx_fiscal_outbox_tenant_status_retry`
  ON `fiscal_outbox` (`tenant_id`, `status`, `next_retry_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_outbox_fiscal_document`
  ON `fiscal_outbox` (`fiscal_document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_outbox_tenant_created`
  ON `fiscal_outbox` (`tenant_id`, `created_at`);
