import { describe, expect, it } from 'vitest';

import {
  calculateQuotationTotals,
  createEmptyQuotationLine,
  parseQuotationNumber,
  resolveQuotationLine,
  type DraftLine,
  type ProductOption,
} from './quotationDraft';

const product: ProductOption = {
  id: 'product-1',
  name: 'Café',
  sku: 'CAFE-1',
  price: 119,
  taxRate: 19,
};

const products = new Map([[product.id, product]]);

function draft(overrides: Partial<DraftLine> = {}): DraftLine {
  return {
    rowId: 'line-test',
    productId: product.id,
    quantityInput: '2',
    unitPriceInput: '119',
    discountInput: '0',
    taxRateInput: '',
    ...overrides,
  };
}

describe('quotation draft lines', () => {
  it('creates neutral rows with stable, unique React keys', () => {
    const first = createEmptyQuotationLine();
    const second = createEmptyQuotationLine();

    expect(first).toMatchObject({
      productId: '',
      quantityInput: '1',
      unitPriceInput: '',
      discountInput: '0',
      taxRateInput: '',
    });
    expect(first.rowId).not.toBe(second.rowId);

    const resolved = resolveQuotationLine(first, products);
    expect(resolved).toMatchObject({ isEmpty: true, hasFieldError: false, total: 0 });
  });

  it('normalizes blank numbers to zero and preserves invalid input as NaN', () => {
    expect(parseQuotationNumber('  ')).toBe(0);
    expect(parseQuotationNumber('12.5')).toBe(12.5);
    expect(parseQuotationNumber('not-a-number')).toBeNaN();
  });

  it.each([
    ['quantityInput', '0'],
    ['quantityInput', 'invalid'],
    ['unitPriceInput', '-1'],
    ['discountInput', '-1'],
    ['discountInput', '101'],
    ['taxRateInput', '-1'],
  ] as const)('flags invalid selected-line input %s=%s', (field, value) => {
    expect(resolveQuotationLine(draft({ [field]: value }), products).hasFieldError).toBe(true);
  });

  it('uses product VAT when the draft rate is blank and honors an explicit rate', () => {
    const fallback = resolveQuotationLine(draft(), products);
    const explicit = resolveQuotationLine(draft({ taxRateInput: '5' }), products);

    expect(fallback.effectiveTaxRate).toBe(19);
    expect(fallback.lineTax).toBeCloseTo(38);
    expect(explicit.effectiveTaxRate).toBe(5);
    expect(explicit.lineTax).toBeCloseTo(238 - 238 / 1.05);
  });

  it('calculates tax-inclusive totals and percentage discounts across valid rows', () => {
    const discounted = resolveQuotationLine(draft({ discountInput: '10' }), products);
    const untaxed = resolveQuotationLine(
      draft({ rowId: 'line-2', quantityInput: '1', unitPriceInput: '50' }),
      new Map([[product.id, { ...product, taxRate: 0 }]])
    );

    expect(discounted.total).toBeCloseTo(214.2);
    expect(calculateQuotationTotals([discounted, untaxed])).toEqual({
      subtotal: 230,
      taxAmount: expect.closeTo(34.2),
      discountAmount: expect.closeTo(23.8),
      total: expect.closeTo(264.2),
    });
  });
});
