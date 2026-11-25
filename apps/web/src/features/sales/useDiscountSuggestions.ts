import { useMemo } from 'react';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import { trpc } from '@/lib/trpc';

/**
 * the POS-side read of the expiry-radar suggestions. Returns a
 * Map of productId → highest active suggested discount percent, so any POS
 * surface (product search dialog, cart lines) can badge a product with
 * "sugerido -N%" from one shared 60-second-fresh query. The payload is
 * cost-free by design (cashiers consume it); a product with several
 * suggested lots badges with the MAX percent — the cashier operates per
 * product, not per lot. The badges belong to the register's lot and expiry zone.
 */
export function useDiscountSuggestions(
  enabled: boolean,
  siteId: string | null | undefined = null
): Map<string, number> {
  const active = useRegisterZone('pharmacy-lot') && enabled;
  const query = trpc.inventoryLots.activeSuggestions.useQuery(siteId ? { siteId } : undefined, {
    enabled: active && Boolean(siteId),
    staleTime: 60_000,
  });
  return useMemo(() => {
    const byProduct = new Map<string, number>();
    // `enabled: false` still surfaces CACHED data from other consumers
    // (e.g. the cart populating the query while a non-POS dialog is open),
    // so the opt-in must also gate the derived Map — not just the fetch.
    if (!active || !siteId) return byProduct;
    for (const item of query.data?.items ?? []) {
      const current = byProduct.get(item.productId) ?? 0;
      if (item.discountPct > current) {
        byProduct.set(item.productId, item.discountPct);
      }
    }
    return byProduct;
  }, [query.data, active, siteId]);
}
