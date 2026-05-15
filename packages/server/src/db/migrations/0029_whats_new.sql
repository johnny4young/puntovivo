-- ENG-092 — whats_new_entries + whats_new_acks: per-release
-- announcement records. AuthProvider checks for unread entries on
-- login; Overlay surfaces the most recent unseen one; clicking
-- "Lo vi" writes an ack so the same release does not repeat.
--
-- tenant_id is nullable: a NULL row is a product-wide announcement
-- visible to every tenant; non-NULL rows scope to one tenant.
--
-- IF NOT EXISTS keeps the statement idempotent against the ENG-002
-- adoption shim.

CREATE TABLE IF NOT EXISTS `whats_new_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text REFERENCES `tenants`(`id`),
  `version` text NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `published_at` text NOT NULL DEFAULT (datetime('now')),
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_whats_new_entries_tenant_published`
  ON `whats_new_entries` (`tenant_id`, `published_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `whats_new_acks` (
  `id` text PRIMARY KEY NOT NULL,
  `entry_id` text NOT NULL REFERENCES `whats_new_entries`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `acknowledged_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_whats_new_acks_unique`
  ON `whats_new_acks` (`entry_id`, `user_id`);
