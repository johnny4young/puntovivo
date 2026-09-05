CREATE TABLE `employee_schedule_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`user_id` text NOT NULL,
	`start_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_date` text NOT NULL,
	`end_time` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`notes` text,
	`published_shift_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_shift_id`) REFERENCES `scheduled_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`plan_id`) REFERENCES `employee_schedule_plans`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_schedule_occurrence_instants" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',"employee_schedule_occurrences"."starts_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',"employee_schedule_occurrences"."starts_at")="employee_schedule_occurrences"."starts_at" AND strftime('%Y-%m-%dT%H:%M:%fZ',"employee_schedule_occurrences"."ends_at") IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',"employee_schedule_occurrences"."ends_at")="employee_schedule_occurrences"."ends_at" AND "employee_schedule_occurrences"."ends_at">"employee_schedule_occurrences"."starts_at" AND unixepoch("employee_schedule_occurrences"."ends_at")-unixepoch("employee_schedule_occurrences"."starts_at")<=86400),
	CONSTRAINT "chk_schedule_occurrence_notes" CHECK("employee_schedule_occurrences"."notes" IS NULL OR length("employee_schedule_occurrences"."notes")<=500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_schedule_occurrences_rule_date` ON `employee_schedule_occurrences` (`tenant_id`,`plan_id`,`rule_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `idx_schedule_occurrences_plan_id` ON `employee_schedule_occurrences` (`tenant_id`,`plan_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_occurrences_user` ON `employee_schedule_occurrences` (`tenant_id`,`user_id`,`plan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_schedule_occurrences_shift` ON `employee_schedule_occurrences` (`published_shift_id`) WHERE "employee_schedule_occurrences"."published_shift_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `employee_schedule_plan_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text,
	`snapshot_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`plan_id`) REFERENCES `employee_schedule_plans`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_schedule_plan_event_version" CHECK(typeof("employee_schedule_plan_events"."version")='integer' AND "employee_schedule_plan_events"."version">=1),
	CONSTRAINT "chk_schedule_plan_event_kind" CHECK("employee_schedule_plan_events"."kind" IN ('created','regenerated','published','discarded')),
	CONSTRAINT "chk_schedule_plan_event_reason" CHECK(("employee_schedule_plan_events"."kind" IN ('created','published') AND "employee_schedule_plan_events"."reason" IS NULL) OR ("employee_schedule_plan_events"."kind" IN ('regenerated','discarded') AND "employee_schedule_plan_events"."reason" IS NOT NULL AND length(trim("employee_schedule_plan_events"."reason")) BETWEEN 10 AND 500)),
	CONSTRAINT "chk_schedule_plan_event_snapshot" CHECK(json_valid("employee_schedule_plan_events"."snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_schedule_plan_events_version` ON `employee_schedule_plan_events` (`tenant_id`,`plan_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_schedule_plan_events_operation` ON `employee_schedule_plan_events` (`tenant_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `employee_schedule_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`title` text NOT NULL,
	`from_date` text NOT NULL,
	`until_date` text NOT NULL,
	`anchor_week_start` text NOT NULL,
	`time_zone` text NOT NULL,
	`rules_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`occurrence_count` integer NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`decided_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_schedule_plan_state" CHECK(("employee_schedule_plans"."status"='draft' AND "employee_schedule_plans"."decided_at" IS NULL) OR ("employee_schedule_plans"."status" IN ('published','discarded') AND "employee_schedule_plans"."decided_at" IS NOT NULL)),
	CONSTRAINT "chk_schedule_plan_version" CHECK(typeof("employee_schedule_plans"."version")='integer' AND "employee_schedule_plans"."version">=1),
	CONSTRAINT "chk_schedule_plan_count" CHECK(typeof("employee_schedule_plans"."occurrence_count")='integer' AND "employee_schedule_plans"."occurrence_count" BETWEEN 1 AND 1000),
	CONSTRAINT "chk_schedule_plan_title" CHECK(length(trim("employee_schedule_plans"."title")) BETWEEN 1 AND 100),
	CONSTRAINT "chk_schedule_plan_zone" CHECK(length(trim("employee_schedule_plans"."time_zone")) BETWEEN 1 AND 100),
	CONSTRAINT "chk_schedule_plan_dates" CHECK(length("employee_schedule_plans"."from_date")=10 AND substr("employee_schedule_plans"."from_date",1,4)!='0000' AND date("employee_schedule_plans"."from_date",'+0 days') IS NOT NULL AND date("employee_schedule_plans"."from_date",'+0 days')="employee_schedule_plans"."from_date" AND length("employee_schedule_plans"."until_date")=10 AND date("employee_schedule_plans"."until_date",'+0 days') IS NOT NULL AND date("employee_schedule_plans"."until_date",'+0 days')="employee_schedule_plans"."until_date" AND julianday("employee_schedule_plans"."until_date")-julianday("employee_schedule_plans"."from_date") BETWEEN 1 AND 31 AND length("employee_schedule_plans"."anchor_week_start")=10 AND substr("employee_schedule_plans"."anchor_week_start",1,4)!='0000' AND date("employee_schedule_plans"."anchor_week_start",'+0 days') IS NOT NULL AND date("employee_schedule_plans"."anchor_week_start",'+0 days')="employee_schedule_plans"."anchor_week_start" AND strftime('%w',"employee_schedule_plans"."anchor_week_start")='1' AND "employee_schedule_plans"."anchor_week_start"<="employee_schedule_plans"."from_date"),
	CONSTRAINT "chk_schedule_plan_rules" CHECK(CASE WHEN json_valid("employee_schedule_plans"."rules_json") THEN json_type("employee_schedule_plans"."rules_json")='array' AND json_array_length("employee_schedule_plans"."rules_json") BETWEEN 1 AND 100 ELSE 0 END)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_schedule_plans_tenant_id` ON `employee_schedule_plans` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_plans_site_created` ON `employee_schedule_plans` (`tenant_id`,`site_id`,`created_at`,`id`);--> statement-breakpoint
-- Drizzle cannot express these aggregate transition and immutable-evidence triggers.
CREATE TRIGGER IF NOT EXISTS schedule_plans_insert_guard BEFORE INSERT ON employee_schedule_plans BEGIN
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_STATE_INVALID') WHERE NEW.status!='draft' OR NEW.version!=1 OR NEW.decided_at IS NOT NULL;
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_SCOPE_INVALID') WHERE NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by_user_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.updated_by_user_id AND tenant_id=NEW.tenant_id);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS schedule_plans_update_guard BEFORE UPDATE ON employee_schedule_plans BEGIN
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_IMMUTABLE') WHERE OLD.status!='draft' OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.time_zone IS NOT OLD.time_zone;
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_STATE_INVALID') WHERE NEW.version!=OLD.version+1;
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_SCOPE_INVALID') WHERE NOT EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.updated_by_user_id AND tenant_id=NEW.tenant_id);
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_CHANGED') WHERE NEW.status!='draft' AND (NEW.site_id IS NOT OLD.site_id OR NEW.title IS NOT OLD.title OR NEW.from_date IS NOT OLD.from_date OR NEW.until_date IS NOT OLD.until_date OR NEW.anchor_week_start IS NOT OLD.anchor_week_start OR NEW.rules_json IS NOT OLD.rules_json OR NEW.occurrence_count IS NOT OLD.occurrence_count);
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_INCOMPLETE') WHERE NEW.status IN ('published','discarded') AND (SELECT count(*) FROM employee_schedule_occurrences WHERE tenant_id=NEW.tenant_id AND plan_id=NEW.id)!=NEW.occurrence_count;
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_INCOMPLETE') WHERE NEW.status='published' AND EXISTS(SELECT 1 FROM employee_schedule_occurrences o WHERE o.tenant_id=NEW.tenant_id AND o.plan_id=NEW.id AND NOT EXISTS(SELECT 1 FROM scheduled_shifts s WHERE s.id=o.published_shift_id AND s.tenant_id=NEW.tenant_id AND s.user_id=o.user_id AND s.site_id=NEW.site_id AND s.starts_at=o.starts_at AND s.ends_at=o.ends_at AND s.time_zone=NEW.time_zone AND s.notes IS o.notes AND s.status='scheduled'));
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_STATE_INVALID') WHERE NEW.status='discarded' AND EXISTS(SELECT 1 FROM employee_schedule_occurrences WHERE tenant_id=NEW.tenant_id AND plan_id=NEW.id AND published_shift_id IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS schedule_plans_no_delete BEFORE DELETE ON employee_schedule_plans BEGIN SELECT RAISE(ABORT,'SCHEDULE_PLAN_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS schedule_occurrences_insert_guard BEFORE INSERT ON employee_schedule_occurrences BEGIN
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_STATE_INVALID') WHERE NEW.published_shift_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM employee_schedule_plans p WHERE p.id=NEW.plan_id AND p.tenant_id=NEW.tenant_id AND p.status='draft' AND NEW.start_date>=p.from_date AND NEW.start_date<p.until_date);
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_SCOPE_INVALID') WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND tenant_id=NEW.tenant_id);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS schedule_occurrences_update_guard BEFORE UPDATE ON employee_schedule_occurrences BEGIN
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_IMMUTABLE') WHERE NOT EXISTS(SELECT 1 FROM employee_schedule_plans WHERE id=OLD.plan_id AND tenant_id=OLD.tenant_id AND status='draft') OR OLD.published_shift_id IS NOT NULL OR NEW.published_shift_id IS NULL OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.plan_id IS NOT OLD.plan_id OR NEW.rule_id IS NOT OLD.rule_id OR NEW.user_id IS NOT OLD.user_id OR NEW.start_date IS NOT OLD.start_date OR NEW.start_time IS NOT OLD.start_time OR NEW.end_date IS NOT OLD.end_date OR NEW.end_time IS NOT OLD.end_time OR NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at OR NEW.notes IS NOT OLD.notes;
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_LINK_INVALID') WHERE NOT EXISTS(SELECT 1 FROM scheduled_shifts s JOIN employee_schedule_plans p ON p.id=NEW.plan_id AND p.tenant_id=NEW.tenant_id WHERE s.id=NEW.published_shift_id AND s.tenant_id=NEW.tenant_id AND s.user_id=NEW.user_id AND s.site_id=p.site_id AND s.starts_at=NEW.starts_at AND s.ends_at=NEW.ends_at AND s.time_zone=p.time_zone AND s.notes IS NEW.notes AND s.status='scheduled');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS schedule_occurrences_delete_guard BEFORE DELETE ON employee_schedule_occurrences WHEN NOT EXISTS(SELECT 1 FROM employee_schedule_plans WHERE id=OLD.plan_id AND tenant_id=OLD.tenant_id AND status='draft') BEGIN SELECT RAISE(ABORT,'SCHEDULE_PLAN_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS schedule_plan_events_no_update BEFORE UPDATE ON employee_schedule_plan_events BEGIN SELECT RAISE(ABORT,'SCHEDULE_PLAN_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS schedule_plan_events_no_delete BEFORE DELETE ON employee_schedule_plan_events BEGIN SELECT RAISE(ABORT,'SCHEDULE_PLAN_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS schedule_plan_events_insert_guard BEFORE INSERT ON employee_schedule_plan_events BEGIN
  -- Attribution must match the tenant-owned actor who performed this exact aggregate transition.
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_EVENT_INVALID') WHERE NOT EXISTS(SELECT 1 FROM employee_schedule_plans p JOIN users u ON u.id=NEW.actor_id AND u.tenant_id=NEW.tenant_id WHERE p.id=NEW.plan_id AND p.tenant_id=NEW.tenant_id AND p.updated_by_user_id=NEW.actor_id);
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_EVENT_INVALID') WHERE NOT EXISTS(SELECT 1 FROM employee_schedule_plans p WHERE p.id=NEW.plan_id AND p.tenant_id=NEW.tenant_id AND p.version=NEW.version AND ((NEW.kind='created' AND p.status='draft' AND p.version=1) OR (NEW.kind='regenerated' AND p.status='draft' AND p.version>1) OR (NEW.kind='published' AND p.status='published') OR (NEW.kind='discarded' AND p.status='discarded')));
  SELECT RAISE(ABORT,'SCHEDULE_PLAN_EVENT_INVALID') WHERE json_extract(NEW.snapshot_json,'$.plan.id') IS NOT NEW.plan_id OR json_extract(NEW.snapshot_json,'$.plan.tenantId') IS NOT NEW.tenant_id OR json_extract(NEW.snapshot_json,'$.plan.version') IS NOT NEW.version OR json_array_length(NEW.snapshot_json,'$.occurrences') IS NOT (SELECT occurrence_count FROM employee_schedule_plans WHERE id=NEW.plan_id AND tenant_id=NEW.tenant_id);
END;
