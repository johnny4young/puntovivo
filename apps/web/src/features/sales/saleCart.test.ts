import { describe, expect, it } from 'vitest';
import {
  applyPriceTier,
  buildCartItem,
  canChangeCartItemUnit,
  changeCartItemUnit,
  getCartItemKey,
  getCartItemListPrice,
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  getBarcodeCartItemKey,
  mergeBarcodeCartItem,
  mergeCartItem,
  resolveRegisterAddQuantity,
  updateCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import {
  areSerialSelectionsComplete,
  getCartSummary,
  getLineTotals,
} from '@/features/sales/saleCartTotals';
import { getCartDiscountAmount, isCartPriceOverride } from '@/features/sales/saleApprovalPricing';
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

  it('adds one whole unit of a fractional product when no weight or quantity was typed', () => {
    const weighed = createSelection({
      sellByFraction: true,
      fractionStep: 0.001,
      fractionMinimum: 0.001,
    });
    expect(resolveRegisterAddQuantity(weighed.product, null)).toBe(1);
    expect(resolveRegisterAddQuantity(weighed.product, 0.25)).toBe(0.25);
    expect(
      resolveRegisterAddQuantity(
        createSelection({ sellByFraction: true, fractionStep: 0.5, fractionMinimum: 2 }).product,
        null
      )
    ).toBe(2);
    expect(resolveRegisterAddQuantity(createSelection().product, null)).toBeNull();

    const added = mergeBarcodeCartItem([], weighed, {
      quantity: resolveRegisterAddQuantity(weighed.product, null),
      price: null,
    });
    expect(added[0]?.quantity).toBe(1);
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

  it('clamps fractional step to the 0.001 UI floor when fractionStep is missing/0/negative', () => {
    expect(getSaleQuantityStep({ sellByFraction: true, fractionStep: undefined })).toBe(0.001);
    expect(getSaleQuantityStep({ sellByFraction: true, fractionStep: 0 })).toBe(0.001);
    expect(getSaleQuantityStep({ sellByFraction: true, fractionStep: 0.5 })).toBe(0.5);
    expect(getSaleQuantityStep({ sellByFraction: false, fractionStep: 0.5 })).toBe(1);
  });

  it('preserves thousandth quantities from weighted products and increments them exactly', () => {
    const selection = createSelection({
      sellByFraction: true,
      fractionStep: 0.001,
      fractionMinimum: 0.001,
    });

    const first = buildCartItem(selection);
    expect(first.quantity).toBe(0.001);
    expect(mergeCartItem([first], selection)[0]?.quantity).toBe(0.002);
  });

  it('adds each scanned GS1 weight instead of replacing the previous package', () => {
    const selection = createSelection({
      sellByFraction: true,
      fractionStep: 0.001,
      fractionMinimum: 0.001,
    });

    const first = mergeBarcodeCartItem([], selection, { quantity: 0.199, price: null });
    const second = mergeBarcodeCartItem(first, selection, { quantity: 0.275, price: null });

    expect(second).toHaveLength(1);
    expect(second[0]?.quantity).toBe(0.474);
  });

  it('keeps differently priced GS1 packages on exact independent lines', () => {
    const selection = createSelection({ sellByFraction: false });
    const firstSelection = { ...selection, price: 1.99 };
    const secondSelection = { ...selection, price: 2.49 };

    const first = mergeBarcodeCartItem([], firstSelection, { quantity: null, price: 1.99 });
    const second = mergeBarcodeCartItem(first, secondSelection, {
      quantity: null,
      price: 2.49,
    });
    const repeated = mergeBarcodeCartItem(second, firstSelection, {
      quantity: null,
      price: 1.99,
    });

    expect(repeated).toHaveLength(2);
    expect(repeated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: getBarcodeCartItemKey(firstSelection, 1.99),
          quantity: 2,
          unitPrice: 1.99,
          priceEdited: true,
        }),
        expect.objectContaining({
          key: getBarcodeCartItemKey(secondSelection, 2.49),
          quantity: 1,
          unitPrice: 2.49,
          priceEdited: true,
        }),
      ])
    );
    expect(
      applyPriceTier(repeated, 2)
        .map(item => item.unitPrice)
        .sort()
    ).toEqual([1.99, 2.49]);
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

describe('saleCart service items', () => {
  it('marks a service line so the cart drops its stock semantics', () => {
    const item = buildCartItem(createSelection({ tracksStock: false, stock: 0 }));

    expect(item.tracksStock).toBe(false);
  });

  it('treats an explicit and an absent flag alike as physical', () => {
    expect(buildCartItem(createSelection({ tracksStock: true })).tracksStock).toBe(true);
    // Rows cached before the column shipped carry no flag.
    const legacy = createSelection();
    delete (legacy.product as { tracksStock?: boolean }).tracksStock;
    expect(buildCartItem(legacy).tracksStock).toBe(true);
  });
});

describe('saleCart site stock', () => {
  it('shows what the active site can sell, not the tenant-wide total', () => {
    expect(buildCartItem(createSelection({ stock: 28, siteStock: 17 })).availableStock).toBe(17);
    expect(buildCartItem(createSelection({ stock: 28, siteStock: 0 })).availableStock).toBe(0);
  });

  it('falls back to the tenant total when the read carried no site', () => {
    expect(buildCartItem(createSelection({ stock: 28, siteStock: null })).availableStock).toBe(28);
    expect(buildCartItem(createSelection({ stock: 28 })).availableStock).toBe(28);
  });

  it('refreshes the site figure when the product is added again', () => {
    const first = mergeCartItem([], createSelection({ stock: 28, siteStock: 17 }));
    const second = mergeCartItem(first, createSelection({ stock: 27, siteStock: 16 }));
    const scanned = mergeBarcodeCartItem(second, createSelection({ stock: 26, siteStock: 15 }), {
      quantity: 1,
      price: null,
    });

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ quantity: 2, availableStock: 16 });
    expect(scanned[0]).toMatchObject({ quantity: 3, availableStock: 15 });
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
    const totals = getLineTotals(item, true);
    // gross = 200; subtotal = 200 / 1.19 ≈ 168.07; taxAmount ≈ 31.93.
    expect(totals.total).toBe(200);
    expect(totals.subtotal).toBeCloseTo(168.07, 2);
    expect(totals.taxAmount).toBeCloseTo(31.93, 2);
    expect(totals.normalizedQuantity).toBe(2);
  });

  it('getLineTotals applies a percent discount before splitting tax', () => {
    const item = makeItem({ unitPrice: 100, quantity: 1, discount: 50, taxRate: 0 });
    const totals = getLineTotals(item, true);
    // gross = 100; discount 50% → total 50; taxRate 0 → subtotal=total.
    expect(totals.total).toBe(50);
    expect(totals.subtotal).toBe(50);
    expect(totals.taxAmount).toBe(0);
  });

  it('getLineTotals normalizes quantity through unitEquivalence', () => {
    const item = makeItem({ quantity: 3, unitEquivalence: 12 });
    expect(getLineTotals(item, true).normalizedQuantity).toBe(36);
  });

  it('getCartSummary aggregates subtotals + taxes + counts across multiple lines', () => {
    const items = [
      makeItem({ key: 'p1:u1', quantity: 1, unitPrice: 100, taxRate: 19 }),
      makeItem({ key: 'p2:u1', quantity: 2, unitPrice: 50, taxRate: 0 }),
    ];
    const summary = getCartSummary(items, true);
    expect(summary.itemCount).toBe(3);
    expect(summary.total).toBe(200);
    // A measured line counts as one article, not as its metres or kilograms.
    const measured = getCartSummary(
      [...items, makeItem({ key: 'p3:u1', quantity: 37.5, sellByFraction: true })],
      true
    );
    expect(measured.itemCount).toBe(4);
    // First line: total=100, taxAmount≈15.97, subtotal≈84.03
    // Second line: total=100, taxAmount=0, subtotal=100
    expect(summary.subtotal).toBeCloseTo(184.03, 2);
    expect(summary.taxAmount).toBeCloseTo(15.97, 2);
  });

  it('getLineTotals adds the tax on top in exclusive mode', () => {
    const item = makeItem({ unitPrice: 100, quantity: 2, discount: 0, taxRate: 19 });
    const totals = getLineTotals(item, false);
    // Exclusive: base = 200, tax = 38, customer pays 238.
    expect(totals.subtotal).toBe(200);
    expect(totals.taxAmount).toBe(38);
    expect(totals.total).toBe(238);
  });

  it('getCartSummary threads the exclusive mode into every line', () => {
    const items = [
      makeItem({ key: 'p1:u1', quantity: 1, unitPrice: 100, taxRate: 19 }),
      makeItem({ key: 'p2:u1', quantity: 2, unitPrice: 50, taxRate: 0 }),
    ];
    const summary = getCartSummary(items, false);
    expect(summary.subtotal).toBe(200);
    expect(summary.taxAmount).toBe(19);
    expect(summary.total).toBe(219);
  });

  it('applyPriceTier reprices base-unit lines through the shared resolver', () => {
    const items = [
      makeItem({
        key: 'p1:u1',
        unitPrice: 1000,
        tierPrices: { price: 1000, price2: 800, price3: 700 },
        catalogUnitPrice: 1000,
        isBaseUnit: true,
      }),
    ];
    const atTier2 = applyPriceTier(items, 2);
    expect(atTier2[0]?.unitPrice).toBe(800);
    // Round-trips back to retail.
    expect(applyPriceTier(atTier2, 1)[0]?.unitPrice).toBe(1000);
  });

  it('applyPriceTier never clobbers a hand-edited price', () => {
    const item = makeItem({
      unitPrice: 1000,
      tierPrices: { price: 1000, price2: 800, price3: 700 },
      catalogUnitPrice: 1000,
      isBaseUnit: true,
    });
    const edited = updateCartItem(item, { unitPrice: 950 });
    expect(edited.priceEdited).toBe(true);
    expect(applyPriceTier([edited], 2)[0]?.unitPrice).toBe(950);
  });

  it('applyPriceTier leaves lines without tier metadata untouched', () => {
    const legacy = makeItem({ unitPrice: 1234 });
    expect(applyPriceTier([legacy], 3)[0]?.unitPrice).toBe(1234);
  });

  it('applyPriceTier never touches a price off the tier grid (GS1 label price)', () => {
    // A scale label embedded 856 for a product whose catalog tiers are
    // 1000/800/700: no tier matches, so neither a tier switch nor the
    // idempotent re-apply on every cart update may reset it.
    const scanned = makeItem({
      unitPrice: 856,
      tierPrices: { price: 1000, price2: 800, price3: 700 },
      catalogUnitPrice: 1000,
      isBaseUnit: true,
    });
    expect(applyPriceTier([scanned], 1)[0]?.unitPrice).toBe(856);
    expect(applyPriceTier([scanned], 2)[0]?.unitPrice).toBe(856);
  });

  it('matches the server override boundary without flagging a coincident label price', () => {
    const grid = {
      tierPrices: { price: 1000, price2: 800, price3: 700 },
      catalogUnitPrice: 1000,
      isBaseUnit: true,
      priceEdited: true,
    };
    expect(isCartPriceOverride(makeItem({ ...grid, unitPrice: 1000 }), 2)).toBe(false);
    expect(isCartPriceOverride(makeItem({ ...grid, unitPrice: 800 }), 2)).toBe(false);
    expect(isCartPriceOverride(makeItem({ ...grid, unitPrice: 856 }), 2)).toBe(true);
    expect(isCartPriceOverride(makeItem({ unitPrice: 856, priceEdited: true }), 2)).toBe(true);
  });

  it('applyPriceTier anchors tier 1 on the assignment price, not products.price', () => {
    // unit_x_product.price (1100) drifted from products.price (1000):
    // the line entered at 1100 and tier 1 must keep it there.
    const drifted = makeItem({
      unitPrice: 1100,
      tierPrices: { price: 1000, price2: 800, price3: 700 },
      catalogUnitPrice: 1100,
      isBaseUnit: true,
    });
    expect(applyPriceTier([drifted], 1)[0]?.unitPrice).toBe(1100);
    // Tier 2 maps to price2, and back to tier 1 restores the assignment.
    const atTier2 = applyPriceTier([drifted], 2);
    expect(atTier2[0]?.unitPrice).toBe(800);
    expect(applyPriceTier(atTier2, 1)[0]?.unitPrice).toBe(1100);
  });

  it('applyPriceTier uses a non-base unit tier grid and falls back to its own retail price', () => {
    const box = makeItem({
      key: 'p1:box',
      unitPrice: 240,
      catalogUnitPrice: 240,
      catalogUnitPrice2: 220,
      catalogUnitPrice3: 0,
      tierPrices: { price: 10, price2: 8, price3: 7 },
      isBaseUnit: false,
    });

    expect(applyPriceTier([box], 2)[0]?.unitPrice).toBe(220);
    expect(applyPriceTier([box], 3)[0]?.unitPrice).toBe(240);
  });

  it('getCartSummary returns the zero summary for an empty cart', () => {
    expect(getCartSummary([], true)).toEqual({
      itemCount: 0,
      subtotal: 0,
      taxAmount: 0,
      consumptionTaxAmount: 0,
      total: 0,
    });
  });

  it('getCartSummary keeps impoconsumo apart from VAT inside the tax', () => {
    const summary = getCartSummary(
      [
        makeItem({ key: 'inc', unitPrice: 10800, quantity: 1, taxRate: 8, taxKind: 'inc' }),
        makeItem({ key: 'iva', unitPrice: 11900, quantity: 1, taxRate: 19, taxKind: 'iva' }),
        // Carts persisted before the field existed read as VAT.
        makeItem({ key: 'old', unitPrice: 1190, quantity: 1, taxRate: 19 }),
      ],
      true
    );
    expect(summary.consumptionTaxAmount).toBe(800);
    expect(summary.taxAmount).toBe(2890);
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

describe('saleCart units and list prices', () => {
  const box = {
    id: 'unit-assignment-2',
    productId: 'product-1',
    unitId: 'unit-box',
    unitName: 'Box',
    unitAbbreviation: 'BX',
    unitDimension: 'count' as const,
    equivalence: 100,
    price: 690,
    price2: 650,
    isBase: false,
  };
  const screws = (overrides?: Partial<ProductSearchSelection['product']>) => {
    const selection = createSelection(overrides);
    return {
      ...selection,
      product: {
        ...selection.product,
        unitAssignments: [...(selection.product.unitAssignments ?? []), box],
      },
    };
  };

  it('keeps the product units on the line only when there is more than one', () => {
    const item = buildCartItem(screws());
    expect(item.unitOptions?.map(option => option.unitId)).toEqual(['unit-1', 'unit-box']);
    expect(item.unitDimension).toBeNull();
    expect(buildCartItem(createSelection()).unitOptions).toBeUndefined();
  });

  it('switches unit at that unit price, keeping the base amount when it fits', () => {
    const line = updateCartItem(buildCartItem(screws()), { quantity: 300, discount: 5 });
    const boxed = changeCartItemUnit(line, 'unit-box');
    expect(boxed).toMatchObject({
      key: getCartItemKey('product-1', 'unit-box'),
      unitName: 'Box',
      unitEquivalence: 100,
      quantity: 3,
      unitPrice: 690,
      catalogUnitPrice: 690,
      catalogUnitPrice2: 650,
      isBaseUnit: false,
      priceEdited: false,
      discount: 5,
    });
    // 250 units is not a whole number of boxes, so the line starts at one box.
    expect(changeCartItemUnit({ ...line, quantity: 250 }, 'unit-box').quantity).toBe(1);
    // Back to units gives the same base amount.
    expect(changeCartItemUnit(boxed, 'unit-1').quantity).toBe(300);
  });

  it('keeps fractional amounts on the product step for products sold by fraction', () => {
    const line = updateCartItem(
      buildCartItem(screws({ sellByFraction: true, fractionStep: 0.1, fractionMinimum: 0.1 })),
      { quantity: 30 }
    );
    expect(changeCartItemUnit(line, 'unit-box').quantity).toBe(0.3);
    // 0.375 boxes is off the 0.1 step the server enforces, so the line starts at the minimum.
    expect(changeCartItemUnit({ ...line, quantity: 37.5 }, 'unit-box').quantity).toBe(0.1);
  });

  it('never switches quotation, price-label or unknown-unit lines', () => {
    const line = buildCartItem(screws());
    const quoted = { ...line, sourceQuotationItemId: 'q-1', unitOptions: undefined };
    const [labelled] = mergeBarcodeCartItem([], screws(), { quantity: null, price: 1250 });
    expect(canChangeCartItemUnit(quoted)).toBe(false);
    expect(canChangeCartItemUnit(labelled!)).toBe(false);
    expect(changeCartItemUnit(quoted, 'unit-box')).toBe(quoted);
    expect(changeCartItemUnit(labelled!, 'unit-box')).toBe(labelled);
    expect(changeCartItemUnit(line, 'missing')).toBe(line);
    const serialized = { ...line, tracksSerials: true };
    expect(canChangeCartItemUnit(serialized)).toBe(false);
    expect(changeCartItemUnit(serialized, 'unit-box')).toBe(serialized);
  });

  it('reports the list price only for a line priced lower by the ticket tier', () => {
    const selection = createSelection({ price: 33900, price2: 31500, price3: 35000 });
    const cement = buildCartItem({
      ...selection,
      unit: { ...selection.unit, price: 33900 },
      price: 33900,
    });
    const atTier2 = applyPriceTier([cement], 2)[0]!;
    expect(getCartItemListPrice(atTier2, 2)).toEqual({ listPrice: 33900, tier: 2 });
    expect(getCartItemListPrice(cement, 1)).toBeNull();
    // A dearer tier is not a discount off the list.
    expect(getCartItemListPrice(applyPriceTier([cement], 3)[0]!, 3)).toBeNull();
    // A hand-typed price is not the tier's.
    expect(getCartItemListPrice({ ...atTier2, priceEdited: true }, 2)).toBeNull();
  });
});
