import { roundMoney } from '@/lib/money';
import { splitLineTax } from '@puntovivo/shared/tax-split';
import { resolveTierUnitPrice, type PriceTier } from '@puntovivo/shared/price-tier';
import { getCheckoutApprovalDiscountAmount } from '@puntovivo/shared/checkout-approval';
import { normalizedQuantity, roundQuantity } from '@puntovivo/shared/unit-math';
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
  return item.sellByFraction ? Math.max(item.fractionStep ?? 0.01, 0.01) : 1;
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

// The pricing mode is deliberately REQUIRED (no default): a call site
// that forgets it must fail to compile rather than silently preview
// inclusive totals for an exclusive-mode tenant.
export function getLineTotals(item: SaleCartItem, priceIncludesTax: boolean) {
  // The split itself is the SAME shared helper the server engine uses
  // (@puntovivo/shared/tax-split), so the preview can never show a total
  // completeSale would not charge, in either pricing mode.
  const split = splitLineTax({
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    discountPercent: item.discount,
    taxRate: item.taxRate,
    priceIncludesTax,
  });
  const normalizedStockQuantity = normalizedQuantity(item.quantity, item.unitEquivalence);

  return {
    subtotal: split.lineBase,
    taxAmount: split.lineTax,
    total: split.lineTotal,
    normalizedQuantity: normalizedStockQuantity,
  };
}

/**
 * Serialized checkout is valid only when every physical identity came from
 * the active site's registry and no identity is reused across cart lines.
 * Older persisted carts have no serialSiteId and intentionally fail closed
 * until the cashier reselects the units for the current site.
 */
export function areSerialSelectionsComplete(items: SaleCartItem[], siteId: string | null): boolean {
  const selectedIds: string[] = [];

  for (const item of items) {
    if (!item.tracksSerials) continue;
    const itemIds = item.serialIds ?? [];
    if (
      !siteId ||
      item.serialSiteId !== siteId ||
      itemIds.length !== normalizedQuantity(item.quantity, item.unitEquivalence)
    ) {
      return false;
    }
    selectedIds.push(...itemIds);
  }

  return new Set(selectedIds).size === selectedIds.length;
}

export function getCartSummary(items: SaleCartItem[], priceIncludesTax: boolean): SaleCartSummary {
  return items.reduce<SaleCartSummary>(
    (summary, item) => {
      const lineTotals = getLineTotals(item, priceIncludesTax);

      return {
        itemCount: summary.itemCount + item.quantity,
        subtotal: roundMoney(summary.subtotal + lineTotals.subtotal),
        taxAmount: roundMoney(summary.taxAmount + lineTotals.taxAmount),
        total: roundMoney(summary.total + lineTotals.total),
      };
    },
    {
      itemCount: 0,
      subtotal: 0,
      taxAmount: 0,
      total: 0,
    }
  );
}

export function getCartDiscountAmount(items: SaleCartItem[]): number {
  return getCheckoutApprovalDiscountAmount(items);
}
