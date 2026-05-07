-- ENG-036b — Pack Chile DTE 1.0: CAF (Códigos de Autorización de
-- Folios) metadata table.
--
-- The SII issues each emisor a signed XML CAF that authorizes
-- emission of a TipoDTE in a folio range [folio_desde, folio_hasta].
-- Mexico's CFDI 4.0 model has no equivalent — folios there come from
-- the CSD signing service. This table is Chile-specific.
--
-- Rules baked into the index design:
--
--   1. ONE active CAF per (tenant_id, tipo_dte). When `current_folio`
--      exceeds `folio_hasta`, the allocator atomically flips status
--      to 'exhausted' and the partial unique index frees the slot
--      for the next CAF the operator uploads. Chile law forbids
--      reusing exhausted folios.
--   2. CAFs are tenant-scoped. Cross-tenant lookups always join via
--      tenant_id; the `idx_fiscal_cafs_tenant` covers the common
--      "list active + exhausted CAFs" admin query.
--
-- The `raw_xml` column preserves the full CAF XML (DA + FRMA blocks)
-- so ENG-036c can extract the RSA key from FRMA for TED signing
-- without requiring a re-upload.
--
-- Both statements are `IF NOT EXISTS`-safe so the migration is
-- idempotent against DBs that already carry the target shape (the
-- ENG-002 adoption shim convention).

CREATE TABLE IF NOT EXISTS `fiscal_cafs` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `tipo_dte` text NOT NULL,
  `rut_emisor` text NOT NULL,
  `folio_desde` integer NOT NULL,
  `folio_hasta` integer NOT NULL,
  `current_folio` integer NOT NULL,
  `fecha_autorizacion` text NOT NULL,
  `raw_xml` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_fiscal_cafs_active`
  ON `fiscal_cafs` (`tenant_id`, `tipo_dte`)
  WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_cafs_tenant`
  ON `fiscal_cafs` (`tenant_id`, `status`);
