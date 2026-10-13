ALTER TABLE `purchases` ADD `ocr_extract_audit_id` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `ocr_confirmation_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchases_tenant_ocr_extract` ON `purchases` (`tenant_id`,`ocr_extract_audit_id`) WHERE ocr_extract_audit_id IS NOT NULL;