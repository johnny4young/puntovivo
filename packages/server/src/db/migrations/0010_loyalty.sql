CREATE TABLE `loyalty_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loyalty_accounts_customer` ON `loyalty_accounts` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `loyalty_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text NOT NULL,
	`sale_id` text,
	`kind` text NOT NULL,
	`points` integer NOT NULL,
	`rate_at_earn` real,
	`note` text,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `loyalty_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_loyalty_movements_account` ON `loyalty_movements` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_loyalty_movements_tenant_sale` ON `loyalty_movements` (`tenant_id`,`sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loyalty_movements_sale_earn` ON `loyalty_movements` (`account_id`,`sale_id`) WHERE "loyalty_movements"."kind" = 'earn';