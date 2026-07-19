CREATE TABLE `product_serial_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transfer_order_item_id` text NOT NULL,
	`product_serial_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_order_item_id`) REFERENCES `transfer_order_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_serial_id`) REFERENCES `product_serials`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_product_serial_transfers_tenant` ON `product_serial_transfers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_product_serial_transfers_item` ON `product_serial_transfers` (`transfer_order_item_id`);--> statement-breakpoint
CREATE INDEX `idx_product_serial_transfers_serial` ON `product_serial_transfers` (`product_serial_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_serial_transfers_item_serial` ON `product_serial_transfers` (`tenant_id`,`transfer_order_item_id`,`product_serial_id`);--> statement-breakpoint
ALTER TABLE `product_serials` ADD `source_purchase_item_id` text REFERENCES purchase_items(id);--> statement-breakpoint
CREATE INDEX `idx_product_serials_source_purchase_item` ON `product_serials` (`source_purchase_item_id`);