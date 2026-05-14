-- ENG-039c — sales.table_id FK linking a draft sale to its restaurant table.
--
-- Builds on ENG-039b (restaurant_tables catalog). Today the picked table
-- name lives only as free text in sales.suspended_label; without the FK
-- the server cannot answer "which tables have an open draft right now?"
-- and cashiers cannot transfer a draft between tables. The column is
-- nullable so non-restaurant tenants and pre-ENG-039c drafts keep working
-- with no backfill.
--
-- The supporting `idx_sales_tenant_table` index covers read paths that
-- join or filter sales by tenant/table, including `sales.listDrafts`
-- and the `restaurantTables.listWithDraftStatus` open-draft lookup.
-- The index is idempotent via `IF NOT EXISTS`; the column addition is guarded by Drizzle's
-- migration journal plus the ENG-002 adoption shim.

ALTER TABLE `sales` ADD COLUMN `table_id` text REFERENCES `restaurant_tables`(`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_tenant_table`
  ON `sales` (`tenant_id`, `table_id`);
