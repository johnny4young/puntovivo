CREATE TABLE `external_order_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`adapter` text NOT NULL,
	`sealed_secret` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_external_connector_version" CHECK("external_order_connectors"."version" >= 1),
	CONSTRAINT "chk_external_connector_adapter" CHECK("external_order_connectors"."adapter" = 'sandbox_v1')
);
--> statement-breakpoint
CREATE INDEX `idx_external_connectors_site` ON `external_order_connectors` (`tenant_id`,`site_id`,`id`);--> statement-breakpoint
CREATE TABLE `external_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`order_id` text NOT NULL,
	`version` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`source` text NOT NULL,
	`actor_id` text,
	`source_event_id` text,
	`operation_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `external_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_external_event_actor" CHECK(("external_order_events"."source" = 'connector' AND "external_order_events"."actor_id" IS NULL AND "external_order_events"."source_event_id" IS NOT NULL) OR ("external_order_events"."source" = 'operator' AND "external_order_events"."actor_id" IS NOT NULL AND "external_order_events"."operation_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_events_version` ON `external_order_events` (`tenant_id`,`order_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_external_events_site` ON `external_order_events` (`tenant_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `external_order_nonces` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`nonce` text NOT NULL,
	`envelope_hash` text NOT NULL,
	`receipt_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `external_order_connectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `external_order_receipts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_nonces_identity` ON `external_order_nonces` (`tenant_id`,`connector_id`,`nonce`);--> statement-breakpoint
CREATE INDEX `idx_external_nonces_expiry` ON `external_order_nonces` (`tenant_id`,`connector_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `external_order_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`order_id` text NOT NULL,
	`event_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`kind` text NOT NULL,
	`result_status` text NOT NULL,
	`result_version` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `external_order_connectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `external_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_receipts_identity` ON `external_order_receipts` (`tenant_id`,`connector_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `external_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`external_id` text NOT NULL,
	`status` text NOT NULL,
	`snapshot` text,
	`create_hash` text,
	`sale_id` text,
	`reason` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `external_order_connectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_external_order_version" CHECK("external_orders"."version" >= 1),
	CONSTRAINT "chk_external_order_status" CHECK("external_orders"."status" IN ('received','accepted','cancel_requested','cancelled','rejected')),
	CONSTRAINT "chk_external_order_binding" CHECK("external_orders"."status" NOT IN ('accepted','cancel_requested') OR "external_orders"."sale_id" IS NOT NULL),
	CONSTRAINT "chk_external_order_snapshot" CHECK("external_orders"."status" != 'received' OR ("external_orders"."snapshot" IS NOT NULL AND "external_orders"."create_hash" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_orders_identity` ON `external_orders` (`tenant_id`,`connector_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_orders_sale` ON `external_orders` (`tenant_id`,`sale_id`) WHERE "external_orders"."sale_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_external_orders_queue` ON `external_orders` (`tenant_id`,`site_id`,`status`,`created_at`,`id`);