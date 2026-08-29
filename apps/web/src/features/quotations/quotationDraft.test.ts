import { describe, expect, it } from 'vitest';

import {
  applyQuotationPriceTier,
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
  price2: 100,
  price3: 90,
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
    priceEdited: false,
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

    const resolved = resolveQuotationLine(first, products, true);
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
    expect(resolveQuotationLine(draft({ [field]: value }), products, true).hasFieldError).toBe(
      true
    );
  });

  it('uses product VAT when the draft rate is blank and honors an explicit rate', () => {
    const fallback = resolveQuotationLine(draft(), products, true);
    const explicit = resolveQuotationLine(draft({ taxRateInput: '5' }), products, true);

    expect(fallback.effectiveTaxRate).toBe(19);
    expect(fallback.lineTax).toBeCloseTo(38);
    expect(explicit.effectiveTaxRate).toBe(5);
    expect(explicit.lineTax).toBeCloseTo(238 - 238 / 1.05);
  });

  it('adds the tax on top in exclusive pricing mode', () => {
    const line = resolveQuotationLine(draft({ unitPriceInput: '100' }), products, false);
    // Exclusive: base = 200, tax = 38, the customer pays 238.
    expect(line.lineTax).toBe(38);
    expect(line.total).toBe(238);

    expect(calculateQuotationTotals([line])).toEqual({
      subtotal: 200,
      taxAmount: 38,
      discountAmount: 0,
      total: 238,
    });
  });

  it('calculates tax-inclusive totals and percentage discounts across valid rows', () => {
    const discounted = resolveQuotationLine(draft({ discountInput: '10' }), products, true);
    const untaxed = resolveQuotationLine(
      draft({ rowId: 'line-2', quantityInput: '1', unitPriceInput: '50' }),
      new Map([[product.id, { ...product, taxRate: 0 }]]),
      true
    );

    expect(discounted.total).toBeCloseTo(214.2);
    expect(calculateQuotationTotals([discounted, untaxed])).toEqual({
      subtotal: 230,
      taxAmount: expect.closeTo(34.2),
      discountAmount: expect.closeTo(23.8),
      total: expect.closeTo(264.2),
    });
  });

  it('applies an explicit tier only to untouched prices on the product grid', () => {
    const untouched = draft();
    const edited = draft({ rowId: 'edited', unitPriceInput: '115', priceEdited: true });
    const labelled = draft({ rowId: 'labelled', unitPriceInput: '112', priceEdited: false });

    const repriced = applyQuotationPriceTier([untouched, edited, labelled], products, 3);

    expect(repriced.map(line => line.unitPriceInput)).toEqual(['90', '115', '112']);
  });

  it('falls back to tier 1 when a tier is not configured', () => {
    const fallbackProduct = { ...product, price2: 0 };
    const fallbackProducts = new Map([[fallbackProduct.id, fallbackProduct]]);

    expect(applyQuotationPriceTier([draft()], fallbackProducts, 2)[0]?.unitPriceInput).toBe('119');
  });
});
