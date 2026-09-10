CREATE TABLE `employee_shift_reconciliation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`reconciliation_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `employee_shift_reconciliations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_employee_shift_reconciliation_events_version" CHECK(typeof("employee_shift_reconciliation_events"."version") = 'integer' AND "employee_shift_reconciliation_events"."version" BETWEEN 1 AND 9007199254740990),
	CONSTRAINT "chk_employee_shift_reconciliation_events_reason" CHECK(length(trim("employee_shift_reconciliation_events"."reason")) BETWEEN 10 AND 500),
	CONSTRAINT "chk_employee_shift_reconciliation_events_json" CHECK(("employee_shift_reconciliation_events"."before_json" IS NULL OR json_valid("employee_shift_reconciliation_events"."before_json")) AND json_valid("employee_shift_reconciliation_events"."after_json")),
	CONSTRAINT "chk_employee_shift_reconciliation_events_kind" CHECK(("employee_shift_reconciliation_events"."kind" = 'created' AND "employee_shift_reconciliation_events"."version" = 1 AND "employee_shift_reconciliation_events"."before_json" IS NULL) OR ("employee_shift_reconciliation_events"."kind" = 'revised' AND "employee_shift_reconciliation_events"."version" > 1 AND "employee_shift_reconciliation_events"."before_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employee_shift_reconciliation_events_version` ON `employee_shift_reconciliation_events` (`tenant_id`,`reconciliation_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_employee_shift_reconciliation_events_operation` ON `employee_shift_reconciliation_events` (`tenant_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `employee_shift_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`scheduled_shift_id` text NOT NULL,
	`employee_shift_id` text,
	`outcome` text NOT NULL,
	`scheduled_shift_version` integer NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`planned_starts_at` text NOT NULL,
	`planned_ends_at` text NOT NULL,
	`planned_time_zone` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scheduled_shift_id`) REFERENCES `scheduled_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_shift_id`) REFERENCES `employee_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_employee_shift_reconciliations_outcome" CHECK(("employee_shift_reconciliations"."outcome" = 'attended' AND "employee_shift_reconciliations"."employee_shift_id" IS NOT NULL) OR ("employee_shift_reconciliations"."outcome" = 'no_show' AND "employee_shift_reconciliations"."employee_shift_id" IS NULL)),
	CONSTRAINT "chk_employee_shift_reconciliations_versions" CHECK(typeof("employee_shift_reconciliations"."version") = 'integer' AND "employee_shift_reconciliations"."version" BETWEEN 1 AND 9007199254740990 AND typeof("employee_shift_reconciliations"."scheduled_shift_version") = 'integer' AND "employee_shift_reconciliations"."scheduled_shift_version" BETWEEN 1 AND 9007199254740990),
	CONSTRAINT "chk_employee_shift_reconciliations_duration" CHECK("employee_shift_reconciliations"."planned_ends_at" > "employee_shift_reconciliations"."planned_starts_at"),
	CONSTRAINT "chk_employee_shift_reconciliations_timezone" CHECK(length(trim("employee_shift_reconciliations"."planned_time_zone")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employee_shift_reconciliations_schedule` ON `employee_shift_reconciliations` (`tenant_id`,`scheduled_shift_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employee_shift_reconciliations_attendance` ON `employee_shift_reconciliations` (`tenant_id`,`employee_shift_id`) WHERE "employee_shift_reconciliations"."employee_shift_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_employee_shift_reconciliations_user_plan` ON `employee_shift_reconciliations` (`tenant_id`,`user_id`,`planned_starts_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_employee_shift_reconciliations_site_plan` ON `employee_shift_reconciliations` (`tenant_id`,`site_id`,`planned_starts_at`,`id`);--> statement-breakpoint
-- Drizzle cannot express cross-table frozen-snapshot and append-only evidence guards.
CREATE TRIGGER IF NOT EXISTS employee_shift_reconciliations_insert_guard BEFORE INSERT ON employee_shift_reconciliations BEGIN
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_PLAN_INVALID') WHERE NOT EXISTS(
    SELECT 1 FROM scheduled_shifts s
    WHERE s.id=NEW.scheduled_shift_id AND s.tenant_id=NEW.tenant_id
      AND s.status='scheduled' AND s.version=NEW.scheduled_shift_version
      AND s.user_id=NEW.user_id AND s.site_id=NEW.site_id
      AND s.starts_at=NEW.planned_starts_at AND s.ends_at=NEW.planned_ends_at
      AND s.time_zone=NEW.planned_time_zone
  );
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_ACTOR_INVALID') WHERE NOT EXISTS(
    SELECT 1 FROM users creator JOIN users updater
      ON updater.id=NEW.updated_by_user_id AND updater.tenant_id=NEW.tenant_id
    WHERE creator.id=NEW.created_by_user_id AND creator.tenant_id=NEW.tenant_id
  );
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_ATTENDANCE_INVALID')
    WHERE NEW.employee_shift_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM employee_shifts a
      WHERE a.id=NEW.employee_shift_id AND a.tenant_id=NEW.tenant_id AND a.user_id=NEW.user_id
    );
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS employee_shift_reconciliations_update_guard BEFORE UPDATE ON employee_shift_reconciliations BEGIN
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_SNAPSHOT_IMMUTABLE') WHERE
    NEW.id!=OLD.id OR NEW.tenant_id!=OLD.tenant_id OR NEW.scheduled_shift_id!=OLD.scheduled_shift_id
    OR NEW.scheduled_shift_version!=OLD.scheduled_shift_version OR NEW.user_id!=OLD.user_id
    OR NEW.site_id!=OLD.site_id OR NEW.planned_starts_at!=OLD.planned_starts_at
    OR NEW.planned_ends_at!=OLD.planned_ends_at OR NEW.planned_time_zone!=OLD.planned_time_zone
    OR NEW.created_by_user_id!=OLD.created_by_user_id OR NEW.created_at!=OLD.created_at;
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_VERSION_INVALID') WHERE NEW.version!=OLD.version+1;
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_ACTOR_INVALID') WHERE NOT EXISTS(
    SELECT 1 FROM users u WHERE u.id=NEW.updated_by_user_id AND u.tenant_id=NEW.tenant_id
  );
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_ATTENDANCE_INVALID')
    WHERE NEW.employee_shift_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM employee_shifts a
      WHERE a.id=NEW.employee_shift_id AND a.tenant_id=NEW.tenant_id AND a.user_id=NEW.user_id
    );
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS employee_shift_reconciliations_no_delete BEFORE DELETE ON employee_shift_reconciliations BEGIN
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS employee_shift_reconciliation_events_insert_guard BEFORE INSERT ON employee_shift_reconciliation_events BEGIN
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_EVENT_INVALID') WHERE NOT EXISTS(
    SELECT 1 FROM employee_shift_reconciliations r JOIN users u
      ON u.id=NEW.actor_id AND u.tenant_id=NEW.tenant_id
    WHERE r.id=NEW.reconciliation_id AND r.tenant_id=NEW.tenant_id
      AND r.version=NEW.version AND r.updated_by_user_id=NEW.actor_id
      AND json_extract(NEW.after_json,'$.scheduledShiftId') IS r.scheduled_shift_id
      AND json_extract(NEW.after_json,'$.employeeShiftId') IS r.employee_shift_id
      AND json_extract(NEW.after_json,'$.outcome') IS r.outcome
      AND json_extract(NEW.after_json,'$.scheduledShiftVersion') IS r.scheduled_shift_version
      AND json_extract(NEW.after_json,'$.userId') IS r.user_id
      AND json_extract(NEW.after_json,'$.siteId') IS r.site_id
      AND json_extract(NEW.after_json,'$.plannedStartsAt') IS r.planned_starts_at
      AND json_extract(NEW.after_json,'$.plannedEndsAt') IS r.planned_ends_at
      AND json_extract(NEW.after_json,'$.plannedTimeZone') IS r.planned_time_zone
      AND json_extract(NEW.after_json,'$.version') IS r.version
  );
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS employee_shift_reconciliation_events_no_update BEFORE UPDATE ON employee_shift_reconciliation_events BEGIN
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_EVENT_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS employee_shift_reconciliation_events_no_delete BEFORE DELETE ON employee_shift_reconciliation_events BEGIN
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_EVENT_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS scheduled_shifts_reconciliation_history_update_guard BEFORE UPDATE ON scheduled_shifts WHEN EXISTS(
  SELECT 1 FROM employee_shift_reconciliations r WHERE r.tenant_id=OLD.tenant_id AND r.scheduled_shift_id=OLD.id
) BEGIN
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_PLAN_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS scheduled_shifts_reconciliation_history_delete_guard BEFORE DELETE ON scheduled_shifts WHEN EXISTS(
  SELECT 1 FROM employee_shift_reconciliations r WHERE r.tenant_id=OLD.tenant_id AND r.scheduled_shift_id=OLD.id
) BEGIN
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_PLAN_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS employee_shifts_reconciliation_identity_update_guard BEFORE UPDATE OF tenant_id,user_id ON employee_shifts WHEN EXISTS(
  SELECT 1 FROM employee_shift_reconciliations r WHERE r.tenant_id=OLD.tenant_id AND r.employee_shift_id=OLD.id
) BEGIN
  SELECT RAISE(ABORT,'ATTENDANCE_RECONCILIATION_ATTENDANCE_IMMUTABLE');
END;
