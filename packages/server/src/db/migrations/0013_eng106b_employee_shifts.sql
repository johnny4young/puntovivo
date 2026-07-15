CREATE TABLE `employee_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`clocked_in_at` text NOT NULL,
	`clocked_out_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_employee_shifts_tenant_user_clocked_in` ON `employee_shifts` (`tenant_id`,`user_id`,`clocked_in_at`);--> statement-breakpoint
CREATE INDEX `idx_employee_shifts_tenant_site_clocked_in` ON `employee_shifts` (`tenant_id`,`site_id`,`clocked_in_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employee_shifts_one_open_per_user` ON `employee_shifts` (`tenant_id`,`user_id`) WHERE "employee_shifts"."clocked_out_at" IS NULL;