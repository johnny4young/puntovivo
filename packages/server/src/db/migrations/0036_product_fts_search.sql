-- C2: tenant-scoped literal candidates. `tenant_scope` is an indexed,
-- collision-free hex token used inside MATCH; `tenant_id` remains stored but
-- UNINDEXED so the authoritative product join can independently re-check it.
CREATE VIRTUAL TABLE IF NOT EXISTS `product_search_fts` USING fts5(
  `product_id` UNINDEXED,
  `tenant_id` UNINDEXED,
  `tenant_scope`,
  `name`,
  `sku`,
  `barcode`,
  `description`,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);--> statement-breakpoint

INSERT OR REPLACE INTO `product_search_fts`(
  rowid,
  product_id,
  tenant_id,
  tenant_scope,
  name,
  sku,
  barcode,
  description
)
SELECT
  rowid,
  id,
  tenant_id,
  't' || lower(hex(cast(tenant_id AS blob))),
  name,
  sku,
  coalesce(barcode, ''),
  coalesce(description, '')
FROM products
WHERE catalog_type <> 'variant_parent';--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `products_search_fts_ai`
AFTER INSERT ON products
WHEN new.catalog_type <> 'variant_parent'
BEGIN
  INSERT INTO `product_search_fts`(
    rowid,
    product_id,
    tenant_id,
    tenant_scope,
    name,
    sku,
    barcode,
    description
  ) VALUES (
    new.rowid,
    new.id,
    new.tenant_id,
    't' || lower(hex(cast(new.tenant_id AS blob))),
    new.name,
    new.sku,
    coalesce(new.barcode, ''),
    coalesce(new.description, '')
  );
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `products_search_fts_ad`
AFTER DELETE ON products
WHEN old.catalog_type <> 'variant_parent'
BEGIN
  DELETE FROM `product_search_fts` WHERE rowid = old.rowid;
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `products_search_fts_au`
AFTER UPDATE OF id, tenant_id, name, sku, barcode, description, catalog_type ON products
BEGIN
  DELETE FROM `product_search_fts` WHERE rowid = old.rowid;
  INSERT INTO `product_search_fts`(
    rowid,
    product_id,
    tenant_id,
    tenant_scope,
    name,
    sku,
    barcode,
    description
  )
  SELECT
    new.rowid,
    new.id,
    new.tenant_id,
    't' || lower(hex(cast(new.tenant_id AS blob))),
    new.name,
    new.sku,
    coalesce(new.barcode, ''),
    coalesce(new.description, '')
  WHERE new.catalog_type <> 'variant_parent';
END;
