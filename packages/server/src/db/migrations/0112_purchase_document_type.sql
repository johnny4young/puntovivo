CREATE TABLE `purchase_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`file_name` text,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`payload_base64` text NOT NULL,
	`payload_hash` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_documents_tenant_created` ON `purchase_documents` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_purchase_documents_payload_hash` ON `purchase_documents` (`payload_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_documents_purchase` ON `purchase_documents` (`purchase_id`);--> statement-breakpoint
ALTER TABLE `purchases` ADD `document_type` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `document_number` text;