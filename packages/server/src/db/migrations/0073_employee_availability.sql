CREATE TABLE `employee_availability` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`from_date` text NOT NULL,
	`until_date` text,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`time_zone` text NOT NULL,
	`slots_json` text NOT NULL,
	`replaces_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replaces_id`) REFERENCES `employee_availability`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_availability_status" CHECK("employee_availability"."status" IN ('active','voided')),
	CONSTRAINT "chk_availability_version" CHECK(typeof("employee_availability"."version")='integer' AND "employee_availability"."version">=1),
	CONSTRAINT "chk_availability_dates" CHECK(length("employee_availability"."from_date")=10 AND substr("employee_availability"."from_date",1,4)!='0000' AND date("employee_availability"."from_date",'+0 days') IS NOT NULL AND date("employee_availability"."from_date",'+0 days')="employee_availability"."from_date" AND ("employee_availability"."until_date" IS NULL OR (length("employee_availability"."until_date")=10 AND date("employee_availability"."until_date",'+0 days') IS NOT NULL AND date("employee_availability"."until_date",'+0 days')="employee_availability"."until_date" AND "employee_availability"."until_date">"employee_availability"."from_date"))),
	CONSTRAINT "chk_availability_instants" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',"employee_availability"."starts_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',"employee_availability"."starts_at")="employee_availability"."starts_at" AND (("employee_availability"."ends_at" IS NULL AND "employee_availability"."until_date" IS NULL) OR ("employee_availability"."ends_at" IS NOT NULL AND "employee_availability"."until_date" IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',"employee_availability"."ends_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',"employee_availability"."ends_at")="employee_availability"."ends_at" AND "employee_availability"."ends_at">"employee_availability"."starts_at"))),
	CONSTRAINT "chk_availability_zone" CHECK(length(trim("employee_availability"."time_zone")) BETWEEN 1 AND 100),
	CONSTRAINT "chk_availability_slots" CHECK(CASE WHEN json_valid("employee_availability"."slots_json") THEN json_type("employee_availability"."slots_json")='array' AND json_array_length("employee_availability"."slots_json")<=56 ELSE 0 END)
);
--> statement-breakpoint
CREATE INDEX `idx_availability_user_window` ON `employee_availability` (`tenant_id`,`user_id`,`status`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `idx_availability_created` ON `employee_availability` (`tenant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `employee_availability_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`availability_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`availability_id`) REFERENCES `employee_availability`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_availability_event_version" CHECK(typeof("employee_availability_events"."version")='integer' AND "employee_availability_events"."version">=1),
	CONSTRAINT "chk_availability_event_kind" CHECK("employee_availability_events"."kind" IN ('created','ended','voided')),
	CONSTRAINT "chk_availability_event_reason" CHECK(length(trim("employee_availability_events"."reason")) BETWEEN 10 AND 500),
	CONSTRAINT "chk_availability_event_json" CHECK(("employee_availability_events"."before_json" IS NULL OR json_valid("employee_availability_events"."before_json")) AND json_valid("employee_availability_events"."after_json")),
	CONSTRAINT "chk_availability_event_creation" CHECK(("employee_availability_events"."kind"='created' AND "employee_availability_events"."version"=1 AND "employee_availability_events"."before_json" IS NULL) OR ("employee_availability_events"."kind"!='created' AND "employee_availability_events"."version">1 AND "employee_availability_events"."before_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_availability_event_version` ON `employee_availability_events` (`tenant_id`,`availability_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_availability_event_operation` ON `employee_availability_events` (`tenant_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_shifts_employee_status_id` ON `scheduled_shifts` (`tenant_id`,`user_id`,`status`,`id`);--> statement-breakpoint
-- Drizzle cannot express append-only private-evidence triggers.
CREATE TRIGGER IF NOT EXISTS employee_availability_events_no_update BEFORE UPDATE ON employee_availability_events BEGIN
  SELECT RAISE(ABORT,'AVAILABILITY_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS employee_availability_events_no_delete BEFORE DELETE ON employee_availability_events BEGIN
  SELECT RAISE(ABORT,'AVAILABILITY_EVENT_IMMUTABLE');
END;
