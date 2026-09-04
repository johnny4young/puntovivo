CREATE TABLE `reservation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`table_id` text,
	`service_id` text,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `restaurant_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `restaurant_services`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reservation_events_version` ON `reservation_events` (`tenant_id`,`reservation_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_reservation_events_site` ON `reservation_events` (`tenant_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `restaurant_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`table_id` text,
	`service_id` text,
	`guest_name` text NOT NULL,
	`phone` text,
	`party_size` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'booked' NOT NULL,
	`reason` text,
	`arrived_at` text,
	`seated_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `restaurant_services`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_reservation_version" CHECK("restaurant_reservations"."version" >= 1),
	CONSTRAINT "chk_reservation_party" CHECK("restaurant_reservations"."party_size" BETWEEN 1 AND 200),
	CONSTRAINT "chk_reservation_window" CHECK("restaurant_reservations"."starts_at" < "restaurant_reservations"."ends_at"),
	CONSTRAINT "chk_reservation_status" CHECK("restaurant_reservations"."status" IN ('booked','arrived','seated','cancelled','no_show')),
	CONSTRAINT "chk_reservation_seated" CHECK(("restaurant_reservations"."status" = 'seated' AND "restaurant_reservations"."service_id" IS NOT NULL AND "restaurant_reservations"."seated_at" IS NOT NULL) OR ("restaurant_reservations"."status" != 'seated' AND "restaurant_reservations"."service_id" IS NULL AND "restaurant_reservations"."seated_at" IS NULL)),
	CONSTRAINT "chk_reservation_arrival" CHECK("restaurant_reservations"."status" NOT IN ('arrived','seated') OR ("restaurant_reservations"."table_id" IS NOT NULL AND "restaurant_reservations"."arrived_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_reservations_site_time` ON `restaurant_reservations` (`tenant_id`,`site_id`,`starts_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_reservations_table_slot` ON `restaurant_reservations` (`tenant_id`,`table_id`,`status`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reservations_arrived_table` ON `restaurant_reservations` (`tenant_id`,`table_id`) WHERE "restaurant_reservations"."status" = 'arrived';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reservations_service` ON `restaurant_reservations` (`tenant_id`,`service_id`) WHERE "restaurant_reservations"."service_id" IS NOT NULL;