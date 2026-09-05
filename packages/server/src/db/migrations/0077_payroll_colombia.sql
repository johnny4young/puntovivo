CREATE TABLE `payroll_concept_lines` (
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
	CONSTRAINT "chk_payroll_concept_lines_category" CHECK("payroll_concept_lines"."category" IN ('earning','deduction','employer_contribution')),
	CONSTRAINT "chk_payroll_concept_lines_origin" CHECK("payroll_concept_lines"."origin" IN ('contract','attendance','policy','manual','adjustment')),
	CONSTRAINT "chk_payroll_concept_lines_unit" CHECK("payroll_concept_lines"."unit" IN ('amount','seconds','days','units')),
	CONSTRAINT "chk_payroll_concept_lines_code_label" CHECK(length(trim("payroll_concept_lines"."code")) BETWEEN 1 AND 50 AND length(trim("payroll_concept_lines"."label")) BETWEEN 1 AND 120),
	CONSTRAINT "chk_payroll_concept_lines_numbers" CHECK(("payroll_concept_lines"."quantity" IS NULL OR ("payroll_concept_lines"."quantity" >= 0 AND "payroll_concept_lines"."quantity" <= 1000000000000)) AND ("payroll_concept_lines"."rate" IS NULL OR ("payroll_concept_lines"."rate" >= 0 AND "payroll_concept_lines"."rate" <= 1000000000000)) AND ("payroll_concept_lines"."base_amount" IS NULL OR ("payroll_concept_lines"."base_amount" >= 0 AND "payroll_concept_lines"."base_amount" <= 1000000000000))),
	CONSTRAINT "chk_payroll_concept_lines_sources" CHECK(json_valid("payroll_concept_lines"."source_refs_json") AND json_type("payroll_concept_lines"."source_refs_json") = 'array'),
	CONSTRAINT "chk_payroll_concept_lines_manual" CHECK(("payroll_concept_lines"."origin" = 'manual' AND "payroll_concept_lines"."manual_reason" IS NOT NULL AND length(trim("payroll_concept_lines"."manual_reason")) BETWEEN 10 AND 500) OR ("payroll_concept_lines"."origin" != 'manual' AND "payroll_concept_lines"."manual_reason" IS NULL)),
	CONSTRAINT "chk_payroll_concept_lines_rate_2dec" CHECK(round("payroll_concept_lines"."rate", 2) = "payroll_concept_lines"."rate"),
	CONSTRAINT "chk_payroll_concept_lines_base_2dec" CHECK(round("payroll_concept_lines"."base_amount", 2) = "payroll_concept_lines"."base_amount"),
	CONSTRAINT "chk_payroll_concept_lines_amount_nonneg" CHECK("payroll_concept_lines"."amount" >= 0),
	CONSTRAINT "chk_payroll_concept_lines_amount_2dec" CHECK(round("payroll_concept_lines"."amount", 2) = "payroll_concept_lines"."amount")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_concept_lines_code` ON `payroll_concept_lines` (`tenant_id`,`employee_result_id`,`category`,`code`);--> statement-breakpoint
CREATE INDEX `idx_payroll_concept_lines_result` ON `payroll_concept_lines` (`tenant_id`,`employee_result_id`,`id`);--> statement-breakpoint
CREATE TABLE `payroll_employee_profile_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `payroll_employee_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_profile_events_version" CHECK(typeof("payroll_employee_profile_events"."version") = 'integer' AND "payroll_employee_profile_events"."version" >= 1),
	CONSTRAINT "chk_payroll_profile_events_kind" CHECK("payroll_employee_profile_events"."kind" IN ('created','ended','replaced','voided')),
	CONSTRAINT "chk_payroll_profile_events_reason" CHECK(length(trim("payroll_employee_profile_events"."reason")) BETWEEN 10 AND 500),
	CONSTRAINT "chk_payroll_profile_events_json" CHECK(("payroll_employee_profile_events"."before_json" IS NULL OR json_valid("payroll_employee_profile_events"."before_json")) AND json_valid("payroll_employee_profile_events"."after_json")),
	CONSTRAINT "chk_payroll_profile_events_creation" CHECK(("payroll_employee_profile_events"."kind" = 'created' AND "payroll_employee_profile_events"."version" = 1 AND "payroll_employee_profile_events"."before_json" IS NULL) OR ("payroll_employee_profile_events"."kind" != 'created' AND "payroll_employee_profile_events"."version" > 1 AND "payroll_employee_profile_events"."before_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_profile_events_version` ON `payroll_employee_profile_events` (`tenant_id`,`profile_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_payroll_profile_events_operation` ON `payroll_employee_profile_events` (`tenant_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `payroll_employee_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`country_code` text NOT NULL,
	`identification_type` text NOT NULL,
	`identification_number` text NOT NULL,
	`contributor_type` text NOT NULL,
	`contributor_subtype` text,
	`contract_kind` text NOT NULL,
	`integral_salary` integer DEFAULT false NOT NULL,
	`arl_risk_class` integer NOT NULL,
	`health_entity` text,
	`pension_entity` text,
	`compensation_fund` text,
	`transport_assistance_eligible` integer DEFAULT false NOT NULL,
	`payment_method` text NOT NULL,
	`payment_account_last4` text,
	`effective_from` text NOT NULL,
	`effective_until` text,
	`predecessor_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`voided_at` text,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`predecessor_id`) REFERENCES `payroll_employee_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_profiles_country" CHECK("payroll_employee_profiles"."country_code" = 'CO'),
	CONSTRAINT "chk_payroll_profiles_start" CHECK(
  length("payroll_employee_profiles"."effective_from") = 10
  AND "payroll_employee_profiles"."effective_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("payroll_employee_profiles"."effective_from", 1, 4) != '0000'
  AND date("payroll_employee_profiles"."effective_from", '+0 days') IS NOT NULL
  AND date("payroll_employee_profiles"."effective_from", '+0 days') = "payroll_employee_profiles"."effective_from"),
	CONSTRAINT "chk_payroll_profiles_end" CHECK("payroll_employee_profiles"."effective_until" IS NULL OR (
  length("payroll_employee_profiles"."effective_until") = 10
  AND "payroll_employee_profiles"."effective_until" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("payroll_employee_profiles"."effective_until", 1, 4) != '0000'
  AND date("payroll_employee_profiles"."effective_until", '+0 days') IS NOT NULL
  AND date("payroll_employee_profiles"."effective_until", '+0 days') = "payroll_employee_profiles"."effective_until" AND "payroll_employee_profiles"."effective_until" > "payroll_employee_profiles"."effective_from")),
	CONSTRAINT "chk_payroll_profiles_identity" CHECK(length(trim("payroll_employee_profiles"."identification_type")) BETWEEN 1 AND 20 AND length(trim("payroll_employee_profiles"."identification_number")) BETWEEN 3 AND 40),
	CONSTRAINT "chk_payroll_profiles_contributor" CHECK(length(trim("payroll_employee_profiles"."contributor_type")) BETWEEN 1 AND 20 AND ("payroll_employee_profiles"."contributor_subtype" IS NULL OR length(trim("payroll_employee_profiles"."contributor_subtype")) BETWEEN 1 AND 20)),
	CONSTRAINT "chk_payroll_profiles_contract_kind" CHECK("payroll_employee_profiles"."contract_kind" IN ('indefinite','fixed_term','work_or_task','apprenticeship','other')),
	CONSTRAINT "chk_payroll_profiles_arl" CHECK(typeof("payroll_employee_profiles"."arl_risk_class") = 'integer' AND "payroll_employee_profiles"."arl_risk_class" BETWEEN 1 AND 5),
	CONSTRAINT "chk_payroll_profiles_payment" CHECK("payroll_employee_profiles"."payment_method" IN ('cash','transfer','other') AND ("payroll_employee_profiles"."payment_method" != 'transfer' OR "payroll_employee_profiles"."payment_account_last4" IS NOT NULL)),
	CONSTRAINT "chk_payroll_profiles_account" CHECK("payroll_employee_profiles"."payment_account_last4" IS NULL OR "payroll_employee_profiles"."payment_account_last4" GLOB '[0-9][0-9][0-9][0-9]'),
	CONSTRAINT "chk_payroll_profiles_version" CHECK(typeof("payroll_employee_profiles"."version") = 'integer' AND "payroll_employee_profiles"."version" >= 1),
	CONSTRAINT "chk_payroll_profiles_predecessor" CHECK("payroll_employee_profiles"."predecessor_id" IS NULL OR "payroll_employee_profiles"."predecessor_id" != "payroll_employee_profiles"."id")
);
--> statement-breakpoint
CREATE INDEX `idx_payroll_profiles_user_window` ON `payroll_employee_profiles` (`tenant_id`,`user_id`,`effective_from`,`id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_profiles_site` ON `payroll_employee_profiles` (`tenant_id`,`site_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_profiles_active_start` ON `payroll_employee_profiles` (`tenant_id`,`user_id`,`effective_from`) WHERE "payroll_employee_profiles"."voided_at" IS NULL;--> statement-breakpoint
CREATE TABLE `payroll_employee_results` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`user_id` text NOT NULL,
	`payroll_profile_id` text NOT NULL,
	`employment_contract_id` text NOT NULL,
	`source_snapshot_json` text NOT NULL,
	`status` text NOT NULL,
	`currency_code` text NOT NULL,
	`gross_amount` real NOT NULL,
	`deduction_amount` real NOT NULL,
	`net_amount` real NOT NULL,
	`employer_contribution_amount` real NOT NULL,
	`blockers_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `payroll_run_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payroll_profile_id`) REFERENCES `payroll_employee_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employment_contract_id`) REFERENCES `employment_contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_employee_results_source" CHECK(json_valid("payroll_employee_results"."source_snapshot_json")),
	CONSTRAINT "chk_payroll_employee_results_status" CHECK("payroll_employee_results"."status" IN ('complete','blocked') AND CASE WHEN json_valid("payroll_employee_results"."blockers_json") AND json_type("payroll_employee_results"."blockers_json") = 'array' THEN ("payroll_employee_results"."status" = 'complete' AND json_array_length("payroll_employee_results"."blockers_json") = 0) OR ("payroll_employee_results"."status" = 'blocked' AND json_array_length("payroll_employee_results"."blockers_json") > 0) ELSE 0 END),
	CONSTRAINT "chk_payroll_employee_results_gross_nonneg" CHECK("payroll_employee_results"."gross_amount" >= 0),
	CONSTRAINT "chk_payroll_employee_results_gross_2dec" CHECK(round("payroll_employee_results"."gross_amount", 2) = "payroll_employee_results"."gross_amount"),
	CONSTRAINT "chk_payroll_employee_results_deduction_nonneg" CHECK("payroll_employee_results"."deduction_amount" >= 0),
	CONSTRAINT "chk_payroll_employee_results_deduction_2dec" CHECK(round("payroll_employee_results"."deduction_amount", 2) = "payroll_employee_results"."deduction_amount"),
	CONSTRAINT "chk_payroll_employee_results_net_nonneg" CHECK("payroll_employee_results"."net_amount" >= 0),
	CONSTRAINT "chk_payroll_employee_results_net_2dec" CHECK(round("payroll_employee_results"."net_amount", 2) = "payroll_employee_results"."net_amount"),
	CONSTRAINT "chk_payroll_employee_results_employer_contribution_nonneg" CHECK("payroll_employee_results"."employer_contribution_amount" >= 0),
	CONSTRAINT "chk_payroll_employee_results_employer_contribution_2dec" CHECK(round("payroll_employee_results"."employer_contribution_amount", 2) = "payroll_employee_results"."employer_contribution_amount"),
	CONSTRAINT "chk_payroll_employee_results_totals" CHECK(round("payroll_employee_results"."gross_amount" - "payroll_employee_results"."deduction_amount", 2) = "payroll_employee_results"."net_amount")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_employee_results_revision_user` ON `payroll_employee_results` (`tenant_id`,`revision_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_employee_results_user` ON `payroll_employee_results` (`tenant_id`,`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `payroll_periods` (
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
	`created_by_user_id` text NOT NULL,
	`closed_by_user_id` text,
	`closed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_periods_country" CHECK("payroll_periods"."country_code" = 'CO'),
	CONSTRAINT "chk_payroll_periods_frequency" CHECK("payroll_periods"."frequency" IN ('weekly','biweekly','semimonthly','monthly','other')),
	CONSTRAINT "chk_payroll_periods_dates" CHECK(
  length("payroll_periods"."from_date") = 10
  AND "payroll_periods"."from_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("payroll_periods"."from_date", 1, 4) != '0000'
  AND date("payroll_periods"."from_date", '+0 days') IS NOT NULL
  AND date("payroll_periods"."from_date", '+0 days') = "payroll_periods"."from_date" AND
  length("payroll_periods"."until_date") = 10
  AND "payroll_periods"."until_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("payroll_periods"."until_date", 1, 4) != '0000'
  AND date("payroll_periods"."until_date", '+0 days') IS NOT NULL
  AND date("payroll_periods"."until_date", '+0 days') = "payroll_periods"."until_date" AND
  length("payroll_periods"."pay_date") = 10
  AND "payroll_periods"."pay_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("payroll_periods"."pay_date", 1, 4) != '0000'
  AND date("payroll_periods"."pay_date", '+0 days') IS NOT NULL
  AND date("payroll_periods"."pay_date", '+0 days') = "payroll_periods"."pay_date" AND "payroll_periods"."until_date" > "payroll_periods"."from_date" AND julianday("payroll_periods"."until_date") - julianday("payroll_periods"."from_date") BETWEEN 1 AND 31 AND "payroll_periods"."pay_date" >= "payroll_periods"."from_date"),
	CONSTRAINT "chk_payroll_periods_state" CHECK(("payroll_periods"."status" = 'open' AND "payroll_periods"."closed_by_user_id" IS NULL AND "payroll_periods"."closed_at" IS NULL) OR ("payroll_periods"."status" = 'closed' AND "payroll_periods"."closed_by_user_id" IS NOT NULL AND "payroll_periods"."closed_at" IS NOT NULL AND
  strftime('%Y-%m-%dT%H:%M:%fZ', "payroll_periods"."closed_at") IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', "payroll_periods"."closed_at") = "payroll_periods"."closed_at")),
	CONSTRAINT "chk_payroll_periods_version" CHECK(typeof("payroll_periods"."version") = 'integer' AND "payroll_periods"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_periods_window` ON `payroll_periods` (`tenant_id`,`frequency`,`from_date`,`until_date`);--> statement-breakpoint
CREATE INDEX `idx_payroll_periods_status_date` ON `payroll_periods` (`tenant_id`,`status`,`from_date`,`id`);--> statement-breakpoint
CREATE TABLE `payroll_provider_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`revision` integer NOT NULL,
	`employee_result_id` text NOT NULL,
	`adapter_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload_json` text NOT NULL,
	`response_json` text,
	`error_code` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_result_id`) REFERENCES `payroll_employee_results`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_provider_jobs_adapter" CHECK("payroll_provider_jobs"."adapter_id" = 'sandbox_v1'),
	CONSTRAINT "chk_payroll_provider_jobs_revision" CHECK(typeof("payroll_provider_jobs"."revision") = 'integer' AND "payroll_provider_jobs"."revision" >= 1),
	CONSTRAINT "chk_payroll_provider_jobs_status" CHECK(("payroll_provider_jobs"."status" = 'queued' AND "payroll_provider_jobs"."response_json" IS NULL AND "payroll_provider_jobs"."error_code" IS NULL) OR ("payroll_provider_jobs"."status" = 'accepted' AND "payroll_provider_jobs"."response_json" IS NOT NULL AND "payroll_provider_jobs"."error_code" IS NULL) OR ("payroll_provider_jobs"."status" = 'rejected' AND "payroll_provider_jobs"."response_json" IS NOT NULL AND "payroll_provider_jobs"."error_code" IS NOT NULL)),
	CONSTRAINT "chk_payroll_provider_jobs_json" CHECK(json_valid("payroll_provider_jobs"."payload_json") AND ("payroll_provider_jobs"."response_json" IS NULL OR json_valid("payroll_provider_jobs"."response_json")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_provider_jobs_result` ON `payroll_provider_jobs` (`tenant_id`,`employee_result_id`,`adapter_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_provider_jobs_status` ON `payroll_provider_jobs` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `payroll_result_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`employee_result_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_version` integer,
	`source_digest` text NOT NULL,
	`source_snapshot_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_result_id`) REFERENCES `payroll_employee_results`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_result_sources_kind" CHECK("payroll_result_sources"."kind" IN ('payroll_profile','employment_contract','attendance','attendance_correction','reconciliation','policy')),
	CONSTRAINT "chk_payroll_result_sources_version" CHECK("payroll_result_sources"."source_version" IS NULL OR (typeof("payroll_result_sources"."source_version") = 'integer' AND "payroll_result_sources"."source_version" >= 1)),
	CONSTRAINT "chk_payroll_result_sources_digest" CHECK(length("payroll_result_sources"."source_digest") = 64 AND "payroll_result_sources"."source_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_payroll_result_sources_json" CHECK(json_valid("payroll_result_sources"."source_snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_result_sources_identity` ON `payroll_result_sources` (`tenant_id`,`employee_result_id`,`kind`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_result_sources_source` ON `payroll_result_sources` (`tenant_id`,`kind`,`source_id`,`employee_result_id`);--> statement-breakpoint
CREATE TABLE `payroll_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text,
	`snapshot_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_run_events_version" CHECK(typeof("payroll_run_events"."version") = 'integer' AND "payroll_run_events"."version" >= 1 AND typeof("payroll_run_events"."revision") = 'integer' AND "payroll_run_events"."revision" >= 0),
	CONSTRAINT "chk_payroll_run_events_kind" CHECK("payroll_run_events"."kind" IN ('created','recalculated','reviewed','approved')),
	CONSTRAINT "chk_payroll_run_events_reason" CHECK(("payroll_run_events"."kind" IN ('created','recalculated') AND ("payroll_run_events"."reason" IS NULL OR length(trim("payroll_run_events"."reason")) BETWEEN 10 AND 500)) OR ("payroll_run_events"."kind" IN ('reviewed','approved') AND "payroll_run_events"."reason" IS NOT NULL AND length(trim("payroll_run_events"."reason")) BETWEEN 10 AND 500)),
	CONSTRAINT "chk_payroll_run_events_snapshot" CHECK(json_valid("payroll_run_events"."snapshot_json")),
	CONSTRAINT "chk_payroll_run_events_shape" CHECK(("payroll_run_events"."kind" = 'created' AND "payroll_run_events"."version" = 1 AND "payroll_run_events"."revision" = 0) OR ("payroll_run_events"."kind" != 'created' AND "payroll_run_events"."version" > 1 AND "payroll_run_events"."revision" >= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_run_events_version` ON `payroll_run_events` (`tenant_id`,`run_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_payroll_run_events_operation` ON `payroll_run_events` (`tenant_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `payroll_run_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`policy_version` text NOT NULL,
	`policy_snapshot_json` text NOT NULL,
	`source_cutoff` text NOT NULL,
	`currency_code` text NOT NULL,
	`gross_amount` real NOT NULL,
	`deduction_amount` real NOT NULL,
	`net_amount` real NOT NULL,
	`employer_contribution_amount` real NOT NULL,
	`blockers_json` text NOT NULL,
	`generated_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_run_revisions_revision" CHECK(typeof("payroll_run_revisions"."revision") = 'integer' AND "payroll_run_revisions"."revision" >= 1),
	CONSTRAINT "chk_payroll_run_revisions_status" CHECK("payroll_run_revisions"."status" IN ('complete','blocked') AND CASE WHEN json_valid("payroll_run_revisions"."blockers_json") AND json_type("payroll_run_revisions"."blockers_json") = 'array' THEN ("payroll_run_revisions"."status" = 'complete' AND json_array_length("payroll_run_revisions"."blockers_json") = 0) OR ("payroll_run_revisions"."status" = 'blocked' AND json_array_length("payroll_run_revisions"."blockers_json") > 0) ELSE 0 END),
	CONSTRAINT "chk_payroll_run_revisions_policy" CHECK(json_valid("payroll_run_revisions"."policy_snapshot_json")),
	CONSTRAINT "chk_payroll_run_revisions_cutoff" CHECK(
  strftime('%Y-%m-%dT%H:%M:%fZ', "payroll_run_revisions"."source_cutoff") IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', "payroll_run_revisions"."source_cutoff") = "payroll_run_revisions"."source_cutoff"),
	CONSTRAINT "chk_payroll_run_revisions_gross_nonneg" CHECK("payroll_run_revisions"."gross_amount" >= 0),
	CONSTRAINT "chk_payroll_run_revisions_gross_2dec" CHECK(round("payroll_run_revisions"."gross_amount", 2) = "payroll_run_revisions"."gross_amount"),
	CONSTRAINT "chk_payroll_run_revisions_deduction_nonneg" CHECK("payroll_run_revisions"."deduction_amount" >= 0),
	CONSTRAINT "chk_payroll_run_revisions_deduction_2dec" CHECK(round("payroll_run_revisions"."deduction_amount", 2) = "payroll_run_revisions"."deduction_amount"),
	CONSTRAINT "chk_payroll_run_revisions_net_nonneg" CHECK("payroll_run_revisions"."net_amount" >= 0),
	CONSTRAINT "chk_payroll_run_revisions_net_2dec" CHECK(round("payroll_run_revisions"."net_amount", 2) = "payroll_run_revisions"."net_amount"),
	CONSTRAINT "chk_payroll_run_revisions_employer_contribution_nonneg" CHECK("payroll_run_revisions"."employer_contribution_amount" >= 0),
	CONSTRAINT "chk_payroll_run_revisions_employer_contribution_2dec" CHECK(round("payroll_run_revisions"."employer_contribution_amount", 2) = "payroll_run_revisions"."employer_contribution_amount"),
	CONSTRAINT "chk_payroll_run_revisions_totals" CHECK(round("payroll_run_revisions"."gross_amount" - "payroll_run_revisions"."deduction_amount", 2) = "payroll_run_revisions"."net_amount")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_run_revisions_number` ON `payroll_run_revisions` (`tenant_id`,`run_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_payroll_run_revisions_created` ON `payroll_run_revisions` (`tenant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`period_id` text NOT NULL,
	`kind` text NOT NULL,
	`original_run_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_revision` integer DEFAULT 0 NOT NULL,
	`reviewed_revision` integer,
	`approved_revision` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`reviewed_by_user_id` text,
	`approved_by_user_id` text,
	`reviewed_at` text,
	`approved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`period_id`) REFERENCES `payroll_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_runs_kind" CHECK("payroll_runs"."kind" IN ('regular','adjustment')),
	CONSTRAINT "chk_payroll_runs_status" CHECK("payroll_runs"."status" IN ('draft','reviewed','approved')),
	CONSTRAINT "chk_payroll_runs_adjustment" CHECK(("payroll_runs"."kind" = 'regular' AND "payroll_runs"."original_run_id" IS NULL) OR ("payroll_runs"."kind" = 'adjustment' AND "payroll_runs"."original_run_id" IS NOT NULL AND "payroll_runs"."original_run_id" != "payroll_runs"."id")),
	CONSTRAINT "chk_payroll_runs_revision" CHECK(typeof("payroll_runs"."current_revision") = 'integer' AND "payroll_runs"."current_revision" >= 0 AND ("payroll_runs"."reviewed_revision" IS NULL OR (typeof("payroll_runs"."reviewed_revision") = 'integer' AND "payroll_runs"."reviewed_revision" BETWEEN 1 AND "payroll_runs"."current_revision")) AND ("payroll_runs"."approved_revision" IS NULL OR (typeof("payroll_runs"."approved_revision") = 'integer' AND "payroll_runs"."approved_revision" = "payroll_runs"."reviewed_revision"))),
	CONSTRAINT "chk_payroll_runs_state" CHECK(("payroll_runs"."status" = 'draft' AND "payroll_runs"."reviewed_revision" IS NULL AND "payroll_runs"."approved_revision" IS NULL AND "payroll_runs"."reviewed_by_user_id" IS NULL AND "payroll_runs"."approved_by_user_id" IS NULL AND "payroll_runs"."reviewed_at" IS NULL AND "payroll_runs"."approved_at" IS NULL) OR ("payroll_runs"."status" = 'reviewed' AND "payroll_runs"."reviewed_revision" IS NOT NULL AND "payroll_runs"."approved_revision" IS NULL AND "payroll_runs"."reviewed_by_user_id" IS NOT NULL AND "payroll_runs"."approved_by_user_id" IS NULL AND "payroll_runs"."reviewed_at" IS NOT NULL AND "payroll_runs"."approved_at" IS NULL) OR ("payroll_runs"."status" = 'approved' AND "payroll_runs"."reviewed_revision" IS NOT NULL AND "payroll_runs"."approved_revision" = "payroll_runs"."reviewed_revision" AND "payroll_runs"."reviewed_by_user_id" IS NOT NULL AND "payroll_runs"."approved_by_user_id" IS NOT NULL AND "payroll_runs"."reviewed_at" IS NOT NULL AND "payroll_runs"."approved_at" IS NOT NULL)),
	CONSTRAINT "chk_payroll_runs_instants" CHECK(("payroll_runs"."reviewed_at" IS NULL OR
  strftime('%Y-%m-%dT%H:%M:%fZ', "payroll_runs"."reviewed_at") IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', "payroll_runs"."reviewed_at") = "payroll_runs"."reviewed_at") AND ("payroll_runs"."approved_at" IS NULL OR
  strftime('%Y-%m-%dT%H:%M:%fZ', "payroll_runs"."approved_at") IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', "payroll_runs"."approved_at") = "payroll_runs"."approved_at")),
	CONSTRAINT "chk_payroll_runs_version" CHECK(typeof("payroll_runs"."version") = 'integer' AND "payroll_runs"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payroll_runs_regular_period` ON `payroll_runs` (`tenant_id`,`period_id`) WHERE "payroll_runs"."kind" = 'regular';--> statement-breakpoint
CREATE INDEX `idx_payroll_runs_period_status` ON `payroll_runs` (`tenant_id`,`period_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_runs_original` ON `payroll_runs` (`tenant_id`,`original_run_id`,`id`);--> statement-breakpoint
CREATE TRIGGER trg_payroll_profiles_scope_insert
BEFORE INSERT ON payroll_employee_profiles
WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id)
  OR NOT EXISTS (SELECT 1 FROM sites WHERE id = NEW.site_id AND tenant_id = NEW.tenant_id)
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_user_id AND tenant_id = NEW.tenant_id)
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.updated_by_user_id AND tenant_id = NEW.tenant_id)
  OR (NEW.predecessor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM payroll_employee_profiles
    WHERE id = NEW.predecessor_id AND tenant_id = NEW.tenant_id AND user_id = NEW.user_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PROFILE_SCOPE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_profiles_scope_update
BEFORE UPDATE ON payroll_employee_profiles
WHEN NEW.tenant_id != OLD.tenant_id
  OR NEW.user_id != OLD.user_id
  OR NEW.site_id != OLD.site_id
  OR NEW.country_code != OLD.country_code
  OR NEW.identification_type != OLD.identification_type
  OR NEW.identification_number != OLD.identification_number
  OR NEW.contributor_type != OLD.contributor_type
  OR NEW.contributor_subtype IS NOT OLD.contributor_subtype
  OR NEW.contract_kind != OLD.contract_kind
  OR NEW.integral_salary != OLD.integral_salary
  OR NEW.arl_risk_class != OLD.arl_risk_class
  OR NEW.health_entity IS NOT OLD.health_entity
  OR NEW.pension_entity IS NOT OLD.pension_entity
  OR NEW.compensation_fund IS NOT OLD.compensation_fund
  OR NEW.transport_assistance_eligible != OLD.transport_assistance_eligible
  OR NEW.payment_method != OLD.payment_method
  OR NEW.payment_account_last4 IS NOT OLD.payment_account_last4
  OR NEW.effective_from != OLD.effective_from
  OR NEW.predecessor_id IS NOT OLD.predecessor_id
  OR NEW.created_by_user_id != OLD.created_by_user_id
  OR NEW.created_at != OLD.created_at
  OR NEW.version != OLD.version + 1
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.updated_by_user_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PROFILE_MUTATION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_profiles_no_delete
BEFORE DELETE ON payroll_employee_profiles
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PROFILE_DELETE_FORBIDDEN');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_profile_events_scope_insert
BEFORE INSERT ON payroll_employee_profile_events
WHEN NOT EXISTS (
    SELECT 1 FROM payroll_employee_profiles
    WHERE id = NEW.profile_id AND tenant_id = NEW.tenant_id
  )
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PROFILE_EVENT_SCOPE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_profile_events_no_update
BEFORE UPDATE ON payroll_employee_profile_events
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PROFILE_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_profile_events_no_delete
BEFORE DELETE ON payroll_employee_profile_events
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PROFILE_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_periods_scope_insert
BEFORE INSERT ON payroll_periods
WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_user_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PERIOD_SCOPE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_periods_transition_update
BEFORE UPDATE ON payroll_periods
WHEN NEW.tenant_id != OLD.tenant_id
  OR NEW.country_code != OLD.country_code
  OR NEW.frequency != OLD.frequency
  OR NEW.from_date != OLD.from_date
  OR NEW.until_date != OLD.until_date
  OR NEW.pay_date != OLD.pay_date
  OR NEW.currency_code != OLD.currency_code
  OR NEW.created_by_user_id != OLD.created_by_user_id
  OR NEW.created_at != OLD.created_at
  OR OLD.status != 'open'
  OR NEW.status != 'closed'
  OR NEW.version != OLD.version + 1
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.closed_by_user_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PERIOD_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_periods_no_delete
BEFORE DELETE ON payroll_periods
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PERIOD_DELETE_FORBIDDEN');
END;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER trg_payroll_runs_transition_update
BEFORE UPDATE ON payroll_runs
WHEN NEW.tenant_id != OLD.tenant_id
  OR NEW.period_id != OLD.period_id
  OR NEW.kind != OLD.kind
  OR NEW.original_run_id IS NOT OLD.original_run_id
  OR NEW.created_by_user_id != OLD.created_by_user_id
  OR NEW.created_at != OLD.created_at
  OR NEW.version != OLD.version + 1
  OR NOT (
    (OLD.status = 'draft' AND NEW.status = 'draft'
      AND NEW.current_revision = OLD.current_revision + 1
      AND NEW.reviewed_revision IS NULL AND NEW.approved_revision IS NULL
      AND NEW.reviewed_by_user_id IS NULL AND NEW.approved_by_user_id IS NULL
      AND NEW.reviewed_at IS NULL AND NEW.approved_at IS NULL)
    OR
    (OLD.status = 'draft' AND NEW.status = 'reviewed'
      AND OLD.current_revision > 0 AND NEW.current_revision = OLD.current_revision
      AND NEW.reviewed_revision = NEW.current_revision AND NEW.approved_revision IS NULL
      AND EXISTS (SELECT 1 FROM users WHERE id = NEW.reviewed_by_user_id AND tenant_id = NEW.tenant_id)
      AND NEW.approved_by_user_id IS NULL AND NEW.approved_at IS NULL)
    OR
    (OLD.status = 'reviewed' AND NEW.status = 'approved'
      AND NEW.current_revision = OLD.current_revision
      AND NEW.reviewed_revision = OLD.reviewed_revision
      AND NEW.reviewed_by_user_id = OLD.reviewed_by_user_id
      AND NEW.reviewed_at = OLD.reviewed_at
      AND NEW.approved_revision = OLD.reviewed_revision
      AND EXISTS (SELECT 1 FROM users WHERE id = NEW.approved_by_user_id AND tenant_id = NEW.tenant_id))
  )
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_RUN_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_runs_no_delete
BEFORE DELETE ON payroll_runs
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_RUN_DELETE_FORBIDDEN');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_run_revisions_scope_insert
BEFORE INSERT ON payroll_run_revisions
WHEN NOT EXISTS (
    SELECT 1 FROM payroll_runs
    WHERE id = NEW.run_id AND tenant_id = NEW.tenant_id AND status = 'draft'
      AND current_revision + 1 = NEW.revision
  )
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.generated_by_user_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_REVISION_SCOPE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_run_revisions_no_update
BEFORE UPDATE ON payroll_run_revisions
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_REVISION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_run_revisions_no_delete
BEFORE DELETE ON payroll_run_revisions
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_REVISION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_employee_results_scope_insert
BEFORE INSERT ON payroll_employee_results
WHEN NOT EXISTS (
    SELECT 1 FROM payroll_run_revisions
    WHERE id = NEW.revision_id AND tenant_id = NEW.tenant_id
  )
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id)
  OR NOT EXISTS (
    SELECT 1 FROM payroll_employee_profiles
    WHERE id = NEW.payroll_profile_id AND tenant_id = NEW.tenant_id AND user_id = NEW.user_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM employment_contracts
    WHERE id = NEW.employment_contract_id AND tenant_id = NEW.tenant_id AND user_id = NEW.user_id
  )
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_EMPLOYEE_RESULT_SCOPE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_employee_results_no_update
BEFORE UPDATE ON payroll_employee_results
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_EMPLOYEE_RESULT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_employee_results_no_delete
BEFORE DELETE ON payroll_employee_results
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_EMPLOYEE_RESULT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_concept_lines_scope_insert
BEFORE INSERT ON payroll_concept_lines
WHEN NOT EXISTS (
    SELECT 1 FROM payroll_employee_results
    WHERE id = NEW.employee_result_id AND tenant_id = NEW.tenant_id
  )
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_user_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_CONCEPT_SCOPE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_concept_lines_no_update
BEFORE UPDATE ON payroll_concept_lines
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_CONCEPT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_concept_lines_no_delete
BEFORE DELETE ON payroll_concept_lines
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_CONCEPT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_run_events_scope_insert
BEFORE INSERT ON payroll_run_events
WHEN NOT EXISTS (
    SELECT 1 FROM payroll_runs
    WHERE id = NEW.run_id AND tenant_id = NEW.tenant_id AND version = NEW.version
  )
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_RUN_EVENT_SCOPE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_run_events_no_update
BEFORE UPDATE ON payroll_run_events
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_RUN_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_run_events_no_delete
BEFORE DELETE ON payroll_run_events
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_RUN_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_provider_jobs_scope_insert
BEFORE INSERT ON payroll_provider_jobs
WHEN NOT EXISTS (
    SELECT 1
    FROM payroll_runs r
    JOIN payroll_run_revisions rr
      ON rr.tenant_id = r.tenant_id AND rr.run_id = r.id AND rr.revision = NEW.revision
    JOIN payroll_employee_results er
      ON er.tenant_id = rr.tenant_id AND er.revision_id = rr.id
    WHERE r.id = NEW.run_id AND r.tenant_id = NEW.tenant_id
      AND r.status = 'approved' AND r.approved_revision = NEW.revision
      AND er.id = NEW.employee_result_id AND er.status = 'complete'
  )
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PROVIDER_JOB_SCOPE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_provider_jobs_transition_update
BEFORE UPDATE ON payroll_provider_jobs
WHEN OLD.status != 'queued'
  OR NEW.status NOT IN ('accepted','rejected')
  OR NEW.tenant_id != OLD.tenant_id
  OR NEW.run_id != OLD.run_id
  OR NEW.revision != OLD.revision
  OR NEW.employee_result_id != OLD.employee_result_id
  OR NEW.adapter_id != OLD.adapter_id
  OR NEW.payload_json != OLD.payload_json
  OR NEW.created_at != OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PROVIDER_JOB_TRANSITION_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_provider_jobs_no_delete
BEFORE DELETE ON payroll_provider_jobs
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_PROVIDER_JOB_DELETE_FORBIDDEN');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_result_sources_scope_insert
BEFORE INSERT ON payroll_result_sources
WHEN NOT EXISTS (
    SELECT 1 FROM payroll_employee_results
    WHERE id = NEW.employee_result_id AND tenant_id = NEW.tenant_id
  )
  OR (NEW.kind = 'payroll_profile' AND NOT EXISTS (
    SELECT 1 FROM payroll_employee_results er
    JOIN payroll_employee_profiles p
      ON p.tenant_id = er.tenant_id AND p.user_id = er.user_id AND p.id = NEW.source_id
    WHERE er.id = NEW.employee_result_id AND er.tenant_id = NEW.tenant_id
  ))
  OR (NEW.kind = 'employment_contract' AND NOT EXISTS (
    SELECT 1 FROM payroll_employee_results er
    JOIN employment_contracts c
      ON c.tenant_id = er.tenant_id AND c.user_id = er.user_id AND c.id = NEW.source_id
    WHERE er.id = NEW.employee_result_id AND er.tenant_id = NEW.tenant_id
  ))
  OR (NEW.kind = 'attendance' AND NOT EXISTS (
    SELECT 1 FROM payroll_employee_results er
    JOIN employee_shifts s
      ON s.tenant_id = er.tenant_id AND s.user_id = er.user_id AND s.id = NEW.source_id
    WHERE er.id = NEW.employee_result_id AND er.tenant_id = NEW.tenant_id
  ))
  OR (NEW.kind = 'attendance_correction' AND NOT EXISTS (
    SELECT 1 FROM payroll_employee_results er
    JOIN employee_shift_corrections c ON c.tenant_id = er.tenant_id AND c.id = NEW.source_id
    JOIN employee_shifts s
      ON s.tenant_id = c.tenant_id AND s.id = c.employee_shift_id AND s.user_id = er.user_id
    WHERE er.id = NEW.employee_result_id AND er.tenant_id = NEW.tenant_id
  ))
  OR (NEW.kind = 'reconciliation' AND NOT EXISTS (
    SELECT 1 FROM payroll_employee_results er
    JOIN employee_shift_reconciliations r
      ON r.tenant_id = er.tenant_id AND r.user_id = er.user_id AND r.id = NEW.source_id
    WHERE er.id = NEW.employee_result_id AND er.tenant_id = NEW.tenant_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_RESULT_SOURCE_SCOPE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_result_sources_no_update
BEFORE UPDATE ON payroll_result_sources
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_RESULT_SOURCE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_result_sources_no_delete
BEFORE DELETE ON payroll_result_sources
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_RESULT_SOURCE_IMMUTABLE');
END;
