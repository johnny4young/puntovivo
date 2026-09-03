CREATE TABLE `kds_line_dispatches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`source_sale_item_id` text NOT NULL,
	`route` text NOT NULL,
	`station_code` text,
	`order_line_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_line_id`) REFERENCES `kds_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_kds_dispatch_target" CHECK(("kds_line_dispatches"."route" = 'station' AND "kds_line_dispatches"."order_line_id" IS NOT NULL AND "kds_line_dispatches"."station_code" IS NOT NULL) OR ("kds_line_dispatches"."route" = 'exclude' AND "kds_line_dispatches"."order_line_id" IS NULL AND "kds_line_dispatches"."station_code" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kds_dispatch_source` ON `kds_line_dispatches` (`tenant_id`,`source_sale_item_id`);