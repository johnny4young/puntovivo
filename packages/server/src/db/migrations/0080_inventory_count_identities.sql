CREATE TABLE `inventory_count_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`line_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`code` text NOT NULL,
	`expected_quantity` real NOT NULL,
	`expected_status` text NOT NULL,
	`expected_custody_version` integer NOT NULL,
	`expires_at` text,
	`unit_cost` real NOT NULL,
	`stock_status_before_missing` text,
	`counted_quantity` real,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`line_id`) REFERENCES `inventory_count_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inventory_count_identities_kind" CHECK("inventory_count_identities"."kind" IN ('lots', 'serials')),
	CONSTRAINT "inventory_count_identities_quantity" CHECK("inventory_count_identities"."expected_quantity" >= 0 AND ("inventory_count_identities"."counted_quantity" IS NULL OR "inventory_count_identities"."counted_quantity" >= 0)),
	CONSTRAINT "inventory_count_identities_serial_unit" CHECK("inventory_count_identities"."kind" != 'serials' OR ("inventory_count_identities"."expected_quantity" IN (0, 1) AND ("inventory_count_identities"."counted_quantity" IS NULL OR "inventory_count_identities"."counted_quantity" IN (0, 1))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_identities_source` ON `inventory_count_identities` (`tenant_id`,`line_id`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_count_identities_code` ON `inventory_count_identities` (`tenant_id`,`line_id`,`code`);--> statement-breakpoint
ALTER TABLE `product_serials` ADD `custody_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `product_serials` ADD `stock_status_before_missing` text;--> statement-breakpoint
ALTER TABLE `inventory_count_lines` ADD `tracking_mode` text DEFAULT 'aggregate' NOT NULL;--> statement-breakpoint
ALTER TABLE `inventory_lots` ADD `custody_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Physical revisions detect ABA custody changes without treating sync ACKs as stock writes.
CREATE TRIGGER IF NOT EXISTS inventory_lots_advance_custody_version
AFTER UPDATE OF tenant_id, site_id, product_id, lot_number, expires_at, on_hand, unit_cost, status, received_at ON inventory_lots
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.site_id IS NOT OLD.site_id OR NEW.product_id IS NOT OLD.product_id OR NEW.lot_number IS NOT OLD.lot_number OR NEW.expires_at IS NOT OLD.expires_at OR NEW.on_hand IS NOT OLD.on_hand OR NEW.unit_cost IS NOT OLD.unit_cost OR NEW.status IS NOT OLD.status OR NEW.received_at IS NOT OLD.received_at
BEGIN
  UPDATE inventory_lots SET custody_version = OLD.custody_version + 1 WHERE id = NEW.id;
END;

--> statement-breakpoint
-- Physical revisions detect ABA custody changes without treating sync ACKs as stock writes.
CREATE TRIGGER IF NOT EXISTS product_serials_advance_custody_version
AFTER UPDATE OF tenant_id, current_site_id, product_id, serial_number, status, sale_item_id, unit_cost, warranty_expires_at, stock_status_before_missing, source_purchase_item_id ON product_serials
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.current_site_id IS NOT OLD.current_site_id OR NEW.product_id IS NOT OLD.product_id OR NEW.serial_number IS NOT OLD.serial_number OR NEW.status IS NOT OLD.status OR NEW.sale_item_id IS NOT OLD.sale_item_id OR NEW.unit_cost IS NOT OLD.unit_cost OR NEW.warranty_expires_at IS NOT OLD.warranty_expires_at OR NEW.stock_status_before_missing IS NOT OLD.stock_status_before_missing OR NEW.source_purchase_item_id IS NOT OLD.source_purchase_item_id
BEGIN
  UPDATE product_serials SET custody_version = OLD.custody_version + 1 WHERE id = NEW.id;
END;

--> statement-breakpoint
-- Count rows are one local aggregate until a dependency-aware transport exists.
-- Preserve already-confirmed history, payloads and failure evidence, but do not
-- leave old pending or recoverable rows eligible for transport after adoption.
UPDATE sync_outbox
SET status = 'local_only', next_retry_at = NULL, claim_token = NULL, locked_at = NULL
WHERE entity_type IN ('inventory_count_sessions', 'inventory_count_lines')
  AND status != 'synced';
