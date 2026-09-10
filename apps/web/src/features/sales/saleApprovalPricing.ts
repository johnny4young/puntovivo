import { getCheckoutApprovalDiscountAmount } from '@puntovivo/shared/checkout-approval';
import {
  isUnitPriceOverride,
  resolveTierUnitPrice,
  type PriceTier,
} from '@puntovivo/shared/price-tier';

import type { SaleCartItem } from './saleCart';

/**
 * Renderer guidance for the same off-grid price policy enforced at commit.
 * Missing metadata is only treated as an override when the line is explicitly
 * marked edited (resumed legacy drafts receive that fail-closed hint server-side).
 *
 * This lives outside saleCart because the global command palette imports the
 * cart construction path while approval pricing is needed only on the lazy
 * sales checkout route.
 */
export function isCartPriceOverride(
  item: Pick<
    SaleCartItem,
    | 'unitPrice'
    | 'priceEdited'
    | 'tierPrices'
    | 'catalogUnitPrice'
    | 'catalogUnitPrice2'
    | 'catalogUnitPrice3'
    | 'isBaseUnit'
  >,
  tier: PriceTier
): boolean {
  if (!item.tierPrices || item.catalogUnitPrice === undefined) {
    return item.priceEdited === true;
  }
  const referenceUnitPrice = resolveTierUnitPrice({
    tier,
    assignmentPrice: item.catalogUnitPrice,
    assignmentPrice2: item.catalogUnitPrice2,
    assignmentPrice3: item.catalogUnitPrice3,
    isBaseUnit: item.isBaseUnit === true,
    productPrices: item.tierPrices,
  });
  return isUnitPriceOverride({
    unitPrice: item.unitPrice,
    referenceUnitPrice,
    retailUnitPrice: item.catalogUnitPrice,
  });
}

export function getCartDiscountAmount(items: SaleCartItem[]): number {
  return getCheckoutApprovalDiscountAmount(items);
}
