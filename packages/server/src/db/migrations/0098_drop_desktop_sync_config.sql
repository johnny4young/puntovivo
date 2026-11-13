-- Nothing reads this key; the desktop channel that wrote it is gone.
-- Adopted legacy databases may predate app_settings.
CREATE TABLE IF NOT EXISTS `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
DELETE FROM `app_settings` WHERE `key` = 'desktop_sync_config';
