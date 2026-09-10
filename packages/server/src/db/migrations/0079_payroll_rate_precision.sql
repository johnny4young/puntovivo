PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- The rebuilt table has no external dependants. Legacy rename mode avoids
-- reparsing unrelated triggers in partially adopted pre-production schemas.
PRAGMA legacy_alter_table=ON;--> statement-breakpoint
CREATE TABLE `__new_payroll_concept_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`employee_result_id` text NOT NULL,
	`category` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`origin` text NOT NULL,
	`unit` text NOT NULL,
	`quantity` real,
	`rate` real,
	`base_amount` real,
	`amount` real NOT NULL,
	`source_refs_json` text NOT NULL,
	`manual_reason` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_result_id`) REFERENCES `payroll_employee_results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_concept_lines_category" CHECK("category" IN ('earning','deduction','employer_contribution')),
	CONSTRAINT "chk_payroll_concept_lines_origin" CHECK("origin" IN ('contract','attendance','policy','manual','adjustment')),
	CONSTRAINT "chk_payroll_concept_lines_unit" CHECK("unit" IN ('amount','seconds','days','units')),
	CONSTRAINT "chk_payroll_concept_lines_code_label" CHECK(length(trim("code")) BETWEEN 1 AND 50 AND length(trim("label")) BETWEEN 1 AND 120),
	CONSTRAINT "chk_payroll_concept_lines_numbers" CHECK(("quantity" IS NULL OR ("quantity" >= 0 AND "quantity" <= 1000000000000)) AND ("rate" IS NULL OR ("rate" >= 0 AND "rate" <= 1000000000000)) AND ("base_amount" IS NULL OR ("base_amount" >= 0 AND "base_amount" <= 1000000000000))),
	CONSTRAINT "chk_payroll_concept_lines_sources" CHECK(json_valid("source_refs_json") AND json_type("source_refs_json") = 'array'),
	CONSTRAINT "chk_payroll_concept_lines_manual" CHECK(("origin" = 'manual' AND "manual_reason" IS NOT NULL AND length(trim("manual_reason")) BETWEEN 10 AND 500) OR ("origin" != 'manual' AND "manual_reason" IS NULL)),
	CONSTRAINT "chk_payroll_concept_lines_rate_precision" CHECK("rate" IS NULL OR round("rate", 8) = "rate"),
	CONSTRAINT "chk_payroll_concept_lines_base_2dec" CHECK(round("base_amount", 2) = "base_amount"),
	CONSTRAINT "chk_payroll_concept_lines_amount_nonneg" CHECK("amount" >= 0),
	CONSTRAINT "chk_payroll_concept_lines_amount_2dec" CHECK(round("amount", 2) = "amount")
);
--> statement-breakpoint
INSERT INTO `__new_payroll_concept_lines`("id", "tenant_id", "employee_result_id", "category", "code", "label", "origin", "unit", "quantity", "rate", "base_amount", "amount", "source_refs_json", "manual_reason", "created_by_user_id", "created_at") SELECT "id", "tenant_id", "employee_result_id", "category", "code", "label", "origin", "unit", "quantity", "rate", "base_amount", "amount", "source_refs_json", "manual_reason", "created_by_user_id", "created_at" FROM `payroll_concept_lines`;--> statement-breakpoint
DROP TABLE `payroll_concept_lines`;--> statement-breakpoint
ALTER TABLE `__new_payroll_concept_lines` RENAME TO `payroll_concept_lines`;--> statement-breakpoint
PRAGMA legacy_alter_table=OFF;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_concept_lines_code` ON `payroll_concept_lines` (`tenant_id`,`employee_result_id`,`category`,`code`);--> statement-breakpoint
CREATE INDEX `idx_payroll_concept_lines_result` ON `payroll_concept_lines` (`tenant_id`,`employee_result_id`,`id`);--> statement-breakpoint
CREATE TRIGGER trg_payroll_concept_lines_scope_insert
BEFORE INSERT ON payroll_concept_lines
WHEN NOT EXISTS (
    SELECT 1 FROM payroll_employee_results
    WHERE id = NEW.employee_result_id AND tenant_id = NEW.tenant_id
  )
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_user_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_CONCEPT_SCOPE_INVALID');
END;--> statement-breakpoint
CREATE TRIGGER trg_payroll_concept_lines_no_update
BEFORE UPDATE ON payroll_concept_lines
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_CONCEPT_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER trg_payroll_concept_lines_no_delete
BEFORE DELETE ON payroll_concept_lines
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_CONCEPT_IMMUTABLE');
END;
