import { describe, expect, it } from 'vitest';

import type { ProductSearchItem, ProductUnitAssignment } from '@/types';

import { getDefaultProductUnit, getInitialProductSelection } from './productSearchSelection';

function productWithUnits(unitAssignments: ProductUnitAssignment[]): ProductSearchItem {
  return {
    id: 'product-1',
    unitAssignments,
  } as ProductSearchItem;
}

const secondaryUnit: ProductUnitAssignment = {
  id: 'assignment-2',
  unitId: 'unit-2',
  equivalence: 6,
  price: 60,
  isBase: false,
};

describe('product search selection', () => {
  it('returns null when a product has no assigned units', () => {
    const product = productWithUnits([]);

    expect(getDefaultProductUnit(product)).toBeNull();
    expect(getInitialProductSelection(product)).toBeNull();
  });

  it('prefers the base unit even when it is not first', () => {
    const baseUnit = { ...secondaryUnit, id: 'assignment-1', unitId: 'unit-1', isBase: true };
    const product = productWithUnits([secondaryUnit, baseUnit]);

    expect(getDefaultProductUnit(product)).toBe(baseUnit);
    expect(getInitialProductSelection(product)).toEqual({
      productId: product.id,
      unitId: baseUnit.unitId,
    });
  });

  it('falls back to the first unit when no assignment is marked as base', () => {
    const product = productWithUnits([secondaryUnit]);

    expect(getDefaultProductUnit(product)).toBe(secondaryUnit);
  });
});
