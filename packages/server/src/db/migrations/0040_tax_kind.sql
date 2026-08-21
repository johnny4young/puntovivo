ALTER TABLE `vat_rates` ADD `kind` text DEFAULT 'iva' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `tax_kind` text DEFAULT 'iva' NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `tax_kind` text DEFAULT 'iva' NOT NULL;