CREATE TABLE `scheduled_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`time_zone` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`cancelled_at` text,
	`cancelled_by_user_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduled_shifts_positive_duration" CHECK("scheduled_shifts"."ends_at" > "scheduled_shifts"."starts_at"),
	CONSTRAINT "scheduled_shifts_version_positive" CHECK("scheduled_shifts"."version" >= 1),
	CONSTRAINT "scheduled_shifts_cancellation_consistent" CHECK(("scheduled_shifts"."status" = 'scheduled' AND "scheduled_shifts"."cancelled_at" IS NULL AND "scheduled_shifts"."cancelled_by_user_id" IS NULL) OR ("scheduled_shifts"."status" = 'cancelled' AND "scheduled_shifts"."cancelled_at" IS NOT NULL AND "scheduled_shifts"."cancelled_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_shifts_tenant_site_start` ON `scheduled_shifts` (`tenant_id`,`site_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_shifts_tenant_user_start` ON `scheduled_shifts` (`tenant_id`,`user_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_shifts_tenant_status_start` ON `scheduled_shifts` (`tenant_id`,`status`,`starts_at`);
--> statement-breakpoint
--  — SQLite cannot express tenant-scoped parent ownership without
-- requiring composite indexes on adopted partial databases. These triggers
-- preserve the same invariant for every writer while keeping migration boot
-- compatible with those database shapes.
CREATE TRIGGER IF NOT EXISTS `scheduled_shifts_tenant_scope_insert`
BEFORE INSERT ON `scheduled_shifts`
WHEN NOT EXISTS (
	SELECT 1 FROM `users` WHERE `id` = NEW.`user_id` AND `tenant_id` = NEW.`tenant_id`
) OR NOT EXISTS (
	SELECT 1 FROM `sites` WHERE `id` = NEW.`site_id` AND `tenant_id` = NEW.`tenant_id`
) OR NOT EXISTS (
	SELECT 1 FROM `users` WHERE `id` = NEW.`created_by_user_id` AND `tenant_id` = NEW.`tenant_id`
) OR NOT EXISTS (
	SELECT 1 FROM `users` WHERE `id` = NEW.`updated_by_user_id` AND `tenant_id` = NEW.`tenant_id`
) OR (
	NEW.`cancelled_by_user_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `users` WHERE `id` = NEW.`cancelled_by_user_id` AND `tenant_id` = NEW.`tenant_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'SCHEDULE_TENANT_SCOPE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `scheduled_shifts_tenant_scope_update`
BEFORE UPDATE OF `tenant_id`, `user_id`, `site_id`, `created_by_user_id`, `updated_by_user_id`, `cancelled_by_user_id` ON `scheduled_shifts`
WHEN NOT EXISTS (
	SELECT 1 FROM `users` WHERE `id` = NEW.`user_id` AND `tenant_id` = NEW.`tenant_id`
) OR NOT EXISTS (
	SELECT 1 FROM `sites` WHERE `id` = NEW.`site_id` AND `tenant_id` = NEW.`tenant_id`
) OR NOT EXISTS (
	SELECT 1 FROM `users` WHERE `id` = NEW.`created_by_user_id` AND `tenant_id` = NEW.`tenant_id`
) OR NOT EXISTS (
	SELECT 1 FROM `users` WHERE `id` = NEW.`updated_by_user_id` AND `tenant_id` = NEW.`tenant_id`
) OR (
	NEW.`cancelled_by_user_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `users` WHERE `id` = NEW.`cancelled_by_user_id` AND `tenant_id` = NEW.`tenant_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'SCHEDULE_TENANT_SCOPE');
END;--> statement-breakpoint
-- Serialize-writer checks provide friendly errors, while these triggers
-- preserve overlap integrity for direct imports and future code paths.
CREATE TRIGGER IF NOT EXISTS `scheduled_shifts_no_overlap_insert`
BEFORE INSERT ON `scheduled_shifts`
WHEN NEW.`status` = 'scheduled' AND EXISTS (
	SELECT 1 FROM `scheduled_shifts` existing
	WHERE existing.`tenant_id` = NEW.`tenant_id`
		AND existing.`user_id` = NEW.`user_id`
		AND existing.`status` = 'scheduled'
		AND existing.`starts_at` < NEW.`ends_at`
		AND existing.`ends_at` > NEW.`starts_at`
)
BEGIN
	SELECT RAISE(ABORT, 'SCHEDULE_SHIFT_OVERLAP');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `scheduled_shifts_no_overlap_update`
BEFORE UPDATE OF `tenant_id`, `user_id`, `starts_at`, `ends_at`, `status` ON `scheduled_shifts`
WHEN NEW.`status` = 'scheduled' AND EXISTS (
	SELECT 1 FROM `scheduled_shifts` existing
	WHERE existing.`id` <> NEW.`id`
		AND existing.`tenant_id` = NEW.`tenant_id`
		AND existing.`user_id` = NEW.`user_id`
		AND existing.`status` = 'scheduled'
		AND existing.`starts_at` < NEW.`ends_at`
		AND existing.`ends_at` > NEW.`starts_at`
)
BEGIN
	SELECT RAISE(ABORT, 'SCHEDULE_SHIFT_OVERLAP');
END;
