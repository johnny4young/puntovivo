import { roundMoney } from '@/lib/money';
import { resolveTierUnitPrice, type PriceTier } from '@puntovivo/shared/price-tier';
import { MIN_OPERATIONAL_QUANTITY, roundQuantity } from '@puntovivo/shared/unit-math';
import type { ProductSearchSelection } from '@/types';

// explicit `| undefined` on optional fields.
export interface SaleCartItem {
  key: string;
  /** Immutable quotation line identity used by atomic conversion. */
  sourceQuotationItemId?: string | undefined;
  productId: string;
  productName: string;
  productSku: string;
  unitId: string;
  unitName: string;
  unitEquivalence: number;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  /** Frozen tax-rate identities from an accepted quotation. */
  taxComponents?: Array<{ vatRateId: string }> | undefined;
  availableStock: number;
  /** false = service line: no stock semantics anywhere in the cart. */
  tracksStock?: boolean | undefined;
  sellByFraction: boolean;
  fractionStep?: number | null | undefined;
  fractionMinimum?: number | null | undefined;
  tracksSerials?: boolean | undefined;
  serialIds?: string[] | undefined;
  /** Site whose sellable registry produced serialIds. */
  serialSiteId?: string | null | undefined;
  // customer price-tier support. The three catalog prices
  // (base-unit denominated) plus whether THIS line sells the base unit,
  // so applyPriceTier can reprice through the shared resolver. Optional:
  // persisted carts from before the columns shipped lack them and are
  // simply left untouched by a tier switch.
  tierPrices?: { price: number; price2: number; price3: number } | undefined;
  /**
   * The unit assignment's own catalog price at build time - the line's
   * tier-1 reference. Kept SEPARATE from tierPrices.price because
   * unit_x_product.price and products.price are edited on different
   * tabs and nothing forces them equal; the server judges overrides
   * against the assignment price, so the cart must anchor on it too.
   */
  catalogUnitPrice?: number | undefined;
  /** Tier 2/3 prices owned by this concrete unit assignment. */
  catalogUnitPrice2?: number | undefined;
  catalogUnitPrice3?: number | undefined;
  isBaseUnit?: boolean | undefined;
  /** True once the operator hand-edited the unit price; tier switches never clobber it. */
  priceEdited?: boolean | undefined;
}

