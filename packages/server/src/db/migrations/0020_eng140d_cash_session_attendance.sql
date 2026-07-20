ALTER TABLE `cash_sessions` ADD `employee_shift_id` text REFERENCES employee_shifts(id);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_tenant_employee_shift` ON `cash_sessions` (`tenant_id`,`employee_shift_id`);--> statement-breakpoint
--  — a linked drawer and employee shift always share tenant, user,
-- and site. Historical rows may keep a null link; new application opens do not.
CREATE TRIGGER IF NOT EXISTS `cash_sessions_employee_shift_scope_insert`
BEFORE INSERT ON `cash_sessions`
WHEN NEW.`employee_shift_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `employee_shifts`
	WHERE `id` = NEW.`employee_shift_id`
		AND `tenant_id` = NEW.`tenant_id`
		AND `user_id` = NEW.`cashier_id`
		AND `site_id` = NEW.`site_id`
)
BEGIN
	SELECT RAISE(ABORT, 'CASH_SESSION_EMPLOYEE_SHIFT_SCOPE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cash_sessions_employee_shift_scope_update`
BEFORE UPDATE OF `tenant_id`, `site_id`, `cashier_id`, `employee_shift_id` ON `cash_sessions`
WHEN NEW.`employee_shift_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `employee_shifts`
	WHERE `id` = NEW.`employee_shift_id`
		AND `tenant_id` = NEW.`tenant_id`
		AND `user_id` = NEW.`cashier_id`
		AND `site_id` = NEW.`site_id`
)
BEGIN
	SELECT RAISE(ABORT, 'CASH_SESSION_EMPLOYEE_SHIFT_SCOPE');
END;--> statement-breakpoint
-- An open drawer cannot attach to completed attendance or an active break.
CREATE TRIGGER IF NOT EXISTS `cash_sessions_employee_shift_active_insert`
BEFORE INSERT ON `cash_sessions`
WHEN NEW.`employee_shift_id` IS NOT NULL AND NEW.`status` = 'open' AND (
	NOT EXISTS (
		SELECT 1 FROM `employee_shifts`
		WHERE `id` = NEW.`employee_shift_id` AND `clocked_out_at` IS NULL
	) OR EXISTS (
		SELECT 1 FROM `employee_shift_breaks`
		WHERE `employee_shift_id` = NEW.`employee_shift_id` AND `ended_at` IS NULL
	)
)
BEGIN
	SELECT RAISE(ABORT, 'CASH_SESSION_EMPLOYEE_SHIFT_INACTIVE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cash_sessions_employee_shift_active_update`
BEFORE UPDATE OF `employee_shift_id`, `status` ON `cash_sessions`
WHEN NEW.`employee_shift_id` IS NOT NULL AND NEW.`status` = 'open' AND (
	NOT EXISTS (
		SELECT 1 FROM `employee_shifts`
		WHERE `id` = NEW.`employee_shift_id` AND `clocked_out_at` IS NULL
	) OR EXISTS (
		SELECT 1 FROM `employee_shift_breaks`
		WHERE `employee_shift_id` = NEW.`employee_shift_id` AND `ended_at` IS NULL
	)
)
BEGIN
	SELECT RAISE(ABORT, 'CASH_SESSION_EMPLOYEE_SHIFT_INACTIVE');
END;--> statement-breakpoint
-- Cash reconciliation may finish before paid work, but the drawer must close
-- first. The explicit later clock-out preserves cleaning and handoff time.
CREATE TRIGGER IF NOT EXISTS `employee_shifts_no_clock_out_on_cash_session`
BEFORE UPDATE OF `clocked_out_at` ON `employee_shifts`
WHEN NEW.`clocked_out_at` IS NOT NULL AND EXISTS (
	SELECT 1 FROM `cash_sessions`
	WHERE `tenant_id` = NEW.`tenant_id`
		AND (
			`employee_shift_id` = NEW.`id`
			OR (`employee_shift_id` IS NULL AND `cashier_id` = NEW.`user_id`)
		)
		AND `status` = 'open'
)
BEGIN
	SELECT RAISE(ABORT, 'EMPLOYEE_SHIFT_CASH_SESSION_OPEN');
END;
