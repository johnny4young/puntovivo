/**
 * Indexed exact-code candidate lookup for the interactive product search.
 *
 * SKU, base barcode, and packaging barcode are intentionally separate reads:
 * combining them with the substring fallback in one OR expression prevents
 * SQLite from taking the selective code indexes. Every branch applies the
 * product tenant boundary before returning an id.
 */
import { and, eq, ne, type SQL } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { products, unitXProduct } from '../../db/schema.js';

export type ExactProductMatchKind = 'sku' | 'barcode' | 'unit-barcode';

export interface ExactProductSearchFilters {
  categoryId?: string;
  providerId?: string;
  isActive?: boolean;
}

export interface ExactProductMatch {
  productId: string;
  kind: ExactProductMatchKind;
}

function productConditions(tenantId: string, filters: ExactProductSearchFilters): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [
    eq(products.tenantId, tenantId),
    ne(products.catalogType, 'variant_parent'),
  ];
  if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));
  if (filters.providerId) conditions.push(eq(products.providerId, filters.providerId));
  if (filters.isActive !== undefined) conditions.push(eq(products.isActive, filters.isActive));
  return conditions;
}

/**
 * Return de-duplicated exact matches in stable operator priority:
 * SKU, product barcode, then packaging barcode.
 */
export async function findExactProductMatches(
  db: DatabaseInstance,
  tenantId: string,
  query: string,
  filters: ExactProductSearchFilters,
  limit: number
): Promise<ExactProductMatch[]> {
  const conditions = productConditions(tenantId, filters);
  const [skuRows, barcodeRows, unitBarcodeRows] = await Promise.all([
    db
      .select({ productId: products.id })
      .from(products)
      .where(and(...conditions, eq(products.sku, query)))
      .orderBy(products.id)
      .limit(limit)
      .all(),
    db
      .select({ productId: products.id })
      .from(products)
      .where(and(...conditions, eq(products.barcode, query)))
      .orderBy(products.id)
      .limit(limit)
      .all(),
    db
      .select({ productId: products.id })
      .from(unitXProduct)
      .innerJoin(products, eq(unitXProduct.productId, products.id))
      .where(and(...conditions, eq(unitXProduct.barcode, query)))
      .orderBy(products.id)
      .limit(limit)
      .all(),
  ]);

  const matches: ExactProductMatch[] = [];
  const seen = new Set<string>();
  const append = (kind: ExactProductMatchKind, rows: Array<{ productId: string }>) => {
    for (const row of rows) {
      if (seen.has(row.productId)) continue;
      seen.add(row.productId);
      matches.push({ productId: row.productId, kind });
      if (matches.length === limit) return;
    }
  };

  append('sku', skuRows);
  if (matches.length < limit) append('barcode', barcodeRows);
  if (matches.length < limit) append('unit-barcode', unitBarcodeRows);
  return matches;
}