export interface SaleCartSummary {
  itemCount: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export function getSaleQuantityStep(item: Pick<SaleCartItem, 'sellByFraction' | 'fractionStep'>) {
  return item.sellByFraction
    ? Math.max(item.fractionStep ?? MIN_OPERATIONAL_QUANTITY, MIN_OPERATIONAL_QUANTITY)
    : 1;
}

export function getSaleMinimumQuantity(
  item: Pick<SaleCartItem, 'sellByFraction' | 'fractionStep' | 'fractionMinimum'>
) {
  if (!item.sellByFraction) {
    return 1;
  }

  const step = getSaleQuantityStep(item);
  return Math.max(item.fractionMinimum ?? step, step);
}

export function getCartItemKey(productId: string, unitId: string) {
  return `${productId}:${unitId}`;
}

export function buildCartItem(selection: ProductSearchSelection): SaleCartItem {
  const unitName =
    selection.unit.unitName ??
    selection.unit.unitAbbreviation ??
    selection.product.baseUnitAbbreviation ??
    selection.unit.unitId;

  return {
    key: getCartItemKey(selection.product.id, selection.unit.unitId),
    productId: selection.product.id,
    productName: selection.product.name,
    productSku: selection.product.sku,
    unitId: selection.unit.unitId,
    unitName,
    unitEquivalence: selection.unit.equivalence,
    quantity: getSaleMinimumQuantity(selection.product),
    unitPrice: selection.price,
    discount: 0,
    taxRate: selection.product.taxRate ?? 0,
    availableStock: selection.product.stock,
    tracksStock: selection.product.tracksStock !== false,
    sellByFraction: selection.product.sellByFraction,
    fractionStep: selection.product.fractionStep,
    fractionMinimum: selection.product.fractionMinimum,
    tracksSerials: selection.product.tracksSerials === true,
    serialIds: [],
    serialSiteId: null,
    // Tier metadata only when the selection actually carries the three
    // catalog prices - quick-create merges a partial product cast whose
    // price2/price3 are undefined, and a tierPrices of undefineds would
    // let applyPriceTier write unitPrice: undefined into the line.
    tierPrices:
      Number.isFinite(selection.product.price) &&
      Number.isFinite(selection.product.price2) &&
      Number.isFinite(selection.product.price3)
        ? {
            price: selection.product.price,
            price2: selection.product.price2,
            price3: selection.product.price3,
          }
        : undefined,
    catalogUnitPrice: Number.isFinite(selection.unit.price ?? selection.product.price)
      ? (selection.unit.price ?? selection.product.price)
      : undefined,
    catalogUnitPrice2: Number.isFinite(selection.unit.price2) ? selection.unit.price2 : undefined,
    catalogUnitPrice3: Number.isFinite(selection.unit.price3) ? selection.unit.price3 : undefined,
    isBaseUnit: selection.unit.isBase === true,
    priceEdited: false,
  };
}

export function updateCartItem(
  item: SaleCartItem,
  updates: Partial<
    Pick<SaleCartItem, 'quantity' | 'discount' | 'unitPrice' | 'serialIds' | 'serialSiteId'>
  >
): SaleCartItem {
  return {
    ...item,
    ...updates,
    // A hand-edited price is sticky: tier switches must never clobber
    // what the operator typed.
    ...(updates.unitPrice !== undefined && updates.unitPrice !== item.unitPrice
      ? { priceEdited: true }
      : {}),
  };
}

/**
 * Reprice every eligible line to the given customer price tier through
 * the SAME shared resolver the server uses as its override reference, so
 * a tier-priced line is never flagged as a manual override. Lines the
 * operator hand-edited, lines without tier metadata (persisted carts
 * from before the fields shipped), and locked/resumed carts (callers
 * gate those) keep their price.
 */
export function applyPriceTier(items: SaleCartItem[], tier: PriceTier): SaleCartItem[] {
  return items.map(item => {
    if (item.priceEdited === true || !item.tierPrices || item.catalogUnitPrice === undefined) {
      return item;
    }
    const tierPrices = item.tierPrices;
    const catalogUnitPrice = item.catalogUnitPrice;
    const priceAtTier = (candidate: PriceTier) =>
      resolveTierUnitPrice({
        tier: candidate,
        // Anchor on the ASSIGNMENT price captured at build time, exactly
        // like the server's override reference - products.price and the
        // base assignment price are edited independently and can drift.
        assignmentPrice: catalogUnitPrice,
        assignmentPrice2: item.catalogUnitPrice2,
        assignmentPrice3: item.catalogUnitPrice3,
        isBaseUnit: item.isBaseUnit === true,
        productPrices: tierPrices,
      });
    // Only lines sitting ON the tier grid are repriced. A price that
    // matches none of the three catalog tiers came from somewhere else -
    // a GS1 price-embedded label, a promo, an external suggestion - and
    // a tier switch (or the idempotent re-apply on every cart update)
    // must never silently reset it to catalog.
    const sitsOnTierGrid = ([1, 2, 3] as const).some(
      candidate => priceAtTier(candidate) === item.unitPrice
    );
    if (!sitsOnTierGrid) {
      return item;
    }
    const nextPrice = priceAtTier(tier);
    return nextPrice === item.unitPrice ? item : { ...item, unitPrice: nextPrice };
  });
}

export function mergeCartItem(items: SaleCartItem[], selection: ProductSearchSelection) {
  const nextItem = buildCartItem(selection);
  const existingIndex = items.findIndex(item => item.key === nextItem.key);

  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  return items.map((item, index) =>
    index === existingIndex
      ? updateCartItem(item, {
          quantity: roundQuantity(item.quantity + getSaleQuantityStep(item), 6),
        })
      : item
  );
}

/** Keep price-encoded packages distinct from both catalog and other prices. */
export function getBarcodeCartItemKey(
  selection: ProductSearchSelection,
  priceOverride: number | null
): string {
  const baseKey = getCartItemKey(selection.product.id, selection.unit.unitId);
  return priceOverride === null
    ? baseKey
    : `${baseKey}:gs1-price:${Math.round(roundMoney(priceOverride) * 100)}`;
}

/**
 * Merge one scanner-resolved package without losing its measured quantity or
 * encoded package price.
 *
 * Weight labels add their quantity to the existing base-unit line. Price
 * labels describe one whole package, so equal encoded prices may increment a
 * dedicated line while different prices remain separate legal sale lines.
 */
export function mergeBarcodeCartItem(
  items: SaleCartItem[],
  selection: ProductSearchSelection,
  overrides: { quantity: number | null; price: number | null }
): SaleCartItem[] {
  if (overrides.quantity === null && overrides.price === null) {
    return mergeCartItem(items, selection);
  }

  const itemKey = getBarcodeCartItemKey(selection, overrides.price);
  const built = buildCartItem(selection);
  const nextItem: SaleCartItem = {
    ...built,
    key: itemKey,
    ...(overrides.price === null
      ? {}
      : {
          unitPrice: overrides.price,
          // A scale-encoded package price is not a catalog tier suggestion,
          // even if it happens to equal one of the configured tier prices.
          priceEdited: true,
        }),
  };
  const existingIndex = items.findIndex(item => item.key === nextItem.key);
  if (existingIndex === -1) {
    return [
      ...items,
      overrides.quantity === null
        ? nextItem
        : updateCartItem(nextItem, { quantity: overrides.quantity }),
    ];
  }

  const increment = overrides.quantity ?? getSaleQuantityStep(nextItem);
  return items.map((item, index) =>
    index === existingIndex
      ? updateCartItem(item, {
          quantity: roundQuantity(item.quantity + increment, 12),
        })
      : item
  );
}
