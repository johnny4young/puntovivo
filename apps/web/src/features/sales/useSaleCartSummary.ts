import { useMemo } from 'react';
import type { SaleCartItem } from './saleCart';
import { getCartSummary } from './saleCartTotals';

/** Cart state is immutable; unrelated query renders must not republish display totals. */
export function useSaleCartSummary(items: SaleCartItem[], priceIncludesTax: boolean) {
  return useMemo(() => getCartSummary(items, priceIncludesTax), [items, priceIncludesTax]);
}
