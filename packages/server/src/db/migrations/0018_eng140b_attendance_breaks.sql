CREATE TABLE `employee_shift_breaks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`employee_shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`started_by_user_id` text NOT NULL,
	`ended_by_user_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_shift_id`) REFERENCES `employee_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ended_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "employee_shift_breaks_end_consistent" CHECK(("employee_shift_breaks"."ended_at" IS NULL AND "employee_shift_breaks"."ended_by_user_id" IS NULL) OR ("employee_shift_breaks"."ended_at" > "employee_shift_breaks"."started_at" AND "employee_shift_breaks"."ended_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_employee_shift_breaks_tenant_shift_start` ON `employee_shift_breaks` (`tenant_id`,`employee_shift_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employee_shift_breaks_tenant_user_open` ON `employee_shift_breaks` (`tenant_id`,`user_id`) WHERE "employee_shift_breaks"."ended_at" IS NULL;
--> statement-breakpoint
-- ENG-140b — every break belongs to the same tenant and employee as its
-- attendance shift. Actor checks keep future manager corrections scoped too.
CREATE TRIGGER IF NOT EXISTS `employee_shift_breaks_tenant_scope_insert`
BEFORE INSERT ON `employee_shift_breaks`
WHEN NOT EXISTS (
	SELECT 1 FROM `employee_shifts`
	WHERE `id` = NEW.`employee_shift_id`
		AND `tenant_id` = NEW.`tenant_id`
		AND `user_id` = NEW.`user_id`
) OR NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `id` = NEW.`started_by_user_id` AND `tenant_id` = NEW.`tenant_id`
) OR (
	NEW.`ended_by_user_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `users`
		WHERE `id` = NEW.`ended_by_user_id` AND `tenant_id` = NEW.`tenant_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_BREAK_TENANT_SCOPE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `employee_shift_breaks_tenant_scope_update`
BEFORE UPDATE OF `tenant_id`, `employee_shift_id`, `user_id`, `started_by_user_id`, `ended_by_user_id` ON `employee_shift_breaks`
WHEN NOT EXISTS (
	SELECT 1 FROM `employee_shifts`
	WHERE `id` = NEW.`employee_shift_id`
		AND `tenant_id` = NEW.`tenant_id`
		AND `user_id` = NEW.`user_id`
) OR NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `id` = NEW.`started_by_user_id` AND `tenant_id` = NEW.`tenant_id`
) OR (
	NEW.`ended_by_user_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `users`
		WHERE `id` = NEW.`ended_by_user_id` AND `tenant_id` = NEW.`tenant_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_BREAK_TENANT_SCOPE');
END;--> statement-breakpoint
-- A break can only live inside its parent attendance interval. Active breaks
-- require an active parent; completed breaks remain valid historical evidence.
CREATE TRIGGER IF NOT EXISTS `employee_shift_breaks_interval_insert`
BEFORE INSERT ON `employee_shift_breaks`
WHEN EXISTS (
	SELECT 1 FROM `employee_shifts` WHERE `id` = NEW.`employee_shift_id`
) AND NOT EXISTS (
	SELECT 1 FROM `employee_shifts`
	WHERE `id` = NEW.`employee_shift_id`
		AND `tenant_id` = NEW.`tenant_id`
		AND `user_id` = NEW.`user_id`
		AND NEW.`started_at` >= `clocked_in_at`
		AND (
			(NEW.`ended_at` IS NULL AND `clocked_out_at` IS NULL)
			OR (
				NEW.`ended_at` IS NOT NULL
				AND (`clocked_out_at` IS NULL OR NEW.`ended_at` <= `clocked_out_at`)
			)
		)
)
BEGIN
	SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_BREAK_OUTSIDE_SHIFT');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `employee_shift_breaks_interval_update`
BEFORE UPDATE OF `tenant_id`, `employee_shift_id`, `user_id`, `started_at`, `ended_at` ON `employee_shift_breaks`
WHEN EXISTS (
	SELECT 1 FROM `employee_shifts` WHERE `id` = NEW.`employee_shift_id`
) AND NOT EXISTS (
	SELECT 1 FROM `employee_shifts`
	WHERE `id` = NEW.`employee_shift_id`
		AND `tenant_id` = NEW.`tenant_id`
		AND `user_id` = NEW.`user_id`
		AND NEW.`started_at` >= `clocked_in_at`
		AND (
			(NEW.`ended_at` IS NULL AND `clocked_out_at` IS NULL)
			OR (
				NEW.`ended_at` IS NOT NULL
				AND (`clocked_out_at` IS NULL OR NEW.`ended_at` <= `clocked_out_at`)
			)
		)
)
BEGIN
	SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_BREAK_OUTSIDE_SHIFT');
END;--> statement-breakpoint
-- Never fabricate a break end during clock-out. The employee must explicitly
-- end the break first, and this trigger keeps the invariant race-safe.
CREATE TRIGGER IF NOT EXISTS `employee_shifts_no_clock_out_on_break`
BEFORE UPDATE OF `clocked_out_at` ON `employee_shifts`
WHEN NEW.`clocked_out_at` IS NOT NULL AND EXISTS (
	SELECT 1 FROM `employee_shift_breaks`
	WHERE `tenant_id` = NEW.`tenant_id`
		AND `employee_shift_id` = NEW.`id`
		AND `ended_at` IS NULL
)
BEGIN
	SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_BREAK_ACTIVE');
END;--> statement-breakpoint
-- A completed break also bounds the earliest legal clock-out. This closes the
-- inverse parent-update path that child-table interval triggers cannot see.
CREATE TRIGGER IF NOT EXISTS `employee_shifts_clock_out_after_completed_breaks`
BEFORE UPDATE OF `clocked_out_at` ON `employee_shifts`
WHEN NEW.`clocked_out_at` IS NOT NULL AND EXISTS (
	SELECT 1 FROM `employee_shift_breaks`
	WHERE `tenant_id` = NEW.`tenant_id`
		AND `employee_shift_id` = NEW.`id`
		AND `ended_at` IS NOT NULL
		AND `ended_at` > NEW.`clocked_out_at`
)
BEGIN
	SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_BREAK_OUTSIDE_SHIFT');
END;
