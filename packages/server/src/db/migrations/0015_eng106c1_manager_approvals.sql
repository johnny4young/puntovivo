CREATE TABLE `manager_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`action` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`summary` text NOT NULL,
	`requested_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`decision_reason` text,
	`grant_expires_at` text,
	`claim_token` text,
	`claim_expires_at` text,
	`consumed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_manager_approvals_tenant_status_requested` ON `manager_approval_requests` (`tenant_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_manager_approvals_tenant_site_status` ON `manager_approval_requests` (`tenant_id`,`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_manager_approvals_tenant_requester_requested` ON `manager_approval_requests` (`tenant_id`,`requester_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_manager_approvals_grant_expiry` ON `manager_approval_requests` (`status`,`grant_expires_at`);