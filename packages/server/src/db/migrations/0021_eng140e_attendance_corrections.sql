CREATE TABLE `employee_shift_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`employee_shift_id` text NOT NULL,
	`version` integer NOT NULL,
	`clocked_in_at` text NOT NULL,
	`clocked_out_at` text NOT NULL,
	`breaks_json` text NOT NULL,
	`reason` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_shift_id`) REFERENCES `employee_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "employee_shift_corrections_version_positive" CHECK("employee_shift_corrections"."version" >= 1),
	CONSTRAINT "employee_shift_corrections_positive_duration" CHECK("employee_shift_corrections"."clocked_out_at" > "employee_shift_corrections"."clocked_in_at"),
	CONSTRAINT "employee_shift_corrections_reason_length" CHECK(length(trim("employee_shift_corrections"."reason")) BETWEEN 10 AND 500),
	CONSTRAINT "employee_shift_corrections_breaks_json" CHECK(json_valid("employee_shift_corrections"."breaks_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employee_shift_corrections_tenant_shift_version` ON `employee_shift_corrections` (`tenant_id`,`employee_shift_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_employee_shift_corrections_tenant_effective_start` ON `employee_shift_corrections` (`tenant_id`,`clocked_in_at`);--> statement-breakpoint
-- ENG-140e — correction snapshots are scoped to one closed shift and an
-- author in the same tenant. Raw attendance and break rows remain untouched.
CREATE TRIGGER IF NOT EXISTS `employee_shift_corrections_scope_insert`
BEFORE INSERT ON `employee_shift_corrections`
WHEN NOT EXISTS (
  SELECT 1 FROM `employee_shifts`
  WHERE `id` = NEW.`employee_shift_id`
    AND `tenant_id` = NEW.`tenant_id`
    AND `clocked_out_at` IS NOT NULL
) OR NOT EXISTS (
  SELECT 1 FROM `users`
  WHERE `id` = NEW.`created_by_user_id`
    AND `tenant_id` = NEW.`tenant_id`
)
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_CORRECTION_SCOPE');
END;--> statement-breakpoint
-- Every append must be the next monotonic version. The immediate application
-- transaction gives a friendly stale-version error; this trigger is the
-- direct-SQL and race-safe defense.
CREATE TRIGGER IF NOT EXISTS `employee_shift_corrections_version_insert`
BEFORE INSERT ON `employee_shift_corrections`
WHEN NEW.`version` != COALESCE((
  SELECT MAX(`version`) FROM `employee_shift_corrections`
  WHERE `tenant_id` = NEW.`tenant_id`
    AND `employee_shift_id` = NEW.`employee_shift_id`
), 0) + 1
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_CORRECTION_VERSION');
END;--> statement-breakpoint
-- The JSON snapshot is deliberately validated at the database boundary: each
-- break is a complete positive interval inside the corrected shift, ids are
-- unique, and effective breaks cannot overlap.
CREATE TRIGGER IF NOT EXISTS `employee_shift_corrections_breaks_insert`
BEFORE INSERT ON `employee_shift_corrections`
WHEN json_type(NEW.`breaks_json`) IS NOT 'array'
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.`breaks_json`) AS item
    WHERE json_type(item.value) IS NOT 'object'
      OR json_type(item.value, '$.id') IS NOT 'text'
      OR length(trim(json_extract(item.value, '$.id'))) = 0
      OR json_type(item.value, '$.startedAt') IS NOT 'text'
      OR json_type(item.value, '$.endedAt') IS NOT 'text'
      OR json_extract(item.value, '$.startedAt') < NEW.`clocked_in_at`
      OR json_extract(item.value, '$.endedAt') > NEW.`clocked_out_at`
      OR json_extract(item.value, '$.endedAt') <= json_extract(item.value, '$.startedAt')
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.`breaks_json`) AS left_item
    JOIN json_each(NEW.`breaks_json`) AS right_item
      ON CAST(left_item.key AS integer) < CAST(right_item.key AS integer)
    WHERE json_extract(left_item.value, '$.id') = json_extract(right_item.value, '$.id')
      OR (
        json_extract(left_item.value, '$.startedAt') < json_extract(right_item.value, '$.endedAt')
        AND json_extract(left_item.value, '$.endedAt') > json_extract(right_item.value, '$.startedAt')
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_CORRECTION_BREAKS_INVALID');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `employee_shift_corrections_no_update`
BEFORE UPDATE ON `employee_shift_corrections`
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_CORRECTION_IMMUTABLE');
END;
