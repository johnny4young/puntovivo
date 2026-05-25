-- ENG-175 — composite indexes for hot paths.
--
-- The hot listing queries today filter by combinations the planner
-- cannot cover with column-level indexes alone:
--
--   - audit_logs listing → WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
--     [optionally AND action = ?]
--   - inventory_movements traceability → ORDER BY created_at within tenant
--   - restaurant_tables dropdown → unique name per (tenant, site) while
--     active; archived rows must free the name for reuse
--   - operation_events worker poll → WHERE status IN (...) ORDER BY created_at
--   - quotations expiring-soon dashboard → WHERE tenant + status + valid_until
--   - sync_outbox per-entity drilldown → WHERE entity_type + entity_id + status
--
-- All statements use `IF NOT EXISTS` so re-running the migration against
-- a DB that already carries the target shape (ENG-002 adoption shim) is
-- a no-op. The sync_outbox index swap uses DROP + CREATE because SQLite
-- has no ALTER INDEX statement and the column list grew from 2 to 3.
CREATE INDEX IF NOT EXISTS `idx_audit_logs_tenant_created` ON `audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_logs_tenant_action_created` ON `audit_logs` (`tenant_id`,`action`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_inventory_movements_tenant_created` ON `inventory_movements` (`tenant_id`,`created_at`);--> statement-breakpoint
-- restaurant_tables partial unique already shipped in 0023 as
-- `idx_restaurant_tables_unique_active_name`. ENG-175 only brings the
-- index into the Drizzle schema source-of-truth; the DB-side index
-- already exists, no DDL to emit.
CREATE INDEX IF NOT EXISTS `idx_operation_events_status_created` ON `operation_events` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_quotations_tenant_status_valid_until` ON `quotations` (`tenant_id`,`status`,`valid_until`);--> statement-breakpoint
-- The pre-ENG-175 `idx_sync_outbox_entity` covered (entity_type, entity_id)
-- only. The Operations Center "pending syncs for entity X" query post-
-- filtered on status in memory; the widened index lets the planner
-- resolve it directly. Drop the old shape if present, then create the
-- new one. Both statements are idempotent so a re-run on an upgraded DB
-- ends in the same state.
DROP INDEX IF EXISTS `idx_sync_outbox_entity`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sync_outbox_entity` ON `sync_outbox` (`entity_type`,`entity_id`,`status`);
