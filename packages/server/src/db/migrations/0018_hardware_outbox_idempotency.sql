-- ENG-067b — `hardware_outbox` envelope-keyed idempotency.
--
-- Closes the structural gap that ENG-067's chaos suite documented:
-- two enqueues of the same logical hardware command (a tRPC retry
-- after a network blip, a replay from offline buffering, a worker
-- reboot via stale-claim sweep) produced TWO rows in the outbox,
-- making the worker dispatch both — i.e. the receipt printed twice
-- or the drawer kicked twice.
--
-- This migration mirrors the ENG-064 sync_outbox shape:
--
--   1. Adds a nullable `idempotency_key` text column. Existing rows
--      get NULL and never participate in dedup — legacy callers
--      keep producing independent rows (no behavior change).
--   2. Adds a partial unique index on
--      `(tenant_id, kind, idempotency_key) WHERE idempotency_key IS NOT NULL`
--      so writes WITH a key collapse to one row per envelope while
--      writes WITHOUT a key (the user pressing "print" twice
--      deliberately) stay independent.
--
-- Both statements are `IF NOT EXISTS`-safe so the migration is
-- idempotent against DBs that already carry the target shape (the
-- ENG-002 adoption shim convention).

ALTER TABLE `hardware_outbox` ADD COLUMN `idempotency_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_hardware_outbox_idempotent`
  ON `hardware_outbox` (`tenant_id`, `kind`, `idempotency_key`)
  WHERE `idempotency_key` IS NOT NULL;
