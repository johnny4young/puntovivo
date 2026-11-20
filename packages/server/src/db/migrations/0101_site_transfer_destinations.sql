CREATE TABLE `site_transfer_destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`account` text NOT NULL,
	`bank_name` text,
	`account_type` text,
	`holder_name` text,
	`holder_id` text,
	`qr_payload` text,
	`created_by` text,
	`updated_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_site_transfer_destinations_tenant_site_position` ON `site_transfer_destinations` (`tenant_id`,`site_id`,`position`);