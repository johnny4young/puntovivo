ALTER TABLE `unit_x_product` ADD `barcode` text;--> statement-breakpoint
CREATE INDEX `idx_unit_x_product_barcode` ON `unit_x_product` (`barcode`);