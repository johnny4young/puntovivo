CREATE TABLE `day_close_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`signoff_id` text NOT NULL,
	`renderer_version` integer DEFAULT 1 NOT NULL,
	`locale` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text DEFAULT 'application/pdf' NOT NULL,
	`byte_size` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`report_hash` text NOT NULL,
	`payload` blob NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`signoff_id`) REFERENCES `day_close_signoffs`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_day_close_artifacts_tenant_signoff` ON `day_close_artifacts` (`tenant_id`,`signoff_id`);--> statement-breakpoint
CREATE INDEX `idx_day_close_artifacts_tenant_created` ON `day_close_artifacts` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_day_close_signoffs_tenant_id` ON `day_close_signoffs` (`tenant_id`,`id`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `day_close_artifacts_immutable_update`
BEFORE UPDATE ON `day_close_artifacts`
BEGIN
	SELECT RAISE(ABORT, 'day_close_artifacts are immutable');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `day_close_artifacts_immutable_delete`
BEFORE DELETE ON `day_close_artifacts`
BEGIN
	SELECT RAISE(ABORT, 'day_close_artifacts are immutable');
END;
