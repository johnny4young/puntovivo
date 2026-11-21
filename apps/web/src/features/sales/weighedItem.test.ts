import { describe, expect, it } from 'vitest';
import { buildCartItem, updateCartItem } from '@/features/sales/saleCart';
import {
  applyWeighedQuantity,
  gramsPerUnit,
  kilogramsOf,
  quantityForWeight,
} from '@/features/sales/weighedItem';
import type { ProductSearchSelection } from '@/types';

function selection(
  unit: Partial<ProductSearchSelection['unit']> = {},
  product: Partial<ProductSearchSelection['product']> = {}
): ProductSearchSelection {
  return {
    product: {
      id: 'p-kg',
      name: 'Queso costeño',
      sku: 'QSO-1',
      price: 24000,
      price2: 24000,
      price3: 24000,
      stock: 10,
      sellByFraction: true,
      fractionStep: 0.001,
      fractionMinimum: 0.05,
      ...product,
    } as ProductSearchSelection['product'],
    unit: {
      id: 'ua-1',
      unitId: 'u-kg',
      unitName: 'kg',
      equivalence: 1,
      price: 24000,
      isBase: true,
      unitDimension: 'mass',
      unitReferenceFactor: 1000,
      ...unit,
    },
    price: 24000,
  };
}

describe('gramsPerUnit', () => {
  it('reads the grams of a fractional mass unit', () => {
    expect(gramsPerUnit(selection())).toBe(1000);
    expect(gramsPerUnit(selection({ unitReferenceFactor: 1 }))).toBe(1);
  });

  it('ignores whole-unit products, other dimensions and unknown factors', () => {
    expect(gramsPerUnit(selection({}, { sellByFraction: false }))).toBeNull();
    expect(gramsPerUnit(selection({ unitDimension: 'volume' }))).toBeNull();
    expect(gramsPerUnit(selection({ unitReferenceFactor: null }))).toBeNull();
    const legacyUnit = { ...selection().unit };
    delete legacyUnit.unitDimension;
    expect(gramsPerUnit({ ...selection(), unit: legacyUnit })).toBeNull();
  });
});

describe('quantityForWeight', () => {
  it('converts kilograms into the sale unit on the product step', () => {
    expect(quantityForWeight(0.25, 1000, selection().product)).toEqual({ quantity: 0.25 });
    expect(quantityForWeight(0.25, 1, selection().product)).toEqual({ quantity: 250 });
    expect(quantityForWeight(0.3334, 1000, selection().product)).toEqual({ quantity: 0.333 });
  });

  it('refuses zero and weights under the minimum', () => {
    expect(quantityForWeight(0, 1000, selection().product)).toEqual({ error: 'invalid' });
    expect(quantityForWeight(0.02, 1000, selection().product)).toEqual({
      error: 'belowMinimum',
      minimum: 0.05,
    });
  });

  it('reads a sale quantity back in kilograms', () => {
    expect(kilogramsOf(250, 1)).toBe(0.25);
    expect(kilogramsOf(0.208, 1000)).toBe(0.208);
  });
});

describe('applyWeighedQuantity', () => {
  it('adds a new line with the weight', () => {
    const items = applyWeighedQuantity([], selection(), 0, 0.25);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'p-kg:u-kg', quantity: 0.25, priceEdited: false });
  });

  it('replaces its own share when the weight is corrected', () => {
    const first = applyWeighedQuantity([], selection(), 0, 0.25);
    expect(applyWeighedQuantity(first, selection(), 0.25, 0.5)[0]?.quantity).toBe(0.5);
  });

  it('keeps what the line already had before this weighing', () => {
    const existing = [updateCartItem(buildCartItem(selection()), { quantity: 1 })];
    const added = applyWeighedQuantity(existing, selection(), 0, 0.25);
    expect(added[0]?.quantity).toBe(1.25);
    expect(applyWeighedQuantity(added, selection(), 0.25, 0.5)[0]?.quantity).toBe(1.5);
  });

  it('never goes below the new weight after the line was edited down', () => {
    const edited = [updateCartItem(buildCartItem(selection()), { quantity: 0.1 })];
    expect(applyWeighedQuantity(edited, selection(), 0.25, 0.5)[0]?.quantity).toBe(0.5);
  });
});
