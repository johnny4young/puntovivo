-- ENG-094 — supplier invoice OCR upload store.
--
-- The OCR dialog uploads a JPG/PNG/PDF first, receives an opaque
-- `uploadId`, then asks `ai.invoiceOcr.extract` to process that id.
-- Local/Electron deployments keep the payload in SQLite; cloud
-- deployments can replace `payload_base64` with an S3 pointer later
-- without changing the tRPC contract.

CREATE TABLE IF NOT EXISTS `invoice_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text,
	`user_id` text,
	`file_name` text,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`payload_base64` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_invoice_uploads_tenant_created` ON `invoice_uploads` (`tenant_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_invoice_uploads_tenant_site_created` ON `invoice_uploads` (`tenant_id`,`site_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_invoice_uploads_payload_hash` ON `invoice_uploads` (`payload_hash`);
