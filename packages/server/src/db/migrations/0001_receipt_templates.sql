-- Iter 2 — receipt templates. This migration is hand-tuned to use
-- `IF NOT EXISTS` because earlier installs saw the `receipt_templates`
-- table land via the now-retired raw-DDL bootstrap during the same
-- release cycle that introduced Drizzle versioned migrations. On those
-- installs the `__drizzle_migrations` row for 0001 is missing but the
-- table is already present; a vanilla `CREATE TABLE` would fail the
-- migration mid-run and leave the DB unbootable. Using `IF NOT EXISTS`
-- lets drizzle-migrate mark 0001 as applied on pre-existing schemas
-- while still producing the right shape on truly fresh DBs. The
-- partial unique index at the bottom keeps the invariant enforced
-- regardless of how the table actually got created.
CREATE TABLE IF NOT EXISTS `receipt_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`paper_width` text DEFAULT '80mm' NOT NULL,
	`layout` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipt_templates_tenant` ON `receipt_templates` (`tenant_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipt_templates_tenant_kind` ON `receipt_templates` (`tenant_id`,`kind`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipt_templates_tenant_active` ON `receipt_templates` (`tenant_id`,`is_active`);--> statement-breakpoint
-- Partial unique index: at most one default per (tenant, kind). Drizzle's
-- SQLite dialect does not yet emit partial uniques from the schema
-- declaration, so this statement is hand-appended to mirror the raw DDL
-- defence in `db/index.ts`. The service layer also enforces the
-- invariant atomically inside transactions.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_receipt_templates_tenant_kind_default` ON `receipt_templates` (`tenant_id`,`kind`) WHERE `is_default` = 1;
