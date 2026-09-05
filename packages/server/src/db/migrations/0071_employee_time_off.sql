CREATE TABLE `employee_time_off` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`from_date` text NOT NULL,
	`until_date` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`time_zone` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_time_off_kind" CHECK("employee_time_off"."kind" IN ('vacation','leave','absence')),
	CONSTRAINT "chk_time_off_status" CHECK("employee_time_off"."status" IN ('pending','approved','rejected','cancelled')),
	CONSTRAINT "chk_time_off_dates" CHECK(
  length("employee_time_off"."from_date") = 10 AND "employee_time_off"."from_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("employee_time_off"."from_date", 1, 4) != '0000' AND date("employee_time_off"."from_date", '+0 days') IS NOT NULL
  AND date("employee_time_off"."from_date", '+0 days') = "employee_time_off"."from_date" AND
  length("employee_time_off"."until_date") = 10 AND "employee_time_off"."until_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("employee_time_off"."until_date", 1, 4) != '0000' AND date("employee_time_off"."until_date", '+0 days') IS NOT NULL
  AND date("employee_time_off"."until_date", '+0 days') = "employee_time_off"."until_date" AND julianday("employee_time_off"."until_date") - julianday("employee_time_off"."from_date") BETWEEN 1 AND 366),
	CONSTRAINT "chk_time_off_instants" CHECK(
  strftime('%Y-%m-%dT%H:%M:%fZ', "employee_time_off"."starts_at") IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', "employee_time_off"."starts_at") = "employee_time_off"."starts_at" AND
  strftime('%Y-%m-%dT%H:%M:%fZ', "employee_time_off"."ends_at") IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', "employee_time_off"."ends_at") = "employee_time_off"."ends_at" AND "employee_time_off"."ends_at" > "employee_time_off"."starts_at"),
	CONSTRAINT "chk_time_off_zone" CHECK(length(trim("employee_time_off"."time_zone")) BETWEEN 1 AND 100),
	CONSTRAINT "chk_time_off_version" CHECK(typeof("employee_time_off"."version") = 'integer' AND "employee_time_off"."version" >= 1),
	CONSTRAINT "chk_time_off_approval_pair" CHECK(("employee_time_off"."approved_by_user_id" IS NULL AND "employee_time_off"."approved_at" IS NULL) OR ("employee_time_off"."approved_by_user_id" IS NOT NULL AND "employee_time_off"."approved_at" IS NOT NULL AND
  strftime('%Y-%m-%dT%H:%M:%fZ', "employee_time_off"."approved_at") IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', "employee_time_off"."approved_at") = "employee_time_off"."approved_at")),
	CONSTRAINT "chk_time_off_approval_status" CHECK(("employee_time_off"."status" != 'approved' OR "employee_time_off"."approved_by_user_id" IS NOT NULL) AND ("employee_time_off"."status" NOT IN ('pending','rejected') OR "employee_time_off"."approved_by_user_id" IS NULL)),
	CONSTRAINT "chk_time_off_no_self_approval" CHECK("employee_time_off"."approved_by_user_id" IS NULL OR "employee_time_off"."approved_by_user_id" != "employee_time_off"."user_id")
);
--> statement-breakpoint
CREATE INDEX `idx_time_off_user_window` ON `employee_time_off` (`tenant_id`,`user_id`,`status`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `idx_time_off_created` ON `employee_time_off` (`tenant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_time_off_site_created` ON `employee_time_off` (`tenant_id`,`site_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `employee_time_off_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`request_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `employee_time_off`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_time_off_events_version" CHECK(typeof("employee_time_off_events"."version") = 'integer' AND "employee_time_off_events"."version" >= 1),
	CONSTRAINT "chk_time_off_events_kind" CHECK("employee_time_off_events"."kind" IN ('requested','approved','rejected','cancelled')),
	CONSTRAINT "chk_time_off_events_reason" CHECK(length(trim("employee_time_off_events"."reason")) BETWEEN 10 AND 500),
	CONSTRAINT "chk_time_off_events_json" CHECK(("employee_time_off_events"."before_json" IS NULL OR json_valid("employee_time_off_events"."before_json")) AND json_valid("employee_time_off_events"."after_json")),
	CONSTRAINT "chk_time_off_events_creation" CHECK(("employee_time_off_events"."kind" = 'requested' AND "employee_time_off_events"."version" = 1 AND "employee_time_off_events"."before_json" IS NULL) OR ("employee_time_off_events"."kind" != 'requested' AND "employee_time_off_events"."version" > 1 AND "employee_time_off_events"."before_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_time_off_events_version` ON `employee_time_off_events` (`tenant_id`,`request_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_time_off_events_operation` ON `employee_time_off_events` (`tenant_id`,`operation_id`);--> statement-breakpoint
-- Drizzle cannot express append-only private-evidence triggers.
CREATE TRIGGER IF NOT EXISTS employee_time_off_events_no_update BEFORE UPDATE ON employee_time_off_events BEGIN
  SELECT RAISE(ABORT,'TIME_OFF_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS employee_time_off_events_no_delete BEFORE DELETE ON employee_time_off_events BEGIN
  SELECT RAISE(ABORT,'TIME_OFF_EVENT_IMMUTABLE');
END;
