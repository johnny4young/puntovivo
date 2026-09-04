import { describe, expect, it } from 'vitest';
import { readExternalSaleEntry } from './externalSaleEntry';

describe('external sale navigation intent', () => {
  it.each([true, false])('preserves the explicit draft flag %s', draft => {
    expect(readExternalSaleEntry({ externalOrderSale: { id: 'sale-owned', draft } })).toEqual({
      id: 'sale-owned',
      draft,
    });
  });

  it.each([
    null,
    'sale',
    {},
    { omniboxQuery: 'product' },
    { externalOrderSale: null },
    { externalOrderSale: 'sale' },
    { externalOrderSale: { id: 1, draft: false } },
    { externalOrderSale: { id: '', draft: true } },
    { externalOrderSale: { id: ' ', draft: true } },
    { externalOrderSale: { id: 'sale' } },
    { externalOrderSale: { id: 'sale', draft: 'false' } },
  ])('ignores malformed or unrelated state %#', state => {
    expect(readExternalSaleEntry(state)).toBeNull();
  });
});
