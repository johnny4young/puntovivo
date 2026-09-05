CREATE TABLE `employment_contract_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`contract_id` text NOT NULL,
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
	FOREIGN KEY (`contract_id`) REFERENCES `employment_contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_employment_contract_events_version" CHECK("employment_contract_events"."version" >= 1 AND typeof("employment_contract_events"."version") = 'integer'),
	CONSTRAINT "chk_employment_contract_events_kind" CHECK("employment_contract_events"."kind" IN ('created','ended','replaced','voided')),
	CONSTRAINT "chk_employment_contract_events_reason" CHECK(length(trim("employment_contract_events"."reason")) BETWEEN 10 AND 500),
	CONSTRAINT "chk_employment_contract_events_before" CHECK("employment_contract_events"."before_json" IS NULL OR json_valid("employment_contract_events"."before_json")),
	CONSTRAINT "chk_employment_contract_events_after" CHECK(json_valid("employment_contract_events"."after_json")),
	CONSTRAINT "chk_employment_contract_events_creation" CHECK(("employment_contract_events"."kind" = 'created' AND "employment_contract_events"."version" = 1 AND "employment_contract_events"."before_json" IS NULL) OR ("employment_contract_events"."kind" != 'created' AND "employment_contract_events"."version" > 1 AND "employment_contract_events"."before_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employment_contract_events_version` ON `employment_contract_events` (`tenant_id`,`contract_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_employment_contract_events_operation` ON `employment_contract_events` (`tenant_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `employment_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`position` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_until` text,
	`time_zone` text NOT NULL,
	`currency_code` text NOT NULL,
	`pay_basis` text NOT NULL,
	`pay_amount` real NOT NULL,
	`costing_hourly_rate` real,
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
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`predecessor_id`) REFERENCES `employment_contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_employment_contracts_start" CHECK(
  length("employment_contracts"."effective_from") = 10
  AND "employment_contracts"."effective_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("employment_contracts"."effective_from", 1, 4) != '0000'
  AND date("employment_contracts"."effective_from", '+0 days') IS NOT NULL
  AND date("employment_contracts"."effective_from", '+0 days') = "employment_contracts"."effective_from"),
	CONSTRAINT "chk_employment_contracts_end" CHECK("employment_contracts"."effective_until" IS NULL OR (
  length("employment_contracts"."effective_until") = 10
  AND "employment_contracts"."effective_until" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr("employment_contracts"."effective_until", 1, 4) != '0000'
  AND date("employment_contracts"."effective_until", '+0 days') IS NOT NULL
  AND date("employment_contracts"."effective_until", '+0 days') = "employment_contracts"."effective_until" AND "employment_contracts"."effective_until" > "employment_contracts"."effective_from")),
	CONSTRAINT "chk_employment_contracts_position" CHECK(length(trim("employment_contracts"."position")) BETWEEN 1 AND 100),
	CONSTRAINT "chk_employment_contracts_timezone" CHECK(length(trim("employment_contracts"."time_zone")) BETWEEN 1 AND 100),
	CONSTRAINT "chk_employment_contracts_version" CHECK("employment_contracts"."version" >= 1 AND typeof("employment_contracts"."version") = 'integer'),
	CONSTRAINT "chk_employment_contracts_basis" CHECK("employment_contracts"."pay_basis" IN ('hourly','monthly') AND ("employment_contracts"."pay_basis" = 'monthly' OR "employment_contracts"."costing_hourly_rate" IS NULL)),
	CONSTRAINT "chk_employment_contracts_pay_nonneg" CHECK("employment_contracts"."pay_amount" >= 0),
	CONSTRAINT "chk_employment_contracts_pay_2dec" CHECK(round("employment_contracts"."pay_amount", 2) = "employment_contracts"."pay_amount"),
	CONSTRAINT "chk_employment_contracts_costing_rate_nonneg" CHECK("employment_contracts"."costing_hourly_rate" >= 0),
	CONSTRAINT "chk_employment_contracts_costing_rate_2dec" CHECK(round("employment_contracts"."costing_hourly_rate", 2) = "employment_contracts"."costing_hourly_rate"),
	CONSTRAINT "chk_employment_contracts_pay_limit" CHECK("employment_contracts"."pay_amount" <= 1000000000000 AND ("employment_contracts"."costing_hourly_rate" IS NULL OR "employment_contracts"."costing_hourly_rate" <= 1000000000000)),
	CONSTRAINT "chk_employment_contracts_predecessor" CHECK("employment_contracts"."predecessor_id" IS NULL OR "employment_contracts"."predecessor_id" != "employment_contracts"."id")
);
--> statement-breakpoint
CREATE INDEX `idx_employment_contracts_user_window` ON `employment_contracts` (`tenant_id`,`user_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `idx_employment_contracts_site` ON `employment_contracts` (`tenant_id`,`site_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employment_contracts_active_start` ON `employment_contracts` (`tenant_id`,`user_id`,`effective_from`) WHERE "employment_contracts"."voided_at" IS NULL;
--> statement-breakpoint
-- Drizzle cannot express append-only private-evidence triggers.
CREATE TRIGGER IF NOT EXISTS employment_contract_events_no_update BEFORE UPDATE ON employment_contract_events BEGIN
  SELECT RAISE(ABORT,'EMPLOYMENT_CONTRACT_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS employment_contract_events_no_delete BEFORE DELETE ON employment_contract_events BEGIN
  SELECT RAISE(ABORT,'EMPLOYMENT_CONTRACT_EVENT_IMMUTABLE');
END;
