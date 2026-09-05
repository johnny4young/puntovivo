/**
 * Indexed exact-code candidate lookup for interactive product search.
 *
 * Each code lane retains its selective index and bounded result set. Reuse
 * prepared SQL by filter shape, never tenant values or results: compiling four
 * Drizzle queries for every scanner keystroke dominated the exact-code path.
 */
import type Database from 'better-sqlite3';

import type { DatabaseInstance } from '../../db/index.js';
import { normalizeSanitaryRegistration } from '../pharmacy/product-profile.js';

export type ExactProductMatchKind = 'sku' | 'barcode' | 'unit-barcode' | 'sanitary-registration';

export interface ExactProductSearchFilters {
  categoryId?: string;
  providerId?: string;
  isActive?: boolean;
  tracksStock?: boolean;
  pharmacyOnly?: boolean;
}

export interface ExactProductMatch {
  productId: string;
  kind: ExactProductMatchKind;
}

// Five presence flags produce at most 32 statements per connection. Weak
// ownership lets closing/replacing a database release all native statements.
const statements = new WeakMap<DatabaseInstance, Map<number, Database.Statement>>();

function exactStatement(db: DatabaseInstance, filters: ExactProductSearchFilters) {
  const shape =
    (filters.categoryId ? 1 : 0) |
    (filters.providerId ? 2 : 0) |
    (filters.isActive !== undefined ? 4 : 0) |
    (filters.tracksStock !== undefined ? 8 : 0) |
    (filters.pharmacyOnly ? 16 : 0);
  let cache = statements.get(db);
  if (!cache) {
    cache = new Map();
    statements.set(db, cache);
  }
  const cached = cache.get(shape);
  if (cached) return cached;

  const conditions = [
    'products.tenant_id = @tenantId',
    "products.catalog_type <> 'variant_parent'",
  ];
  if (filters.categoryId) conditions.push('products.category_id = @categoryId');
  if (filters.providerId) conditions.push('products.provider_id = @providerId');
  if (filters.isActive !== undefined) conditions.push('products.is_active = @isActive');
  if (filters.tracksStock !== undefined) conditions.push('products.tracks_stock = @tracksStock');
  if (filters.pharmacyOnly) {
    conditions.push(`EXISTS (
      SELECT 1 FROM pharmacy_product_profiles pharmacy_scope
      WHERE pharmacy_scope.product_id = products.id
        AND pharmacy_scope.tenant_id = @tenantId
    )`);
  }
  const where = conditions.join(' AND ');
  const lane = (kind: ExactProductMatchKind, priority: number, from: string, code: string) => `
    SELECT productId, '${kind}' AS kind, ${priority} AS priority FROM (
      SELECT products.id AS productId FROM ${from}
      WHERE ${where} AND ${code}
      ORDER BY products.id LIMIT @limit
    )`;
  // Only static SQL fragments enter this builder. Every caller-controlled
  // value, including tenant, normalized registration and limit, is bound.
  const query = [
    lane('sku', 0, 'products', 'products.sku = @query'),
    lane('barcode', 1, 'products', 'products.barcode = @query'),
    lane(
      'unit-barcode',
      2,
      'unit_x_product INNER JOIN products ON unit_x_product.product_id = products.id',
      'unit_x_product.barcode = @query'
    ),
    lane(
      'sanitary-registration',
      3,
      'pharmacy_product_profiles INNER JOIN products ON pharmacy_product_profiles.product_id = products.id',
      'pharmacy_product_profiles.tenant_id = @tenantId AND pharmacy_product_profiles.sanitary_registration_normalized = @registration'
    ),
  ].join(' UNION ALL ');
  const sqlite = (db as DatabaseInstance & { $client: Database.Database }).$client;
  const statement = sqlite.prepare(`${query} ORDER BY priority, productId`);
  cache.set(shape, statement);
  return statement;
}

/** Return de-duplicated exact matches in stable SKU/barcode/unit/registration priority. */
export async function findExactProductMatches(
  db: DatabaseInstance,
  tenantId: string,
  query: string,
  filters: ExactProductSearchFilters,
  limit: number
): Promise<ExactProductMatch[]> {
  const rows = exactStatement(db, filters).all({
    tenantId,
    query,
    registration: normalizeSanitaryRegistration(query),
    limit,
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.providerId ? { providerId: filters.providerId } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive ? 1 : 0 } : {}),
    ...(filters.tracksStock !== undefined ? { tracksStock: filters.tracksStock ? 1 : 0 } : {}),
  }) as ExactProductMatch[];

  const matches: ExactProductMatch[] = [];
  const seen = new Set<string>();
  for (const { productId, kind } of rows) {
    if (seen.has(productId)) continue;
    seen.add(productId);
    matches.push({ productId, kind });
    if (matches.length === limit) break;
  }
  return matches;
}
