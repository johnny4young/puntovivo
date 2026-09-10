DROP INDEX `idx_sales_resumed_by`;--> statement-breakpoint
ALTER TABLE `sales` ADD `resumed_device_id` text REFERENCES devices(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_sales_resumed_by` ON `sales` (`tenant_id`,`resumed_by`,`resumed_device_id`);--> statement-breakpoint
-- Drafts created before durable claim ownership have no trustworthy active
-- actor/device. Park them conservatively so they remain discoverable and keep
-- their existing creator as a read-side compatibility owner without writing a
-- fabricated suspended_by value.
UPDATE `sales`
SET `suspended_at` = COALESCE(`updated_at`, `created_at`, CURRENT_TIMESTAMP),
    `resumed_by` = NULL,
    `resumed_device_id` = NULL
WHERE `status` = 'draft' AND `suspended_at` IS NULL;
