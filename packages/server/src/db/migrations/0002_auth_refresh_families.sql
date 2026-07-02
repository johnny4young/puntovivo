CREATE TABLE `auth_refresh_families` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`current_jti` text NOT NULL,
	`issued_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_rotated_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_auth_refresh_families_user` ON `auth_refresh_families` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_refresh_families_expires` ON `auth_refresh_families` (`expires_at`);