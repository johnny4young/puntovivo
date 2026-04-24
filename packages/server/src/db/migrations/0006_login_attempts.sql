-- ENG-008b — durable login rate-limit buckets.
--
-- Promotes the in-memory TTL Maps in
-- `packages/server/src/security/loginRateLimit.ts` to a persistent
-- `login_attempts` table. The service keeps the Maps as a
-- write-through cache; the DB is the source of truth so the 10/IP/60s
-- + 5-fail/username/15min policies survive a server restart.
--
-- IMPORTANT: this table is intentionally NOT tenant-scoped. Rate
-- limiting is per-IP and per-username across the whole deployment —
-- an attacker hammering multiple tenants from one IP must still trip
-- the global IP cap. Documented in docs/SECURITY.md.
--
-- Idempotency: the `IF NOT EXISTS` guards let this migration run
-- cleanly against DBs that already carry the target shape via the
-- ENG-002 Step 3 adoption shim (where `ensureMigrationBaseline()`
-- pins the journal but the underlying schema can vary).

CREATE TABLE IF NOT EXISTS `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`first_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_login_attempts_kind_key` ON `login_attempts` (`kind`,`key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_login_attempts_expires_at` ON `login_attempts` (`expires_at`);
