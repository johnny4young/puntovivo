import type Database from 'better-sqlite3';
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  categories,
  locations,
  pharmacyProductProfiles,
  products,
  providers,
  tenants,
  vatRates,
} from '../db/schema.js';
import { productSelection } from '../services/products/product-read.js';
import { hydrateSearchProducts } from '../services/products/search-hydration.js';
import type { ExactProductSearchFilters } from '../services/products/exact-search.js';

let server: PuntovivoServer;
const ids = Array.from({ length: 32 }, (_, i) => `hydrate-${i}`);
beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  for (const tenant of ['hydrate-a', 'hydrate-b']) {
    db.insert(tenants).values({ id: tenant, name: tenant, slug: tenant }).run();
  }
  for (const id of ['category-a', 'category-b'])
    db.insert(categories).values({ id, tenantId: 'hydrate-a', name: id }).run();
  for (const id of ['provider-a', 'provider-b'])
    db.insert(providers).values({ id, tenantId: 'hydrate-a', name: id }).run();
  for (let i = 0; i < 32; i++) {
    db.insert(products)
      .values({
        id: ids[i]!,
        tenantId: 'hydrate-a',
        name: `Product ${i}`,
        sku: ids[i]!,
        categoryId: i & 1 ? 'category-b' : 'category-a',
        providerId: i & 2 ? 'provider-b' : 'provider-a',
        isActive: !(i & 4),
        tracksStock: !(i & 8),
        price: 123.45,
      })
      .run();
    if (!(i & 16))
      db.insert(pharmacyProductProfiles)
        .values({ productId: ids[i]!, tenantId: 'hydrate-a', activeIngredient: `Ingredient ${i}` })
        .run();
  }
  db.insert(products)
    .values({ id: 'hydrate-foreign', tenantId: 'hydrate-b', name: 'Foreign', sku: 'foreign' })
    .run();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await server?.close();
});

function original(tenant: string, productIds: string[], filters: ExactProductSearchFilters) {
  const conditions = [
    eq(products.tenantId, tenant),
    ne(products.catalogType, 'variant_parent'),
    inArray(products.id, productIds),
  ];
  if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));
  if (filters.providerId) conditions.push(eq(products.providerId, filters.providerId));
  if (filters.isActive !== undefined) conditions.push(eq(products.isActive, filters.isActive));
  if (filters.tracksStock !== undefined)
    conditions.push(eq(products.tracksStock, filters.tracksStock));
  if (filters.pharmacyOnly) conditions.push(isNotNull(pharmacyProductProfiles.productId));
  return getDatabase()
    .select(productSelection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(locations, eq(products.locationId, locations.id))
    .leftJoin(providers, eq(products.providerId, providers.id))
    .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
    .leftJoin(
      pharmacyProductProfiles,
      and(
        eq(pharmacyProductProfiles.productId, products.id),
        eq(pharmacyProductProfiles.tenantId, tenant)
      )
    )
    .where(and(...conditions))
    .all();
}
const sorted = <T extends { id: string }>(rows: T[]) =>
  rows.sort((a, b) => a.id.localeCompare(b.id));

describe('prepared search projection', () => {
  it('preserves the complete Drizzle DTO and bounds statements across every filter shape', () => {
    const db = getDatabase();
    const sqlite = (db as typeof db & { $client: Database.Database }).$client;
    const prepare = vi.spyOn(sqlite, 'prepare');
    for (let round = 0; round < 2; round++)
      for (let shape = 0; shape < 32; shape++) {
        const filters = {
          ...(shape & 1 ? { categoryId: round ? 'category-b' : 'category-a' } : {}),
          ...(shape & 2 ? { providerId: round ? 'provider-b' : 'provider-a' } : {}),
          ...(shape & 4 ? { isActive: !round } : {}),
          ...(shape & 8 ? { tracksStock: !round } : {}),
          ...(shape & 16 ? { pharmacyOnly: true } : {}),
        };
        const requested = [...ids, ids[0]!, 'hydrate-foreign'];
        const expected = original('hydrate-a', requested, filters);
        expect(expected.length).toBeGreaterThan(0);
        const before = prepare.mock.calls.length;
        expect(sorted(hydrateSearchProducts(db, 'hydrate-a', requested, filters))).toEqual(
          sorted(expected)
        );
        expect(prepare.mock.calls.length - before).toBe(round ? 0 : 1);
      }
    const plan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN ${prepare.mock.calls.find(([query]) => query.includes('AS search_ids'))![0]}`
      )
      .all(JSON.stringify(ids), 'hydrate-a', 'hydrate-a', 'variant_parent') as Array<{
      detail: string;
    }>;
    expect(
      plan.some(row =>
        /SEARCH products USING INDEX sqlite_autoindex_products_1 \(id=\?\)/.test(row.detail)
      )
    ).toBe(true);
    expect(
      plan.some(row => /SEARCH products USING INDEX idx_products_tenant /.test(row.detail))
    ).toBe(false);
    const before = prepare.mock.calls.length;
    expect(
      hydrateSearchProducts(db, 'hydrate-b', [...ids, 'hydrate-foreign'], {}).map(x => x.id)
    ).toEqual(['hydrate-foreign']);
    expect(hydrateSearchProducts(db, 'absent', ids, {})).toEqual([]);
    expect(hydrateSearchProducts(db, 'hydrate-a', [], {})).toEqual([]);
    expect(hydrateSearchProducts(db, 'hydrate-a', [`x' OR 1=1 --`], {})).toEqual([]);
    expect(prepare.mock.calls.length).toBe(before);
    prepare.mockRestore();
  });

  it('revalidates live prices, flags, catalog type and pharmacy ownership without result caching', () => {
    const db = getDatabase();
    const read = () =>
      hydrateSearchProducts(db, 'hydrate-a', [ids[0]!], { isActive: true, pharmacyOnly: true });
    expect(read()[0]?.pharmacy?.activeIngredient).toBe('Ingredient 0');
    db.update(products).set({ price: 456.78 }).where(eq(products.id, ids[0]!)).run();
    expect(read()[0]?.price).toBe(456.78);
    db.update(products).set({ isActive: false }).where(eq(products.id, ids[0]!)).run();
    expect(read()).toEqual([]);
    db.update(products)
      .set({ isActive: true, catalogType: 'variant_parent' })
      .where(eq(products.id, ids[0]!))
      .run();
    expect(read()).toEqual([]);
    db.update(products).set({ catalogType: 'standard' }).where(eq(products.id, ids[0]!)).run();
    db.update(pharmacyProductProfiles)
      .set({ tenantId: 'hydrate-b' })
      .where(eq(pharmacyProductProfiles.productId, ids[0]!))
      .run();
    expect(read()).toEqual([]);
    expect(hydrateSearchProducts(db, 'hydrate-a', [ids[0]!], {})[0]?.pharmacy).toBeNull();
    db.delete(products).where(eq(products.id, ids[0]!)).run();
    expect(read()).toEqual([]);
  });
});
