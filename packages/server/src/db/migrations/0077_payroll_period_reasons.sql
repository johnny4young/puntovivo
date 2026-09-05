PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- Partial pre-production adoption fixtures can legitimately lack unrelated base
-- tables referenced by triggers created in 0076. This rename only promotes the
-- new period table and must not force SQLite to reparse every unrelated trigger.
PRAGMA legacy_alter_table=ON;--> statement-breakpoint
CREATE TABLE `__new_payroll_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`country_code` text NOT NULL,
	`frequency` text NOT NULL,
	`from_date` text NOT NULL,
	`until_date` text NOT NULL,
	`pay_date` text NOT NULL,
	`currency_code` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_reason` text NOT NULL,
	`closed_reason` text,
	`created_by_user_id` text NOT NULL,
	`closed_by_user_id` text,
	`closed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_periods_country" CHECK("country_code" = 'CO'),
	CONSTRAINT "chk_payroll_periods_frequency" CHECK("frequency" IN ('weekly','biweekly','semimonthly','monthly','other')),
	CONSTRAINT "chk_payroll_periods_dates" CHECK(
  length("from_date") = 10
  AND "from_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("from_date", 1, 4) != '0000'
  AND date("from_date", '+0 days') IS NOT NULL
  AND date("from_date", '+0 days') = "from_date" AND
  length("until_date") = 10
  AND "until_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("until_date", 1, 4) != '0000'
  AND date("until_date", '+0 days') IS NOT NULL
  AND date("until_date", '+0 days') = "until_date" AND
  length("pay_date") = 10
  AND "pay_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("pay_date", 1, 4) != '0000'
  AND date("pay_date", '+0 days') IS NOT NULL
  AND date("pay_date", '+0 days') = "pay_date" AND "until_date" > "from_date" AND julianday("until_date") - julianday("from_date") BETWEEN 1 AND 31 AND "pay_date" >= "from_date"),
	CONSTRAINT "chk_payroll_periods_state" CHECK(("status" = 'open' AND "closed_by_user_id" IS NULL AND "closed_at" IS NULL AND "closed_reason" IS NULL) OR ("status" = 'closed' AND "closed_by_user_id" IS NOT NULL AND "closed_at" IS NOT NULL AND
  strftime('%Y-%m-%dT%H:%M:%fZ', "closed_at") IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', "closed_at") = "closed_at" AND "closed_reason" IS NOT NULL)),
	CONSTRAINT "chk_payroll_periods_reasons" CHECK(length(trim("created_reason")) BETWEEN 10 AND 500 AND ("closed_reason" IS NULL OR length(trim("closed_reason")) BETWEEN 10 AND 500)),
	CONSTRAINT "chk_payroll_periods_version" CHECK(typeof("version") = 'integer' AND "version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_payroll_periods`("id", "tenant_id", "country_code", "frequency", "from_date", "until_date", "pay_date", "currency_code", "status", "version", "created_reason", "closed_reason", "created_by_user_id", "closed_by_user_id", "closed_at", "created_at", "updated_at")
SELECT "id", "tenant_id", "country_code", "frequency", "from_date", "until_date", "pay_date", "currency_code", "status", "version",
  'Migrated payroll period; original reason unavailable',
  CASE WHEN "status" = 'closed' THEN 'Migrated closed period; original reason unavailable' ELSE NULL END,
  "created_by_user_id", "closed_by_user_id", "closed_at", "created_at", "updated_at"
FROM `payroll_periods`;--> statement-breakpoint
DROP TRIGGER `trg_payroll_runs_scope_insert`;--> statement-breakpoint
DROP TABLE `payroll_periods`;--> statement-breakpoint
ALTER TABLE `__new_payroll_periods` RENAME TO `payroll_periods`;--> statement-breakpoint
PRAGMA legacy_alter_table=OFF;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_periods_window` ON `payroll_periods` (`tenant_id`,`frequency`,`from_date`,`until_date`);--> statement-breakpoint
CREATE INDEX `idx_payroll_periods_status_date` ON `payroll_periods` (`tenant_id`,`status`,`from_date`,`id`);--> statement-breakpoint
CREATE TRIGGER trg_payroll_periods_scope_insert
BEFORE INSERT ON payroll_periods
WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_user_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PERIOD_SCOPE_INVALID');
END;--> statement-breakpoint
CREATE TRIGGER trg_payroll_periods_no_overlap_insert
BEFORE INSERT ON payroll_periods
WHEN EXISTS (
  SELECT 1 FROM payroll_periods
  WHERE tenant_id = NEW.tenant_id
    AND from_date < NEW.until_date
    AND until_date > NEW.from_date
)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PERIOD_OVERLAP');
END;--> statement-breakpoint
CREATE TRIGGER trg_payroll_periods_transition_update
BEFORE UPDATE ON payroll_periods
WHEN NEW.tenant_id != OLD.tenant_id
  OR NEW.country_code != OLD.country_code
  OR NEW.frequency != OLD.frequency
  OR NEW.from_date != OLD.from_date
  OR NEW.until_date != OLD.until_date
  OR NEW.pay_date != OLD.pay_date
  OR NEW.currency_code != OLD.currency_code
  OR NEW.created_reason != OLD.created_reason
  OR NEW.created_by_user_id != OLD.created_by_user_id
  OR NEW.created_at != OLD.created_at
  OR OLD.status != 'open'
  OR NEW.status != 'closed'
  OR NEW.closed_reason IS NULL
  OR NEW.version != OLD.version + 1
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.closed_by_user_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PERIOD_TRANSITION_INVALID');
END;--> statement-breakpoint
CREATE TRIGGER trg_payroll_periods_no_delete
BEFORE DELETE ON payroll_periods
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PERIOD_DELETE_FORBIDDEN');
END;--> statement-breakpoint
CREATE TRIGGER trg_payroll_runs_scope_insert
BEFORE INSERT ON payroll_runs
WHEN NOT EXISTS (
    SELECT 1 FROM payroll_periods WHERE id = NEW.period_id AND tenant_id = NEW.tenant_id
  )
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_user_id AND tenant_id = NEW.tenant_id)
  OR (NEW.original_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM payroll_runs
    WHERE id = NEW.original_run_id AND tenant_id = NEW.tenant_id AND status = 'approved'
  ))
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_RUN_SCOPE_INVALID');
END;
