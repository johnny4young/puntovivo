import { roundMoney } from '@/lib/money';
import { splitLineTax } from '@puntovivo/shared/tax-split';
import { normalizedQuantity } from '@puntovivo/shared/unit-math';

import type { SaleCartItem, SaleCartSummary } from './saleCart';

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
