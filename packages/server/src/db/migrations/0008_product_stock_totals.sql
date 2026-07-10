CREATE TABLE `product_stock_totals` (
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`tenant_id`, `product_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_product_stock_totals_tenant` ON `product_stock_totals` (`tenant_id`);--> statement-breakpoint
INSERT INTO product_stock_totals (tenant_id, product_id, total, updated_at)
SELECT tenant_id, product_id, SUM(on_hand), datetime('now')
FROM inventory_balances
GROUP BY tenant_id, product_id
ON CONFLICT(tenant_id, product_id) DO UPDATE SET total = excluded.total, updated_at = excluded.updated_at;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_pst_balance_insert
AFTER INSERT ON inventory_balances
BEGIN
  INSERT INTO product_stock_totals (tenant_id, product_id, total, updated_at)
  VALUES (NEW.tenant_id, NEW.product_id, NEW.on_hand, datetime('now'))
  ON CONFLICT(tenant_id, product_id)
  DO UPDATE SET total = total + NEW.on_hand, updated_at = datetime('now');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_pst_balance_update
AFTER UPDATE OF on_hand ON inventory_balances
BEGIN
  INSERT INTO product_stock_totals (tenant_id, product_id, total, updated_at)
  VALUES (NEW.tenant_id, NEW.product_id, NEW.on_hand - OLD.on_hand, datetime('now'))
  ON CONFLICT(tenant_id, product_id)
  DO UPDATE SET total = total + (NEW.on_hand - OLD.on_hand), updated_at = datetime('now');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_pst_balance_delete
AFTER DELETE ON inventory_balances
BEGIN
  UPDATE product_stock_totals
  SET total = total - OLD.on_hand, updated_at = datetime('now')
  WHERE tenant_id = OLD.tenant_id AND product_id = OLD.product_id;
END;
