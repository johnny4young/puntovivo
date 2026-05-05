-- ENG-062 — ESC/POS printer + cash drawer queue.
--
-- Mirror of `fiscal_outbox` (ENG-057) for peripheral I/O. ENG-060 deferred
-- this table to here because the two default drivers (`system` printer +
-- `manual` payment terminal) had no async fan-out. With ENG-062's `escpos`
-- driver landing real device I/O — which can fail recoverably on USB
-- unplug, paper out, or TCP-host unreachable — the queue lets the cashier
-- keep moving while the worker retries in the background.
--
-- The status machine + retry policy + claim_token concurrency are
-- inherited from `lib/outbox/createOutboxKernel`. The hardware worker
-- (`services/peripherals/hardware-worker.ts`) drives state transitions;
-- failed receipt prints are recoverable through the standard outbox
-- flow without re-triggering the original sale completion.
--
-- See `docs/HARDWARE-POS.md §6 + §Cash drawer` for the design spec and
-- `docs/architecture/0003-outbox-taxonomy.md` §Affected Tickets for the
-- ENG-060 → ENG-062 deferral note.

CREATE TABLE IF NOT EXISTS `hardware_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `status` text NOT NULL DEFAULT 'queued',
  `kind` text NOT NULL,
  `peripheral_id` text REFERENCES `site_peripherals`(`id`) ON DELETE SET NULL,
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
CREATE INDEX IF NOT EXISTS `idx_hardware_outbox_tenant_status_retry`
  ON `hardware_outbox` (`tenant_id`, `status`, `next_retry_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hardware_outbox_peripheral`
  ON `hardware_outbox` (`peripheral_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hardware_outbox_tenant_created`
  ON `hardware_outbox` (`tenant_id`, `created_at`);
