CREATE TABLE `loss_prevention_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`policy` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
