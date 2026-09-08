/** Reusable SQL projection for the bounded interactive search shortlist. */
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  categories,
  locations,
  pharmacyProductProfiles,
  products,
  providers,
  vatRates,
} from '../../db/schema.js';
import type { ExactProductSearchFilters } from './exact-search.js';
import { productSelection } from './product-read.js';

function prepareHydration(db: DatabaseInstance, filters: ExactProductSearchFilters) {
  const tenant = sql.placeholder('tenant');
  const conditions = [eq(products.tenantId, tenant), ne(products.catalogType, 'variant_parent')];
  if (filters.categoryId) conditions.push(eq(products.categoryId, sql.placeholder('category')));
  if (filters.providerId) conditions.push(eq(products.providerId, sql.placeholder('provider')));
  if (filters.isActive !== undefined)
    conditions.push(eq(products.isActive, sql.placeholder('active')));
  if (filters.tracksStock !== undefined)
    conditions.push(eq(products.tracksStock, sql.placeholder('stock')));
  if (filters.pharmacyOnly) conditions.push(isNotNull(pharmacyProductProfiles.productId));
  return (
    db
      .select(productSelection)
      // Drive the read from bounded ids. IN (SELECT ... json_each) lets SQLite
      // choose a tenant-wide scan because it cannot estimate the bound list.
      .from(
        sql`(SELECT DISTINCT value AS id FROM json_each(${sql.placeholder('ids')})) AS search_ids`
      )
      .crossJoin(products)
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
      .where(and(...conditions, sql`${products.id} = search_ids.id`))
      .prepare()
  );
}

// Only 32 SQL/mapping shapes per database, never product rows or authorization
// verdicts. JSON binds the bounded id list without a statement per list length.
const statements = new WeakMap<
  DatabaseInstance,
  Map<number, ReturnType<typeof prepareHydration>>
>();

export function hydrateSearchProducts(
  db: DatabaseInstance,
  tenantId: string,
  productIds: readonly string[],
  filters: ExactProductSearchFilters
) {
  if (productIds.length === 0) return [];
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
  let statement = cache.get(shape);
  if (!statement) {
    statement = prepareHydration(db, filters);
    cache.set(shape, statement);
  }
  // Revalidate every filter against current authoritative rows, even though
  // candidate discovery checked them too. Never trust a supplied shortlist.
  return statement.all({
    tenant: tenantId,
    ids: JSON.stringify(productIds),
    ...(filters.categoryId ? { category: filters.categoryId } : {}),
    ...(filters.providerId ? { provider: filters.providerId } : {}),
    ...(filters.isActive !== undefined ? { active: Number(filters.isActive) } : {}),
    ...(filters.tracksStock !== undefined ? { stock: Number(filters.tracksStock) } : {}),
  });
}
