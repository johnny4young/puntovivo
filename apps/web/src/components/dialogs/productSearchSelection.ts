/** Product-search selection primitives shared by the dialog sections. */
import type { ProductSearchItem, ProductUnitAssignment } from '@/types';

export interface ProductSelectionState {
  productId: string;
  unitId: string;
}

export const PRODUCT_SEARCH_UNIT_SELECT_ID = 'product-search-unit-select';

export function getDefaultProductUnit(
  product: ProductSearchItem | null
): ProductUnitAssignment | null {
  if (!product?.unitAssignments?.length) {
    return null;
  }

  return (
    product.unitAssignments.find(assignment => assignment.isBase) ??
    product.unitAssignments[0] ??
    null
  );
}

export function getInitialProductSelection(
  product: ProductSearchItem
): ProductSelectionState | null {
  const defaultUnit = getDefaultProductUnit(product);
  if (!defaultUnit) {
    return null;
  }

  return {
    productId: product.id,
    unitId: defaultUnit.unitId,
  };
}
