CREATE TABLE `ai_budget_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`month_start` text NOT NULL,
	`state` text NOT NULL,
	`audit_log_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`audit_log_id`) REFERENCES `ai_audit_log`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ai_budget_reservations_tenant_month` ON `ai_budget_reservations` (`tenant_id`,`month_start`);