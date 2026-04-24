-- ENG-017 — global locale catalogs + per-tenant override table.
--
-- Three tables land at once because they form one consistent unit:
-- `currency_catalog` must exist before `country_catalog` references it
-- via `default_currency_code`, and both must exist before
-- `tenant_locale_settings` can reference them. Statement ordering
-- matters because SQLite parses foreign keys at CREATE time.
--
-- `IF NOT EXISTS` is retained on every CREATE so this migration is
-- idempotent against the ENG-002 adoption shim (`ensureMigrationBaseline`
-- pins the full journal on DBs that reached the current shape via the
-- now-retired raw-DDL bootstrap — those rows already exist). Catalog
-- row content lands via the post-migration `seedCatalogs()` hook.
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
