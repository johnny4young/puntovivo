CREATE TABLE `operational_alert_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`alert_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`transition` text NOT NULL,
	`alert_sequence` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`response_status` integer,
	`priority` integer DEFAULT 100 NOT NULL,
	`claim_token` text,
	`locked_at` text,
	`delivered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`alert_id`) REFERENCES `operational_alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `webhook_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_operational_alert_deliveries_transition` ON `operational_alert_deliveries` (`alert_id`,`subscription_id`,`alert_sequence`,`transition`);--> statement-breakpoint
CREATE INDEX `idx_operational_alert_deliveries_tenant_status_retry` ON `operational_alert_deliveries` (`tenant_id`,`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_operational_alert_deliveries_tenant_updated` ON `operational_alert_deliveries` (`tenant_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `operational_alert_delivery_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`outcome` text DEFAULT 'attempting' NOT NULL,
	`response_status` integer,
	`error_code` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`delivery_id`) REFERENCES `operational_alert_deliveries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_operational_alert_attempts_delivery_number` ON `operational_alert_delivery_attempts` (`delivery_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `idx_operational_alert_attempts_tenant_started` ON `operational_alert_delivery_attempts` (`tenant_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `operational_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`area` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`sequence` integer DEFAULT 1 NOT NULL,
	`count` integer NOT NULL,
	`first_observed_at` text NOT NULL,
	`last_observed_at` text NOT NULL,
	`acknowledged_at` text,
	`acknowledged_by_user_id` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`acknowledged_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_operational_alerts_tenant_area_active` ON `operational_alerts` (`tenant_id`,`area`) WHERE "operational_alerts"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_operational_alerts_tenant_status_updated` ON `operational_alerts` (`tenant_id`,`status`,`updated_at`);