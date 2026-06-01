-- ENG-173 — Web Vitals real-user monitoring (RUM).
--
-- One row per metric per sampled page load, written by the public
-- `observability.reportWebVital` mutation so login / first-paint vitals are
-- captured before authentication. `tenant_id` is nullable (anonymous,
-- pre-login loads carry no tenant) and is always derived server-side from the
-- session, never from client input. `tenant_plan` is a placeholder ('unknown')
-- until a billing tier concept exists (ENG-138).
--
-- Hand-authored (drizzle-kit generate is blocked by a pre-existing meta
-- snapshot collision at 0036-0038); `IF NOT EXISTS` keeps it idempotent against
-- DBs already carrying the shape through the ENG-002 adoption shim.

CREATE TABLE IF NOT EXISTS `web_vital_samples` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text,
  `tenant_plan` text DEFAULT 'unknown' NOT NULL,
  `route` text NOT NULL,
  `metric` text NOT NULL,
  `value` real NOT NULL,
  `rating` text NOT NULL,
  `device_class` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_web_vital_samples_tenant_metric_created`
  ON `web_vital_samples` (`tenant_id`, `metric`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_web_vital_samples_metric_created`
  ON `web_vital_samples` (`metric`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_web_vital_samples_route`
  ON `web_vital_samples` (`route`);
