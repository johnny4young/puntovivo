DROP INDEX IF EXISTS `idx_cash_movements_tenant`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cash_movements_tenant_reference` ON `cash_movements` (`tenant_id`,`reference_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `idx_sales_tenant`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_tenant_status_effective_date` ON `sales` (`tenant_id`,`status`,coalesce(`checkout_completed_at`, `created_at`));--> statement-breakpoint
DROP INDEX IF EXISTS `idx_sale_returns_tenant`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sale_returns_tenant_created` ON `sale_returns` (`tenant_id`,`created_at`);--> statement-breakpoint
DROP INDEX IF EXISTS `idx_inventory_balances_tenant`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_inventory_lots_tenant`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_audit_logs_tenant`;
