ALTER TABLE `sales` ADD `resumed_by` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `idx_sales_resumed_by` ON `sales` (`tenant_id`,`resumed_by`);