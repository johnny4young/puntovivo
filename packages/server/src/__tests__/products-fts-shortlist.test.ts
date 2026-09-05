import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import type { DatabaseInstance } from '../db/index.js';
import type { ExactProductSearchFilters } from '../services/products/exact-search.js';
import {
  buildProductFtsQuery,
  findFtsProductMatches,
  productSearchTenantScope,
  type FtsProductMatch,
  type ProductFtsTokenOperator,
} from '../services/products/fts-search.js';

let sqlite: Database.Database;
let db: DatabaseInstance;

beforeEach(() => {
  sqlite = new Database(':memory:');
  // Real FTS5 with the production column order, weights and tokenizer. Full
  // migrated-schema/backup/trigger coverage lives in semantic-candidates.test.
  sqlite.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, category_id TEXT,
      provider_id TEXT, is_active INTEGER, tracks_stock INTEGER, catalog_type TEXT
    );
    CREATE TABLE pharmacy_product_profiles (product_id TEXT, tenant_id TEXT);
    CREATE VIRTUAL TABLE product_search_fts USING fts5(
      product_id UNINDEXED, tenant_id UNINDEXED, tenant_scope, name, sku, barcode,
      description, active_ingredient, generic_name, manufacturer, sanitary_registration,
      tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4'
    );
  `);
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

function addProduct(index: number, tenant = 'tenant-a', flags = 0) {
  const id = `product-${String(index).padStart(3, '0')}`;
  const name = `Catalog Widget ${String(index).padStart(3, '0')}`;
  const { lastInsertRowid } = sqlite
    .prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?)')
    .run(
      id,
      tenant,
      name,
      flags & 1 ? 'cat-b' : 'cat-a',
      flags & 2 ? 'prov-b' : 'prov-a',
      flags & 4 ? 0 : 1,
      flags & 8 ? 0 : 1,
      'single'
    );
  sqlite
    .prepare('INSERT INTO product_search_fts VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      id,
      tenant,
      productSearchTenantScope(tenant),
      name,
      `SKU-${index}`,
      '',
      '',
      '',
      '',
      '',
      ''
    );
  const ftsRow = sqlite
    .prepare('SELECT rowid AS id FROM product_search_fts WHERE product_id=?')
    .get(id) as { id: number };
  expect(BigInt(ftsRow.id)).toBe(BigInt(lastInsertRowid));
  if (!(flags & 16)) {
    sqlite.prepare('INSERT INTO pharmacy_product_profiles VALUES (?,?)').run(id, tenant);
  }
  return id;
}

// Independent pre-optimization oracle: every identity guard is applied before
// ordering and LIMIT, including when corrupt FTS rows outrank valid matches.
function original(
  filters: ExactProductSearchFilters = {},
  limit = 7,
  operator: ProductFtsTokenOperator = 'OR',
  tenant = 'tenant-a',
  query = 'catalog widget'
) {
  const conditions = [
    'product_search_fts MATCH ?',
    'product_search_fts.tenant_id = ?',
    'products.tenant_id = ?',
    "products.catalog_type <> 'variant_parent'",
  ];
  const params: Array<string | number> = [
    buildProductFtsQuery(tenant, query, operator)!,
    tenant,
    tenant,
  ];
  if (filters.categoryId) {
    conditions.push('products.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.providerId) {
    conditions.push('products.provider_id = ?');
    params.push(filters.providerId);
  }
  if (filters.isActive !== undefined) {
    conditions.push('products.is_active = ?');
    params.push(Number(filters.isActive));
  }
  if (filters.tracksStock !== undefined) {
    conditions.push('products.tracks_stock = ?');
    params.push(Number(filters.tracksStock));
  }
  if (filters.pharmacyOnly) {
    conditions.push(
      'EXISTS (SELECT 1 FROM pharmacy_product_profiles WHERE product_id=products.id AND tenant_id=?)'
    );
    params.push(tenant);
  }
  return sqlite
    .prepare(
      `SELECT product_search_fts.product_id AS productId,
    bm25(product_search_fts,0.0,0.0,0.0,10.0,8.0,8.0,2.0,9.0,9.0,4.0,9.0) AS score
    FROM product_search_fts JOIN products ON products.rowid=product_search_fts.rowid
      AND products.id=product_search_fts.product_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY score,products.name COLLATE NOCASE,products.id LIMIT ?`
    )
    .all(...params, limit) as FtsProductMatch[];
}

function search(
  filters: ExactProductSearchFilters = {},
  limit = 7,
  operator: ProductFtsTokenOperator = 'OR',
  tenant = 'tenant-a',
  query = 'catalog widget'
) {
  return findFtsProductMatches(db, tenant, query, filters, limit, operator);
}

describe('bounded FTS identity validation', () => {
  it('matches full guarded scores and order across every filter shape, operator and cutoff', () => {
    for (let index = 0; index < 96; index++) addProduct(index, 'tenant-a', index % 32);
    addProduct(999, 'tenant-b');
    sqlite.exec("UPDATE products SET catalog_type='variant_parent' WHERE id='product-000'");
    for (let shape = 0; shape < 32; shape++) {
      for (const inverse of [false, true]) {
        const filters: ExactProductSearchFilters = {
          ...(shape & 1 ? { categoryId: inverse ? 'cat-b' : 'cat-a' } : {}),
          ...(shape & 2 ? { providerId: inverse ? 'prov-b' : 'prov-a' } : {}),
          ...(shape & 4 ? { isActive: !inverse } : {}),
          ...(shape & 8 ? { tracksStock: !inverse } : {}),
          ...(shape & 16 ? { pharmacyOnly: true } : {}),
        };
        for (const operator of ['AND', 'OR'] as const) {
          for (const limit of [1, 7, 200]) {
            const expected = original(filters, limit, operator);
            expect(expected.length).toBeGreaterThan(0);
            expect(search(filters, limit, operator)).toEqual(expected);
          }
        }
      }
    }
    expect(search({}, 7, 'OR', 'tenant-b').map(row => row.productId)).toEqual(['product-999']);
  });

  it.each(['product', 'tenant', 'null-product', 'null-tenant'] as const)(
    'refills from the full guarded set when more than a page has corrupt %s identity',
    mode => {
      for (let index = 0; index < 30; index++) addProduct(index);
      const field = mode.endsWith('tenant') || mode === 'tenant' ? 'tenant_id' : 'product_id';
      sqlite
        .prepare(`UPDATE product_search_fts SET ${field} = ? WHERE rowid <= 12`)
        .run(mode.startsWith('null') ? null : 'foreign');
      const expected = original({}, 7);
      expect(expected).toHaveLength(7);
      expect(expected[0]?.productId).toBe('product-012');
      const prepare = vi.spyOn(sqlite, 'prepare');
      expect(search({}, 7)).toEqual(expected);
      expect(prepare).toHaveBeenCalledTimes(2);
    }
  );

  it('keeps the fast path when invalid rows are strictly beyond the tied cutoff', () => {
    for (let index = 0; index < 20; index++) addProduct(index);
    sqlite.exec("UPDATE product_search_fts SET product_id='forged' WHERE rowid > 10");
    const expected = original({}, 7);
    const prepare = vi.spyOn(sqlite, 'prepare');
    expect(search({}, 7)).toEqual(expected);
    expect(prepare).toHaveBeenCalledTimes(1);
    const sql = prepare.mock.calls[0]![0];
    expect(sql).toContain('AS MATERIALIZED');
    expect(sql).toContain('LEFT JOIN product_search_fts');
    expect(sql).toContain('CASE WHEN candidates.productId');
  });

  it('uses authoritative case-insensitive names and ids to break score ties', () => {
    addProduct(0);
    addProduct(1);
    addProduct(2);
    // Deliberately stale indexed names must not define the business ordering.
    sqlite.exec(
      "UPDATE products SET name='aLPHA' WHERE id='product-002'; UPDATE products SET name='Alpha' WHERE id='product-001'"
    );
    expect(search({}, 1)).toEqual(original({}, 1));
    expect(search({}, 1)[0]?.productId).toBe('product-001');
  });

  it('matches the original guards for non-text and canonical indexed identities', () => {
    addProduct(0);
    sqlite.exec("UPDATE products SET id='123' WHERE id='product-000'");
    sqlite.prepare('UPDATE product_search_fts SET product_id=?').run(123n);
    expect(search()).toEqual(original());
    expect(search()).toEqual([]);
    sqlite.prepare('UPDATE product_search_fts SET product_id=?').run('123');
    expect(search()).toEqual(original());
    expect(search().map(row => row.productId)).toEqual(['123']);
  });

  it('observes corruption, new rows, live filters and rollback without caching results', () => {
    for (let index = 0; index < 12; index++) addProduct(index);
    expect(search()).toEqual(original());
    sqlite.exec("UPDATE product_search_fts SET tenant_id='wrong' WHERE rowid=1");
    expect(search()).toEqual(original());
    expect(search()[0]?.productId).toBe('product-001');
    addProduct(12);
    sqlite.exec("UPDATE products SET is_active=0 WHERE id='product-001'");
    expect(search({ isActive: false })).toEqual(original({ isActive: false }));
    sqlite.exec("BEGIN; UPDATE products SET name='ZZZZ' WHERE id='product-002'; ROLLBACK");
    expect(search()).toEqual(original());
  });

  it('does not admit a foreign product or pharmacy profile through a forged scope token', () => {
    addProduct(0, 'tenant-b');
    addProduct(1);
    addProduct(2);
    sqlite
      .prepare('UPDATE product_search_fts SET tenant_scope=? WHERE rowid=1')
      .run(productSearchTenantScope('tenant-a'));
    sqlite.exec(
      "UPDATE pharmacy_product_profiles SET tenant_id='tenant-b' WHERE product_id='product-001'"
    );
    expect(search({ pharmacyOnly: true })).toEqual(original({ pharmacyOnly: true }));
    expect(search({ pharmacyOnly: true }).map(row => row.productId)).toEqual(['product-002']);
  });
});
