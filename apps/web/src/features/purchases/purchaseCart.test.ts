import { describe, expect, it } from 'vitest';
import { createMockProduct } from '@/test/utils';
import type { ProductSearchSelection } from '@/types';
import {
  buildPurchaseCartItem,
  hasCompletePurchaseSerials,
  updatePurchaseCartSerialNumbers,
} from './purchaseCart';

function serializedSelection(): ProductSearchSelection {
  return {
    product: createMockProduct({ tracksSerials: true, stock: 0 }),
    unit: {
      id: 'assignment-1',
      unitId: 'unit-1',
      unitName: 'Unit',
      unitAbbreviation: 'EA',
      equivalence: 1,
      price: 100,
      isBase: true,
    },
    price: 100,
  };
}

describe('serialized purchase cart', () => {
  it('derives received quantity from normalized exact identities', () => {
    const initial = buildPurchaseCartItem(serializedSelection());
    const updated = updatePurchaseCartSerialNumbers(initial, ' sn-001\nＳＮ－００２ ');

    expect(updated.quantity).toBe(2);
    expect(updated.serialNumbers).toContain('ＳＮ－００２');
    expect(hasCompletePurchaseSerials([updated])).toBe(true);
  });

  it('keeps finalize blocked until a serialized line has at least one identity', () => {
    expect(hasCompletePurchaseSerials([buildPurchaseCartItem(serializedSelection())])).toBe(false);
  });

  it('keeps finalize blocked when normalized serial identities are duplicated', () => {
    const item = updatePurchaseCartSerialNumbers(
      buildPurchaseCartItem(serializedSelection()),
      'sn-001\nＳＮ－００１'
    );

    expect(item.quantity).toBe(1);
    expect(hasCompletePurchaseSerials([item])).toBe(false);
  });

  it('derives selected-unit quantity from physical serial count', () => {
    const selection = serializedSelection();
    const initial = buildPurchaseCartItem({
      ...selection,
      unit: { ...selection.unit, equivalence: 2 },
    });
    const updated = updatePurchaseCartSerialNumbers(initial, 'SN-001\nSN-002');

    expect(updated.quantity).toBe(1);
    expect(updated.quantity * updated.unitEquivalence).toBe(2);
  });
});
