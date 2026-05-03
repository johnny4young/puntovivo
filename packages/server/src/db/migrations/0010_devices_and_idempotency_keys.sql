-- ENG-052 — Device registry + command envelope (Foundation Reset wave).
--
-- Lands two new tenant-scoped tables that ADR-0002 in
-- docs/architecture/0002-command-envelope.md locks as the runtime contract
-- for critical mutations:
--
--   - `devices` — formal record of each cashier machine that talks to
--     the server. The Electron desktop binary or the web client
--     registers itself once via auth.registerDevice and persists the
--     server-issued id locally. Every critical mutation later carries
--     `x-device-id` so the server can verify (tenant_id, device_id)
--     ownership and refuse renderer-supplied ids that no row backs.
--   - `idempotency_keys` — per (tenant, device, key, operationKind) row
--     that caches the result of a critical command. Replays with the
--     same key + same canonical input hash short-circuit to the cached
--     result; replays with a mismatched hash raise IDEMPOTENCY_KEY_CONFLICT.
--
-- Also extends `audit_logs` with a nullable `operation_id` column so
-- ENG-053's operation journal can backfill the join key without a second
-- migration.

CREATE TABLE IF NOT EXISTS `devices` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `kind` text NOT NULL,
  `name` text NOT NULL,
  `registered_by_user_id` text NOT NULL,
  `last_seen_at` text,
  `is_active` integer DEFAULT 1 NOT NULL,
  `metadata` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`),
  FOREIGN KEY (`registered_by_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_devices_tenant_active` ON `devices` (`tenant_id`,`is_active`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_devices_tenant_last_seen` ON `devices` (`tenant_id`,`last_seen_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `idempotency_keys` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `device_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `operation_kind` text NOT NULL,
  `request_hash` text NOT NULL,
  `result_ref` text,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`),
  FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_idempotency_keys_unique` ON `idempotency_keys` (`tenant_id`,`device_id`,`idempotency_key`,`operation_kind`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_idempotency_keys_expires_at` ON `idempotency_keys` (`expires_at`);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD COLUMN `operation_id` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_logs_operation_id` ON `audit_logs` (`operation_id`);
