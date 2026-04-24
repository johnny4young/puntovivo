-- ENG-017 — global locale catalogs + per-tenant override table.
--
-- Three tables land at once because they form one consistent unit:
-- `currency_catalog` must exist before `country_catalog` references it
-- via `default_currency_code`, and both must exist before
-- `tenant_locale_settings` can reference them. Statement ordering
-- matters because SQLite parses foreign keys at CREATE time.
--
-- Safe to run on every install: `drizzleMigrate()` executes before
-- `runSchemaSync()` in `db/index.ts`, so on fresh DBs the migration
-- lands the canonical shape; on legacy DBs the raw-DDL fallback in
-- `runSchemaSync()` follows with `CREATE TABLE IF NOT EXISTS` to keep
-- the shape in sync. The adoption shim in `ensureMigrationBaseline()`
-- seeds every journal entry at adoption time so migrations never
-- race runSchemaSync on minimally-seeded adoption paths.
CREATE TABLE IF NOT EXISTS `currency_catalog` (
	`code` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_es` text NOT NULL,
	`symbol` text NOT NULL,
	`decimals` integer NOT NULL,
	`display_decimals` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `country_catalog` (
	`code` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_es` text NOT NULL,
	`default_locale` text NOT NULL,
	`general_locale` text NOT NULL,
	`default_currency_code` text NOT NULL,
	`additional_currency_codes` text DEFAULT '[]',
	`default_timezone` text NOT NULL,
	`first_day_of_week` integer NOT NULL,
	`date_format_short` text NOT NULL,
	`date_format_long` text NOT NULL,
	`tax_id_types_hint` text DEFAULT '[]',
	`ui_locale_ready` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`default_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tenant_locale_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`country_code` text NOT NULL,
	`locale_override` text,
	`currency_override` text,
	`timezone_override` text,
	`first_day_of_week_override` integer,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`country_code`) REFERENCES `country_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_override`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action
);
