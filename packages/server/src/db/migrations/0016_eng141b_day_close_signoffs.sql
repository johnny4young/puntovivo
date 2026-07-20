CREATE TABLE `day_close_signoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`business_date` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`time_zone` text NOT NULL,
	`currency_code` text NOT NULL,
	`report_snapshot` text NOT NULL,
	`report_hash` text NOT NULL,
	`signed_by_user_id` text NOT NULL,
	`signed_by_name` text NOT NULL,
	`signed_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_day_close_signoffs_tenant_date` ON `day_close_signoffs` (`tenant_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `idx_day_close_signoffs_tenant_signed_at` ON `day_close_signoffs` (`tenant_id`,`signed_at`);--> statement-breakpoint
-- : Drizzle cannot express immutable-table triggers. Keep both
-- guards idempotent so databases that adopted the shape manually remain safe.
CREATE TRIGGER IF NOT EXISTS `trg_day_close_signoffs_no_update`
BEFORE UPDATE ON `day_close_signoffs`
BEGIN
	SELECT RAISE(ABORT, 'day_close_signoffs are immutable');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_day_close_signoffs_no_delete`
BEFORE DELETE ON `day_close_signoffs`
BEGIN
	SELECT RAISE(ABORT, 'day_close_signoffs are immutable');
END;
