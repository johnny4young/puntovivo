import { describe, expect, it } from 'vitest';
import { getActiveCartSelectionKey, isEditableShortcutTarget } from '@/features/sales/salesKeyboard';
import type { SaleCartItem } from '@/features/sales/saleCart';

const sampleItems: SaleCartItem[] = [
  {
    key: 'product-a:base',
    productId: 'product-a',
    productName: 'Product A',
    productSku: 'A-001',
    unitId: 'base',
    unitName: 'UND',
    unitEquivalence: 1,
    quantity: 1,
    unitPrice: 1000,
    discount: 0,
    taxRate: 19,
    availableStock: 10,
  },
  {
    key: 'product-b:box',
    productId: 'product-b',
    productName: 'Product B',
    productSku: 'B-001',
    unitId: 'box',
    unitName: 'BOX',
    unitEquivalence: 6,
    quantity: 1,
    unitPrice: 6000,
    discount: 0,
    taxRate: 19,
    availableStock: 5,
  },
];

describe('salesKeyboard helpers', () => {
  it('detects editable shortcut targets', () => {
    expect(isEditableShortcutTarget(document.createElement('input'))).toBe(true);
    expect(isEditableShortcutTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableShortcutTarget(document.createElement('select'))).toBe(true);
    expect(isEditableShortcutTarget(document.createElement('div'))).toBe(false);
  });

  it('keeps the selected cart key when it still exists', () => {
    expect(getActiveCartSelectionKey(sampleItems, 'product-a:base')).toBe('product-a:base');
  });

  it('falls back to the last cart item when the selected key is gone', () => {
    expect(getActiveCartSelectionKey(sampleItems, 'missing')).toBe('product-b:box');
  });

  it('returns null when the cart is empty', () => {
    expect(getActiveCartSelectionKey([], 'missing')).toBeNull();
  });
});
