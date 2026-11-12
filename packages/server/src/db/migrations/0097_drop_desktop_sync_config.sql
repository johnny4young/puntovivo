-- Nothing reads this key; the desktop channel that wrote it is gone.
DELETE FROM `app_settings` WHERE `key` = 'desktop_sync_config';
