import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import type { DatabaseInstance } from '../db/index.js';
import { findExactProductMatches } from '../services/products/exact-search.js';
import type { ExactProductSearchFilters } from '../services/products/exact-search.js';

function fixture() {
  const sqlite = new Database(':memory:');
  // A narrow real-SQLite query fixture. The router/integration suite separately
  // qualifies these queries against the complete migrated application schema.
  sqlite.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sku TEXT, barcode TEXT,
      category_id TEXT, provider_id TEXT, is_active INTEGER DEFAULT 1,
      tracks_stock INTEGER DEFAULT 1, catalog_type TEXT DEFAULT 'single'
    );
    CREATE TABLE unit_x_product (product_id TEXT, barcode TEXT);
    CREATE TABLE pharmacy_product_profiles (
      product_id TEXT PRIMARY KEY, tenant_id TEXT, sanitary_registration_normalized TEXT
    );
    CREATE INDEX sku_scope ON products(tenant_id, sku);
    CREATE INDEX barcode_scope ON products(tenant_id, barcode);
    CREATE INDEX packaging_code ON unit_x_product(barcode);
    CREATE INDEX registration_scope ON pharmacy_product_profiles(tenant_id, sanitary_registration_normalized);
  `);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

let sqlite: Database.Database;
let db: DatabaseInstance;
function product(
  id: string,
  tenant = 'tenant-a',
  sku = 'MATCH',
  options: { category?: string; provider?: string; active?: number; stock?: number } = {}
) {
  sqlite
    .prepare(
      'INSERT INTO products(id,tenant_id,sku,category_id,provider_id,is_active,tracks_stock) VALUES(?,?,?,?,?,?,?)'
    )
    .run(
      id,
      tenant,
      sku,
      options.category ?? null,
      options.provider ?? null,
      options.active ?? 1,
      options.stock ?? 1
    );
}
function medicine(id: string, tenant = 'tenant-a', registration = 'MATCH') {
  sqlite
    .prepare('INSERT INTO pharmacy_product_profiles VALUES(?,?,?)')
    .run(id, tenant, registration);
}
function search(
  tenant = 'tenant-a',
  filters: ExactProductSearchFilters = {},
  limit = 20,
  q = 'MATCH'
) {
  return findExactProductMatches(db, tenant, q, filters, limit);
}

beforeEach(() => {
  ({ sqlite, db } = fixture());
});
afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

describe('prepared exact product search', () => {
  it('preserves priority, stable ordering, per-lane limits and dedup before the final limit', async () => {
    product('b-sku');
    product('a-sku');
    product('c-barcode', 'tenant-a', 'OTHER-C');
    product('d-packaging', 'tenant-a', 'OTHER-D');
    product('e-registration', 'tenant-a', 'OTHER-E');
    sqlite.exec("UPDATE products SET barcode='MATCH' WHERE id IN ('a-sku','c-barcode')");
    sqlite.exec(
      "INSERT INTO unit_x_product VALUES ('a-sku','MATCH'),('d-packaging','MATCH'),('d-packaging','MATCH')"
    );
    medicine('a-sku');
    medicine('e-registration');
    expect(await search()).toEqual([
      { productId: 'a-sku', kind: 'sku' },
      { productId: 'b-sku', kind: 'sku' },
      { productId: 'c-barcode', kind: 'barcode' },
      { productId: 'd-packaging', kind: 'unit-barcode' },
      { productId: 'e-registration', kind: 'sanitary-registration' },
    ]);
    expect((await search('tenant-a', {}, 4)).map(row => row.productId)).toEqual([
      'a-sku',
      'b-sku',
      'c-barcode',
      'd-packaging',
    ]);
    expect(await search('tenant-a', {}, 1)).toEqual([{ productId: 'a-sku', kind: 'sku' }]);
  });

  it('rebinds tenants and values on the same prepared shape without leaking codes or packaging', async () => {
    product('a', 'tenant-a', 'MATCH');
    product('b', 'tenant-b', 'MATCH');
    sqlite.exec("INSERT INTO unit_x_product VALUES ('a','PACK'),('b','PACK')");
    medicine('a', 'tenant-a', 'REG');
    medicine('b', 'tenant-b', 'REG');
    for (const q of ['MATCH', 'PACK', 'REG']) {
      expect((await search('tenant-a', {}, 20, q)).map(row => row.productId)).toEqual(['a']);
      expect((await search('tenant-b', {}, 20, q)).map(row => row.productId)).toEqual(['b']);
      expect(await search('missing', {}, 20, q)).toEqual([]);
    }
  });

  it('binds false filters and changing category/provider values before lane limits', async () => {
    product('a', 'tenant-a', 'MATCH', { category: 'ca', provider: 'pa', active: 1, stock: 1 });
    product('b', 'tenant-a', 'MATCH', { category: 'cb', provider: 'pb', active: 0, stock: 0 });
    for (let round = 0; round < 2; round++) {
      expect(
        (
          await search(
            'tenant-a',
            { categoryId: 'ca', providerId: 'pa', isActive: true, tracksStock: true },
            1
          )
        ).map(row => row.productId)
      ).toEqual(['a']);
      expect(
        (
          await search(
            'tenant-a',
            { categoryId: 'cb', providerId: 'pb', isActive: false, tracksStock: false },
            1
          )
        ).map(row => row.productId)
      ).toEqual(['b']);
      expect(
        await search(
          'tenant-a',
          { categoryId: 'ca', providerId: 'pb', isActive: false, tracksStock: false },
          1
        )
      ).toEqual([]);
    }
  });

  it('scopes both pharmacy profile and product, normalizes registration and excludes parents', async () => {
    product('valid', 'tenant-a', 'NORMAL');
    product('wrong-profile');
    product('wrong-product', 'tenant-b');
    product('parent');
    medicine('valid', 'tenant-a', 'REG123');
    medicine('wrong-profile', 'tenant-b');
    medicine('wrong-product', 'tenant-a');
    medicine('parent');
    sqlite.exec(
      "UPDATE products SET catalog_type='variant_parent',barcode='MATCH' WHERE id='parent'"
    );
    sqlite.exec("INSERT INTO unit_x_product VALUES ('parent','MATCH')");
    expect(await search('tenant-a', { pharmacyOnly: true })).toEqual([]);
    expect(await search('tenant-a', { pharmacyOnly: true }, 20, 'ＲＥＧ１２３')).toEqual([
      { productId: 'valid', kind: 'sanitary-registration' },
    ]);
    expect(await search()).toEqual([{ productId: 'wrong-profile', kind: 'sku' }]);
  });

  it('never interpolates untrusted query, tenant or filter values', async () => {
    product('a');
    for (const q of ["' OR 1=1 --", 'MATCH%']) {
      expect(await search('tenant-a', {}, 20, q)).toEqual([]);
      expect(await search(q)).toEqual([]);
      expect(await search('tenant-a', { categoryId: q, providerId: q })).toEqual([]);
    }
  });

  it('observes insert update delete and transaction rollback after preparing', async () => {
    expect(await search()).toEqual([]);
    product('a');
    expect((await search()).map(row => row.productId)).toEqual(['a']);
    sqlite.exec("UPDATE products SET sku='CHANGED' WHERE id='a'");
    expect(await search()).toEqual([]);
    expect((await search('tenant-a', {}, 20, 'CHANGED')).map(row => row.productId)).toEqual(['a']);
    sqlite.exec('BEGIN; DELETE FROM products; ROLLBACK');
    expect((await search('tenant-a', {}, 20, 'CHANGED')).map(row => row.productId)).toEqual(['a']);
    sqlite.exec('DELETE FROM products');
    expect(await search('tenant-a', {}, 20, 'CHANGED')).toEqual([]);
  });

  it('prepares no more than 32 filter shapes, not one statement per tenant or value', async () => {
    const prepare = vi.spyOn(sqlite, 'prepare');
    for (let round = 0; round < 2; round++) {
      for (let shape = 0; shape < 32; shape++) {
        await search(
          `tenant-${round}`,
          {
            ...(shape & 1 ? { categoryId: `category-${round}` } : {}),
            ...(shape & 2 ? { providerId: `provider-${round}` } : {}),
            ...(shape & 4 ? { isActive: round === 0 } : {}),
            ...(shape & 8 ? { tracksStock: round === 0 } : {}),
            ...(shape & 16 ? { pharmacyOnly: true } : {}),
          },
          round + 1,
          `QUERY-${round}`
        );
      }
    }
    expect(prepare).toHaveBeenCalledTimes(32);
  });

  it('keeps independent and recreated DB connections from reusing another native statement', async () => {
    product('first');
    expect((await search()).map(row => row.productId)).toEqual(['first']);
    const other = fixture();
    try {
      expect(await findExactProductMatches(other.db, 'tenant-a', 'MATCH', {}, 20)).toEqual([]);
      other.sqlite.exec(
        "INSERT INTO products(id,tenant_id,sku) VALUES('second','tenant-a','MATCH')"
      );
      expect(
        (await findExactProductMatches(other.db, 'tenant-a', 'MATCH', {}, 20)).map(
          row => row.productId
        )
      ).toEqual(['second']);
      expect((await search()).map(row => row.productId)).toEqual(['first']);
    } finally {
      other.sqlite.close();
    }
    sqlite.close();
    ({ sqlite, db } = fixture());
    expect(await search()).toEqual([]);
  });
});
