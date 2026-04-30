-- ENG-030 — AI-FOUNDATION audit log table.
--
-- Records every AI provider call (success and failure) so the admin
-- can see total spend, per-site breakdown, per-feature breakdown, and
-- per-provider breakdown without crossing a tenant boundary. Budget
-- enforcement (`ai.client.completeAI`) reads `currentMonthSpend` from
-- this table.
--
-- The table carries `site_id` and `provider_id` from day 1 so future
-- per-site / per-provider reporting (and eventually per-site BUDGET
-- enforcement) doesn't require a follow-up migration. Per-tenant
-- single-budget enforcement is what ENG-030 ships; the data is
-- already wide enough for finer-grained controls later.
--
-- Idempotency: the `IF NOT EXISTS` guards let this migration run
-- cleanly against DBs that already carry the target shape via the
-- ENG-002 Step 3 adoption shim.

CREATE TABLE IF NOT EXISTS `ai_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text,
	`user_id` text,
	`feature` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real NOT NULL,
	`duration_ms` integer NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_audit_log_tenant_created` ON `ai_audit_log` (`tenant_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_audit_log_tenant_site_created` ON `ai_audit_log` (`tenant_id`,`site_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_audit_log_tenant_feature` ON `ai_audit_log` (`tenant_id`,`feature`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_audit_log_tenant_provider` ON `ai_audit_log` (`tenant_id`,`provider_id`);
