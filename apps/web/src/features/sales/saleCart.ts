import { roundMoney } from '@/lib/money';
import { splitLineTax } from '@puntovivo/shared/tax-split';
import { getCheckoutApprovalDiscountAmount } from '@puntovivo/shared/checkout-approval';
import { normalizedQuantity, roundQuantity } from '@puntovivo/shared/unit-math';
import type { ProductSearchSelection } from '@/types';

// explicit `| undefined` on optional fields.
export interface SaleCartItem {
  key: string;
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
  };
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
