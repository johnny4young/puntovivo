import { describe, expect, it } from 'vitest';
import {
  buildCartItem,
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  mergeCartItem,
} from '@/features/sales/saleCart';
import type { ProductSearchSelection } from '@/types';

function createSelection(
  overrides?: Partial<ProductSearchSelection['product']>
): ProductSearchSelection {
  return {
    product: {
      id: 'product-1',
      tenantId: 'tenant-1',
      name: 'Cable',
      sku: 'CABLE-01',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      stock: 10,
      minStock: 0,
      sellByFraction: false,
      fractionStep: null,
      fractionMinimum: null,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      unitAssignments: [
        {
          id: 'unit-assignment-1',
          productId: 'product-1',
          unitId: 'unit-1',
          unitName: 'Unidad',
          unitAbbreviation: 'UND',
          equivalence: 1,
          price: 10,
          isBase: true,
        },
      ],
      baseUnitId: 'unit-1',
      baseUnitName: 'Unidad',
      baseUnitAbbreviation: 'UND',
      baseUnitPrice: 10,
      ...overrides,
    },
    unit: {
      id: 'unit-assignment-1',
      productId: 'product-1',
      unitId: 'unit-1',
      unitName: 'Unidad',
      unitAbbreviation: 'UND',
      equivalence: 1,
      price: 10,
      isBase: true,
    },
    price: 10,
  };
}

describe('saleCart fraction policy helpers', () => {
  it('uses whole-unit defaults for non-fractional products', () => {
    const selection = createSelection();
    const item = buildCartItem(selection);

    expect(getSaleQuantityStep(item)).toBe(1);
    expect(getSaleMinimumQuantity(item)).toBe(1);
    expect(item.quantity).toBe(1);
  });

  it('uses configured step and minimum for fractional products', () => {
    const selection = createSelection({
      sellByFraction: true,
      fractionStep: 0.25,
      fractionMinimum: 0.5,
    });
    const item = buildCartItem(selection);

    expect(getSaleQuantityStep(item)).toBe(0.25);
    expect(getSaleMinimumQuantity(item)).toBe(0.5);
    expect(item.quantity).toBe(0.5);
  });

  it('increments existing fractional cart rows by the configured step', () => {
    const selection = createSelection({
      sellByFraction: true,
      fractionStep: 0.25,
      fractionMinimum: 0.5,
    });
    const firstItem = buildCartItem(selection);

    const merged = mergeCartItem([firstItem], selection);

    expect(merged[0]?.quantity).toBe(0.75);
  });
});
