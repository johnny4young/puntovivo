-- ENG-052 follow-up — atomic reservation state for idempotency keys.
--
-- 0010 introduced the base table. This migration keeps already-applied
-- development databases valid by adding the reservation lifecycle columns
-- separately instead of rewriting the historical migration.

ALTER TABLE `idempotency_keys` ADD COLUMN `status` text DEFAULT 'processing' NOT NULL;
--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD COLUMN `locked_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD COLUMN `completed_at` text;
--> statement-breakpoint
UPDATE `idempotency_keys`
SET
  `status` = CASE
    WHEN `result_ref` IS NOT NULL THEN 'succeeded'
    ELSE 'processing'
  END,
  `locked_at` = `created_at`,
  `completed_at` = CASE
    WHEN `result_ref` IS NOT NULL THEN `created_at`
    ELSE NULL
  END;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_idempotency_keys_status_expires_at` ON `idempotency_keys` (`status`,`expires_at`);
