/**
 * Product/unit hydration for matched cart hints (ENG-040c). Private to
 * the parse-cart-command module group.
 *
 * @module services/ai/voice/parse-cart-command/hydrate
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../../../db/index.js';
import { products, unitXProduct, units } from '../../../../db/schema.js';
import type { MatchedCartProduct } from './types.js';

export async function hydrateCartProducts(
  db: DatabaseInstance,
  tenantId: string,
  productIds: string[]
): Promise<Map<string, MatchedCartProduct>> {
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      price: products.price,
      taxRate: products.taxRate,
      stock: products.stock,
      sellByFraction: products.sellByFraction,
      fractionStep: products.fractionStep,
      fractionMinimum: products.fractionMinimum,
    })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();

  const unitRows = await db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      equivalence: unitXProduct.equivalence,
      price: unitXProduct.price,
      isBase: unitXProduct.isBase,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(and(eq(units.tenantId, tenantId), inArray(unitXProduct.productId, productIds)))
    .all();

  const unitsByProduct = new Map<string, typeof unitRows>();
  for (const row of unitRows) {
    const bucket = unitsByProduct.get(row.productId) ?? [];
    bucket.push(row);
    unitsByProduct.set(row.productId, bucket);
  }

  const out = new Map<string, MatchedCartProduct>();
  for (const product of productRows) {
    const unitsForProduct = unitsByProduct.get(product.id) ?? [];
    if (unitsForProduct.length === 0) continue;
    const baseUnit = unitsForProduct.find(u => u.isBase === true) ?? unitsForProduct[0];
    if (!baseUnit) continue;
    out.set(product.id, {
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      unitId: baseUnit.unitId,
      unitName: baseUnit.unitName,
      unitAbbreviation: baseUnit.unitAbbreviation,
      unitEquivalence: baseUnit.equivalence,
      // unit-specific selling price; falls back to the product's base
      // price when the unit row carries 0 (defensive — seeded data
      // sometimes leaves the unit-level price unfilled).
      unitPrice: baseUnit.price && baseUnit.price > 0 ? baseUnit.price : product.price,
      taxRate: product.taxRate ?? 0,
      stock: product.stock ?? 0,
      sellByFraction: product.sellByFraction ?? false,
      fractionStep: product.fractionStep,
      fractionMinimum: product.fractionMinimum,
      // similarity is supplied by the caller after the cosine pass;
      // placeholder here so the type stays uniform.
      similarity: 0,
    });
  }
  return out;
}
