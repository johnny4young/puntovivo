/**
 * Products router read/projection helpers.
 *
 * ENG-178 — extracted verbatim from the former flat `trpc/routers/products.ts`
 * (1280 LOC) during the megafile decomposition. Holds the shared Drizzle
 * column projection (`productSelection`) and the relation-hydration reads used
 * by the query, mutation and semantic procedure modules. Import leaf: depends
 * only on the schema + drizzle, never on the sibling procedure modules.
 *
 * @module trpc/routers/products/product-read
 */
import { and, eq, inArray } from 'drizzle-orm';

import {
  categories,
  locations,
  products,
  productXProvider,
  providers,
  unitXProduct,
  units,
  vatRates,
} from '../../../db/schema.js';
import type { Context } from '../../context.js';

export const productSelection = {
  id: products.id,
  tenantId: products.tenantId,
  name: products.name,
  sku: products.sku,
  description: products.description,
  categoryId: products.categoryId,
  price: products.price,
  price2: products.price2,
  price3: products.price3,
  cost: products.cost,
  marginPercent1: products.marginPercent1,
  marginPercent2: products.marginPercent2,
  marginPercent3: products.marginPercent3,
  marginAmount1: products.marginAmount1,
  marginAmount2: products.marginAmount2,
  marginAmount3: products.marginAmount3,
  taxRate: products.taxRate,
  vatRateId: products.vatRateId,
  providerId: products.providerId,
  locationId: products.locationId,
  initialCost: products.initialCost,
  stock: products.stock,
  minStock: products.minStock,
  sellByFraction: products.sellByFraction,
  fractionStep: products.fractionStep,
  fractionMinimum: products.fractionMinimum,
  isActive: products.isActive,
  barcode: products.barcode,
  imageUrl: products.imageUrl,
  syncStatus: products.syncStatus,
  syncVersion: products.syncVersion,
  // ENG-177a — optimistic-concurrency token surfaced so the edit form can
  // round-trip it on update.
  version: products.version,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
  categoryName: categories.name,
  locationCode: locations.code,
  locationName: locations.name,
  providerName: providers.name,
  vatRateName: vatRates.name,
};

/**
 * Denormalized unit-to-product assignment row as returned by the batch loader
 * (`getUnitAssignmentsByProductIds`) and the single-product hydration. Joins
 * `unitXProduct` with `units`, so `unitName` / `unitAbbreviation` are nullable
 * when the joined unit row is missing.
 */
export type ProductUnitAssignmentRecord = {
  id: string;
  productId: string;
  unitId: string;
  unitName: string | null;
  unitAbbreviation: string | null;
  equivalence: number;
  price: number;
  isBase: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export async function getProductWithRelations(db: Context['db'], productId: string, tenantId: string) {
  const product = await db
    .select(productSelection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(locations, eq(products.locationId, locations.id))
    .leftJoin(providers, eq(products.providerId, providers.id))
    .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .get();

  if (!product) {
    return null;
  }

  const unitAssignments = await db
    .select({
      id: unitXProduct.id,
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      equivalence: unitXProduct.equivalence,
      price: unitXProduct.price,
      isBase: unitXProduct.isBase,
      createdAt: unitXProduct.createdAt,
      updatedAt: unitXProduct.updatedAt,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(eq(unitXProduct.productId, productId))
    .all();

  const providerAssignments = await db
    .select({
      id: productXProvider.id,
      productId: productXProvider.productId,
      providerId: productXProvider.providerId,
      providerName: providers.name,
      createdAt: productXProvider.createdAt,
      updatedAt: productXProvider.updatedAt,
    })
    .from(productXProvider)
    .innerJoin(providers, eq(productXProvider.providerId, providers.id))
    .where(eq(productXProvider.productId, productId))
    .all();

  return {
    ...product,
    unitAssignments,
    providerAssignments,
  };
}

export async function getUnitAssignmentsByProductIds(
  db: Context['db'],
  productIds: string[]
): Promise<Map<string, ProductUnitAssignmentRecord[]>> {
  if (productIds.length === 0) {
    return new Map();
  }

  const assignments = await db
    .select({
      id: unitXProduct.id,
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      equivalence: unitXProduct.equivalence,
      price: unitXProduct.price,
      isBase: unitXProduct.isBase,
      createdAt: unitXProduct.createdAt,
      updatedAt: unitXProduct.updatedAt,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(inArray(unitXProduct.productId, productIds))
    .all();

  const assignmentsMap = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const productAssignments = assignmentsMap.get(assignment.productId) ?? [];
    productAssignments.push(assignment);
    assignmentsMap.set(assignment.productId, productAssignments);
  }

  return assignmentsMap;
}
