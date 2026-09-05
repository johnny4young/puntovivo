CREATE TABLE `kds_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`order_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text,
	`facts` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `kds_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_kds_events_sequence" CHECK("kds_order_events"."sequence" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kds_events_sequence` ON `kds_order_events` (`tenant_id`,`order_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_kds_events_site_created` ON `kds_order_events` (`tenant_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `kds_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`source_sale_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_label` text,
	`notes` text,
	`round_id` text,
	`round_label` text,
	`course_key` text,
	`diner_label` text,
	`modifiers` text NOT NULL,
	`current_sale_id` text NOT NULL,
	`current_table_id` text,
	`current_table_label` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`ready_at` text,
	`ready_by_user_id` text,
	`voided_at` text,
	`void_reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `kds_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ready_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_kds_lines_quantity" CHECK("kds_order_lines"."quantity" > 0 AND "kds_order_lines"."quantity" <= 1000000000),
	CONSTRAINT "chk_kds_lines_status" CHECK("kds_order_lines"."status" IN ('pending', 'preparing', 'ready', 'voided')),
	CONSTRAINT "chk_kds_lines_version" CHECK("kds_order_lines"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kds_lines_source_item` ON `kds_order_lines` (`tenant_id`,`source_sale_item_id`);--> statement-breakpoint
CREATE INDEX `idx_kds_lines_order` ON `kds_order_lines` (`tenant_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `idx_kds_lines_current_sale` ON `kds_order_lines` (`tenant_id`,`current_sale_id`);--> statement-breakpoint
CREATE TABLE `kds_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`event_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`claim_token` text,
	`locked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `kds_order_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_kds_outbox_status" CHECK("kds_outbox"."status" IN ('queued', 'submitting', 'delivered', 'retrying', 'dead_letter'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kds_outbox_event` ON `kds_outbox` (`tenant_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_kds_outbox_due` ON `kds_outbox` (`tenant_id`,`status`,`next_retry_at`);--> statement-breakpoint
CREATE TABLE `kds_routing_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`route` text NOT NULL,
	`station_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kds_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_kds_routing_kind" CHECK("kds_routing_rules"."target_kind" IN ('product', 'category')),
	CONSTRAINT "chk_kds_routing_destination" CHECK(("kds_routing_rules"."route" = 'station' AND "kds_routing_rules"."station_id" IS NOT NULL) OR ("kds_routing_rules"."route" = 'exclude' AND "kds_routing_rules"."station_id" IS NULL)),
	CONSTRAINT "chk_kds_routing_version" CHECK("kds_routing_rules"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kds_routing_target` ON `kds_routing_rules` (`tenant_id`,`site_id`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_kds_routing_station` ON `kds_routing_rules` (`tenant_id`,`site_id`,`station_id`);--> statement-breakpoint
CREATE TABLE `kds_stations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_kds_stations_version" CHECK("kds_stations"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kds_stations_scope_code` ON `kds_stations` (`tenant_id`,`site_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_kds_stations_scope_active` ON `kds_stations` (`tenant_id`,`site_id`,`is_active`);--> statement-breakpoint
DROP INDEX `idx_kds_orders_unique_sale_station`;--> statement-breakpoint
ALTER TABLE `kds_orders` ADD `station_name` text;--> statement-breakpoint
ALTER TABLE `kds_orders` ADD `dispatch_key` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `kds_orders` ADD `snapshot_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `kds_orders` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kds_orders_unique_dispatch` ON `kds_orders` (`tenant_id`,`sale_id`,`station`,`dispatch_key`);