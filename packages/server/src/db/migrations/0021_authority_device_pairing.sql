-- ENG-075 — device pairing + Authority Node health.
--
-- Adds explicit topology metadata to the existing devices registry and
-- introduces one-time, short-lived pairing codes for hub-client terminals.
-- Index and table creation statements are idempotent; column additions follow
-- the versioned migration journal and run once.

ALTER TABLE `devices` ADD COLUMN `authority_role` text;
--> statement-breakpoint
ALTER TABLE `devices` ADD COLUMN `paired_site_id` text REFERENCES `sites`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `devices` ADD COLUMN `app_version` text;
--> statement-breakpoint
ALTER TABLE `devices` ADD COLUMN `db_schema_version` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_devices_tenant_authority_role`
  ON `devices` (`tenant_id`, `authority_role`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_devices_tenant_paired_site`
  ON `devices` (`tenant_id`, `paired_site_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `device_pairing_codes` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `site_id` text NOT NULL REFERENCES `sites`(`id`) ON DELETE CASCADE,
  `code_hash` text NOT NULL,
  `device_name` text,
  `status` text NOT NULL DEFAULT 'pending',
  `created_by_user_id` text NOT NULL REFERENCES `users`(`id`),
  `claimed_by_device_id` text REFERENCES `devices`(`id`) ON DELETE SET NULL,
  `expires_at` text NOT NULL,
  `claimed_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_device_pairing_codes_hash`
  ON `device_pairing_codes` (`code_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_device_pairing_codes_tenant_status`
  ON `device_pairing_codes` (`tenant_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_device_pairing_codes_tenant_site`
  ON `device_pairing_codes` (`tenant_id`, `site_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_device_pairing_codes_claimed_device`
  ON `device_pairing_codes` (`claimed_by_device_id`);
