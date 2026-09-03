-- Existing terminals adopt their authenticated user on the first post-upgrade
-- critical command. Leaving this nullable avoids inventing that current user
-- from the historical registered_by_user_id provenance column.
ALTER TABLE `devices` ADD `active_user_id` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `identity_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_devices_tenant_active_user` ON `devices` (`tenant_id`,`active_user_id`);
