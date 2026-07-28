import type { Product, ProductSearchSelection } from '@/types';

/**
 * Builds the canonical cart selection from a fully hydrated product.
 *
 * Product list rows intentionally omit unit assignments. Callers that start
 * from products.list must fetch products.getById before using this helper.
 */
export function selectionFromHydratedProduct(
  product: Product
): ProductSearchSelection | null {
  const baseUnit =
    product.unitAssignments?.find(assignment => assignment.isBase) ??
    product.unitAssignments?.[0];
  if (!baseUnit) return null;

  const price = baseUnit.price ?? product.price;
  return {
    product: {
      ...product,
      baseUnitId: baseUnit.unitId,
      baseUnitName: baseUnit.unitName ?? null,
      baseUnitAbbreviation: baseUnit.unitAbbreviation ?? null,
      baseUnitPrice: price,
    },
    unit: {
      ...baseUnit,
      isBase: baseUnit.isBase ?? true,
    },
    price,
  };
}
