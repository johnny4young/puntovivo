ALTER TABLE `transfer_order_item_lots` ADD `shipped_value_cents` integer;--> statement-breakpoint
ALTER TABLE `transfer_order_item_lots` ADD `received_value_cents` integer;--> statement-breakpoint
ALTER TABLE `transfer_order_item_lots` ADD `destination_previous_value_cents` integer;--> statement-breakpoint
ALTER TABLE `transfer_order_item_lots` ADD `destination_previous_valuation_quantity` real;--> statement-breakpoint
ALTER TABLE `transfer_order_item_lots` ADD `destination_resulting_value_cents` integer;--> statement-breakpoint
ALTER TABLE `transfer_order_item_lots` ADD `destination_resulting_valuation_version` integer;--> statement-breakpoint
ALTER TABLE `transfer_order_items` ADD `shipped_inventory_value_cents` integer;--> statement-breakpoint
ALTER TABLE `transfer_order_items` ADD `shipped_cogs_value_cents` integer;--> statement-breakpoint
ALTER TABLE `transfer_order_items` ADD `received_inventory_value_cents` integer;--> statement-breakpoint
ALTER TABLE `transfer_order_items` ADD `received_cogs_value_cents` integer;--> statement-breakpoint
ALTER TABLE `transfer_order_items` ADD `resulting_valuation_version` integer;--> statement-breakpoint
ALTER TABLE `inventory_lots` ADD `valuation_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Monetary mutations are custody changes even when rounded cost and quantity stay identical.
DROP TRIGGER IF EXISTS inventory_lots_advance_custody_version;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS inventory_lots_advance_custody_version
AFTER UPDATE OF tenant_id, site_id, product_id, lot_number, expires_at, on_hand, unit_cost, status, received_at, carrying_value_cents, valuation_quantity ON inventory_lots
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.site_id IS NOT OLD.site_id OR NEW.product_id IS NOT OLD.product_id OR NEW.lot_number IS NOT OLD.lot_number OR NEW.expires_at IS NOT OLD.expires_at OR NEW.on_hand IS NOT OLD.on_hand OR NEW.unit_cost IS NOT OLD.unit_cost OR NEW.status IS NOT OLD.status OR NEW.received_at IS NOT OLD.received_at OR NEW.carrying_value_cents IS NOT OLD.carrying_value_cents OR NEW.valuation_quantity IS NOT OLD.valuation_quantity
BEGIN
  UPDATE inventory_lots SET custody_version = OLD.custody_version + 1 WHERE id = NEW.id;
END;
--> statement-breakpoint
-- Cost undo must detect value-only ABA writes, but must still propagate a later quarantine/recall.
CREATE TRIGGER IF NOT EXISTS inventory_lots_advance_valuation_version
AFTER UPDATE OF on_hand, unit_cost, carrying_value_cents, valuation_quantity ON inventory_lots
WHEN NEW.on_hand IS NOT OLD.on_hand OR NEW.unit_cost IS NOT OLD.unit_cost OR NEW.carrying_value_cents IS NOT OLD.carrying_value_cents OR NEW.valuation_quantity IS NOT OLD.valuation_quantity
BEGIN
  UPDATE inventory_lots SET valuation_version = OLD.valuation_version + 1 WHERE id = NEW.id;
END;
