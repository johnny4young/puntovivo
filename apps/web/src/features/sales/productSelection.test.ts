import { describe, expect, it } from 'vitest';
import type { Product } from '@/types';
import { quantityForAmount, selectionFromHydratedProduct } from './productSelection';

const product = {
  id: 'product-1',
  tenantId: 'tenant-1',
  name: 'Coffee',
  sku: 'COFFEE-1',
  price: 12,
  isActive: true,
} as Product;

describe('selectionFromHydratedProduct', () => {
  it('rejects a product without a sellable unit', () => {
    expect(selectionFromHydratedProduct(product)).toBeNull();
  });

  it('prefers the base unit and its price', () => {
    const selection = selectionFromHydratedProduct({
      ...product,
      unitAssignments: [
        {
          id: 'box-assignment',
          unitId: 'box',
          unitName: 'Box',
          equivalence: 6,
          price: 60,
          isBase: false,
        },
        {
          id: 'each-assignment',
          unitId: 'each',
          unitName: 'Each',
          equivalence: 1,
          price: 10,
          isBase: true,
        },
      ],
    });

    expect(selection).toMatchObject({
      product: {
        id: 'product-1',
        baseUnitId: 'each',
        baseUnitName: 'Each',
        baseUnitPrice: 10,
      },
      unit: {
        unitId: 'each',
        isBase: true,
      },
      price: 10,
    });
  });

  it('sells a requested unit while keeping the product base unit', () => {
    const selection = selectionFromHydratedProduct(
      {
        ...product,
        unitAssignments: [
          { id: 'each', unitId: 'each', unitName: 'Each', equivalence: 1, price: 10, isBase: true },
          { id: 'box', unitId: 'box', unitName: 'Box', equivalence: 6, price: 60, isBase: false },
        ],
      },
      'box'
    );

    expect(selection).toMatchObject({
      product: { baseUnitId: 'each', baseUnitPrice: 10 },
      unit: { unitId: 'box', isBase: false },
      price: 60,
    });
  });

  it('falls back to the first assignment when no unit is marked as base', () => {
    const selection = selectionFromHydratedProduct({
      ...product,
      unitAssignments: [
        {
          id: 'fallback-assignment',
          unitId: 'fallback',
          unitName: null,
          unitAbbreviation: null,
          equivalence: 1,
          price: 9,
          isBase: false,
        },
      ],
    });

    expect(selection).toMatchObject({
      product: {
        baseUnitId: 'fallback',
        baseUnitPrice: 9,
      },
      unit: {
        unitId: 'fallback',
        isBase: false,
      },
      price: 9,
    });
  });
});

describe('quantityForAmount', () => {
  const weighed = { sellByFraction: true, fractionStep: 0.001, fractionMinimum: 0.05 };

  it('rounds a weighed amount to the product step', () => {
    expect(quantityForAmount(5000, 24000, weighed)).toEqual({ quantity: 0.208 });
  });

  it('refuses amounts under the fraction minimum', () => {
    expect(quantityForAmount(500, 24000, weighed)).toEqual({
      error: 'belowMinimum',
      minimum: 0.05,
    });
  });

  it('only accepts exact multiples for whole-unit products', () => {
    expect(quantityForAmount(1500, 500, { sellByFraction: false })).toEqual({ quantity: 3 });
    expect(quantityForAmount(1200, 500, { sellByFraction: false })).toEqual({
      error: 'wholeUnits',
    });
  });

  it('rejects empty amounts and unpriced products', () => {
    expect(quantityForAmount(0, 500, { sellByFraction: false })).toEqual({ error: 'invalid' });
    expect(quantityForAmount(500, 0, weighed)).toEqual({ error: 'invalid' });
  });
});
