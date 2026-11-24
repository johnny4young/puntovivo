PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- `( reconciling the service identity )`. `users` is referenced by triggers
-- (scheduled_shifts_tenant_scope_*) and by audit_logs.actor_id. A DROP+RENAME
-- rebuild breaks those references mid-flight, so the table is rebuilt with the
-- documented legacy pattern: rename the old one aside WITHOUT rewriting the
-- triggers that point at `users`, create the new table with the original name,
-- copy, then drop the old table. The triggers keep resolving to `users`
-- throughout, and no DML touches them in between.
PRAGMA legacy_alter_table=ON;--> statement-breakpoint
ALTER TABLE `users` RENAME TO `users_previous`;--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text DEFAULT 'human' NOT NULL,
	`email` text,
	`name` text NOT NULL,
	`password_hash` text,
	`staff_pin_hash` text,
	`session_version` integer DEFAULT 1 NOT NULL,
	`role` text DEFAULT 'cashier' NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_users_service_has_no_credentials" CHECK(("kind" = 'human'
        AND "email" IS NOT NULL
        AND "password_hash" IS NOT NULL)
        OR ("kind" = 'service'
        AND "email" IS NULL
        AND "password_hash" IS NULL
        AND "staff_pin_hash" IS NULL))
);--> statement-breakpoint
-- Every existing account is human by definition: it was created through the
-- password login that a service identity can never use.
INSERT INTO `users`("id", "tenant_id", "kind", "email", "name", "password_hash", "staff_pin_hash", "session_version", "role", "is_active", "created_at", "updated_at")
SELECT "id", "tenant_id", 'human', "email", "name", "password_hash", "staff_pin_hash", "session_version", "role", "is_active", "created_at", "updated_at" FROM `users_previous`;--> statement-breakpoint
DROP TABLE `users_previous`;--> statement-breakpoint
PRAGMA legacy_alter_table=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_tenant` ON `users` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_tenant_service_name` ON `users` (`tenant_id`,`name`) WHERE kind = 'service';--> statement-breakpoint
PRAGMA foreign_keys=ON;
