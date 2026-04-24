-- ENG-020 Phase A — global DIAN identification types catalog.
--
-- Row content is populated on every boot by
-- `seedDianIdentificationTypes()` in `db/index.ts` (via the post-
-- migration `seedCatalogs()` hook) with the 10 official codes DIAN
-- publishes in Resolución 042/2020 Anexo Técnico. Keyed by the
-- 2-digit DIAN code that the fiscal XML requires verbatim
-- (11, 13, 22, 31, …).
--
-- NOT tenant-scoped: ISO-like regulated truth, identical across every
-- tenant. Distinct from the tenant-scoped `identification_types` table
-- which stores each tenant's custom catalog for UX flows.
--
-- `IF NOT EXISTS` is retained so this migration is idempotent against
-- the ENG-002 adoption shim (`ensureMigrationBaseline` pins the full
-- journal on DBs that reached the current shape via the now-retired
-- raw-DDL bootstrap — the table is already present there).
CREATE TABLE IF NOT EXISTS `dian_identification_types` (
	`code` text PRIMARY KEY NOT NULL,
	`abbr` text NOT NULL,
	`name_es` text NOT NULL,
	`name_en` text NOT NULL,
	`natural_person` integer DEFAULT 1 NOT NULL
);
