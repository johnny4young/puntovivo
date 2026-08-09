DROP INDEX IF EXISTS `idx_products_barcode`;--> statement-breakpoint
CREATE INDEX `idx_products_tenant_barcode` ON `products` (`tenant_id`,`barcode`);--> statement-breakpoint
DROP INDEX IF EXISTS `idx_unit_x_product_barcode`;--> statement-breakpoint
CREATE INDEX `idx_unit_x_product_barcode_product` ON `unit_x_product` (`barcode`,`product_id`);
