ALTER TABLE `products` ADD `catalog_type` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `variant_parent_id` text REFERENCES products(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `products` ADD `variant_axes` text;--> statement-breakpoint
ALTER TABLE `products` ADD `variant_values` text;--> statement-breakpoint
ALTER TABLE `products` ADD `variant_signature` text;--> statement-breakpoint
CREATE INDEX `idx_products_variant_parent` ON `products` (`tenant_id`,`variant_parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_variant_signature` ON `products` (`tenant_id`,`variant_parent_id`,`variant_signature`) WHERE "products"."variant_parent_id" is not null;
