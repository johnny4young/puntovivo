import { describe, expect, it } from 'vitest';
import {
  areSerialSelectionsComplete,
  buildCartItem,
  getCartItemKey,
  getCartSummary,
  getCartDiscountAmount,
  getLineTotals,
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  mergeCartItem,
  updateCartItem,
  type SaleCartItem,
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
      tracksLots: false,
      isActive: true,
      version: 0,
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

  it('clamps fractional step to the 0.01 floor when fractionStep is missing/0/negative', () => {
    expect(getSaleQuantityStep({ sellByFraction: true, fractionStep: undefined })).toBe(0.01);
    expect(getSaleQuantityStep({ sellByFraction: true, fractionStep: 0 })).toBe(0.01);
    expect(getSaleQuantityStep({ sellByFraction: true, fractionStep: 0.5 })).toBe(0.5);
    expect(getSaleQuantityStep({ sellByFraction: false, fractionStep: 0.5 })).toBe(1);
  });

  it('falls back to step when fractionMinimum is missing for fractional products', () => {
    expect(
      getSaleMinimumQuantity({
        sellByFraction: true,
        fractionStep: 0.25,
        fractionMinimum: undefined,
      })
    ).toBe(0.25);
  });

  it('uses the larger of step and fractionMinimum', () => {
    expect(
      getSaleMinimumQuantity({
        sellByFraction: true,
        fractionStep: 0.25,
        fractionMinimum: 0.1,
      })
    ).toBe(0.25);
  });
});

describe('saleCart core helpers', () => {
  function makeItem(overrides?: Partial<SaleCartItem>): SaleCartItem {
    return {
      key: 'p1:u1',
      productId: 'p1',
      productName: 'X',
      productSku: 'X-1',
      unitId: 'u1',
      unitName: 'UND',
      unitEquivalence: 1,
      quantity: 2,
      unitPrice: 100,
      discount: 0,
      taxRate: 19,
      availableStock: 50,
      sellByFraction: false,
      fractionStep: null,
      fractionMinimum: null,
      ...overrides,
    };
  }

  it('getCartItemKey concatenates productId and unitId with a colon', () => {
    expect(getCartItemKey('product-1', 'unit-1')).toBe('product-1:unit-1');
  });

  it('updateCartItem merges allowed updates without mutating the original', () => {
    const item = makeItem();
    const updated = updateCartItem(item, { quantity: 5, discount: 10 });
    expect(updated.quantity).toBe(5);
    expect(updated.discount).toBe(10);
    // Other fields untouched.
    expect(updated.productId).toBe(item.productId);
    expect(item.quantity).toBe(2);
  });

  it('getLineTotals splits subtotal vs taxAmount on a taxed line', () => {
    const item = makeItem({ unitPrice: 100, quantity: 2, discount: 0, taxRate: 19 });
    const totals = getLineTotals(item);
    // gross = 200; subtotal = 200 / 1.19 ≈ 168.07; taxAmount ≈ 31.93.
    expect(totals.total).toBe(200);
    expect(totals.subtotal).toBeCloseTo(168.07, 2);
    expect(totals.taxAmount).toBeCloseTo(31.93, 2);
    expect(totals.normalizedQuantity).toBe(2);
  });

  it('getLineTotals applies a percent discount before splitting tax', () => {
    const item = makeItem({ unitPrice: 100, quantity: 1, discount: 50, taxRate: 0 });
    const totals = getLineTotals(item);
    // gross = 100; discount 50% → total 50; taxRate 0 → subtotal=total.
    expect(totals.total).toBe(50);
    expect(totals.subtotal).toBe(50);
    expect(totals.taxAmount).toBe(0);
  });

  it('getLineTotals normalizes quantity through unitEquivalence', () => {
    const item = makeItem({ quantity: 3, unitEquivalence: 12 });
    expect(getLineTotals(item).normalizedQuantity).toBe(36);
  });

  it('getCartSummary aggregates subtotals + taxes + counts across multiple lines', () => {
    const items = [
      makeItem({ key: 'p1:u1', quantity: 1, unitPrice: 100, taxRate: 19 }),
      makeItem({ key: 'p2:u1', quantity: 2, unitPrice: 50, taxRate: 0 }),
    ];
    const summary = getCartSummary(items);
    expect(summary.itemCount).toBe(3);
    expect(summary.total).toBe(200);
    // First line: total=100, taxAmount≈15.97, subtotal≈84.03
    // Second line: total=100, taxAmount=0, subtotal=100
    expect(summary.subtotal).toBeCloseTo(184.03, 2);
    expect(summary.taxAmount).toBeCloseTo(15.97, 2);
  });

  it('getCartSummary returns the zero summary for an empty cart', () => {
    expect(getCartSummary([])).toEqual({
      itemCount: 0,
      subtotal: 0,
      taxAmount: 0,
      total: 0,
    });
  });

  it('getCartDiscountAmount totals line-level percentage discounts', () => {
    expect(
      getCartDiscountAmount([
        makeItem({ key: 'p1:u1', quantity: 2, unitPrice: 100, discount: 10 }),
        makeItem({ key: 'p2:u1', quantity: 1, unitPrice: 50, discount: 20 }),
      ])
    ).toBe(30);
    expect(
      getCartDiscountAmount([
        makeItem({ key: 'p3:u1', unitPrice: 0.05, discount: 10 }),
        makeItem({ key: 'p4:u1', unitPrice: 0.05, discount: 10 }),
      ])
    ).toBe(0.02);
  });

  it('requires serialized identities to belong to the active site', () => {
    const serialized = makeItem({
      tracksSerials: true,
      serialIds: ['serial-1', 'serial-2'],
      serialSiteId: 'site-1',
    });

    expect(areSerialSelectionsComplete([serialized], 'site-1')).toBe(true);
    expect(areSerialSelectionsComplete([serialized], 'site-2')).toBe(false);
    expect(
      areSerialSelectionsComplete([{ ...serialized, serialSiteId: undefined }], 'site-1')
    ).toBe(false);
  });

  it('rejects incomplete and duplicate serialized selections across cart lines', () => {
    const first = makeItem({
      key: 'p1:u1',
      tracksSerials: true,
      serialIds: ['serial-1', 'serial-2'],
      serialSiteId: 'site-1',
    });
    const second = makeItem({
      key: 'p2:u1',
      tracksSerials: true,
      quantity: 1,
      serialIds: ['serial-2'],
      serialSiteId: 'site-1',
    });

    expect(areSerialSelectionsComplete([{ ...first, serialIds: ['serial-1'] }], 'site-1')).toBe(
      false
    );
    expect(areSerialSelectionsComplete([first, second], 'site-1')).toBe(false);
    expect(areSerialSelectionsComplete([makeItem()], 'site-1')).toBe(true);
  });
});
