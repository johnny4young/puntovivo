CREATE TABLE `fiscal_emission_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`kind` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`fiscal_document_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`claim_token` text,
	`locked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fiscal_document_id`) REFERENCES `fiscal_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_intents_source` ON `fiscal_emission_intents` (`tenant_id`,`source`,`source_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_intents_tenant_status_retry` ON `fiscal_emission_intents` (`tenant_id`,`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_intents_document` ON `fiscal_emission_intents` (`fiscal_document_id`);