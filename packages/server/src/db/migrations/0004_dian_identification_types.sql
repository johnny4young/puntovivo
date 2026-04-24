-- ENG-020 Phase A — global DIAN identification types catalog.
--
-- Seeded on every boot by `seedDianIdentificationTypes()` in
-- `db/index.ts` with the 10 official codes DIAN publishes in
-- Resolución 042/2020 Anexo Técnico. Keyed by the 2-digit DIAN code
-- that the fiscal XML requires verbatim (11, 13, 22, 31, …).
--
-- NOT tenant-scoped: ISO-like regulated truth, identical across every
-- tenant. Distinct from the tenant-scoped `identification_types` table
-- which stores each tenant's custom catalog for UX flows.
--
-- Safe to run on every install for the same reason the ENG-017 locale
-- catalogs are: `drizzleMigrate()` runs before `runSchemaSync()`, and
-- `runSchemaSync()` uses `CREATE TABLE IF NOT EXISTS` as a fallback
-- for legacy installs. The adoption shim in `ensureMigrationBaseline()`
-- seeds every journal entry at adoption time so this migration never
-- races runSchemaSync on minimally-seeded adoption paths.
CREATE TABLE IF NOT EXISTS `dian_identification_types` (
	`code` text PRIMARY KEY NOT NULL,
	`abbr` text NOT NULL,
	`name_es` text NOT NULL,
	`name_en` text NOT NULL,
	`natural_person` integer DEFAULT 1 NOT NULL
);
