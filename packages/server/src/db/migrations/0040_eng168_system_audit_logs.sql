-- ENG-168 follow-up — global audit trail for maintenance workers.
--
-- `audit_logs` is tenant-scoped by design (`tenant_id` + `actor_id`
-- are required). The login_attempts cleanup worker is global: the
-- source table is keyed by IP / normalized email and the job runs
-- without a tenant or actor. A separate system audit table records
-- one row per maintenance run without inventing synthetic tenant data.

CREATE TABLE IF NOT EXISTS `system_audit_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `action` text NOT NULL,
  `resource_type` text NOT NULL,
  `resource_id` text NOT NULL,
  `status` text NOT NULL,
  `metadata` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_system_audit_logs_action_created`
  ON `system_audit_logs` (`action`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_system_audit_logs_resource_created`
  ON `system_audit_logs` (`resource_type`, `resource_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_system_audit_logs_status_created`
  ON `system_audit_logs` (`status`, `created_at`);
