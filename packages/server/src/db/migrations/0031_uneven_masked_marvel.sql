CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`outbox_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`response_status` integer,
	`last_error_code` text,
	`last_attempt_at` text,
	`delivered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`outbox_id`) REFERENCES `webhook_outbox`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `webhook_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhook_deliveries_outbox_subscription` ON `webhook_deliveries` (`outbox_id`,`subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_deliveries_tenant_status` ON `webhook_deliveries` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `webhook_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`destination_url` text NOT NULL,
	`event_types` text NOT NULL,
	`sealed_secret` text,
	`enabled` integer DEFAULT true NOT NULL,
	`revoked_at` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_subscriptions_tenant_enabled` ON `webhook_subscriptions` (`tenant_id`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhook_subscriptions_tenant_url_active` ON `webhook_subscriptions` (`tenant_id`,`destination_url`) WHERE "webhook_subscriptions"."revoked_at" IS NULL;