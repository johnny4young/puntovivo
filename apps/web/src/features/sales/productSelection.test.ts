import { describe, expect, it } from 'vitest';
import type { Product } from '@/types';
import { selectionFromHydratedProduct } from './productSelection';

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
