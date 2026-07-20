/**
 * hover/focus prefetch for the sidebar `/sales` entry.
 *
 * Warms the four heaviest SalesPage entry queries into the React Query
 * cache the moment the operator hovers (or keyboard-focuses) the Sales
 * nav link, so opening `/sales` paints from cache instead of showing a
 * blank shell while 11 cold queries resolve. The returned handler is
 * stable and idempotent — `prefetch` is a no-op when the data is already
 * fresh, so repeated hovers cost nothing.
 *
 * @module features/sales/usePrefetchSales
 */

import { useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useTenant } from '@/features/tenant/TenantProvider';

/**
 * Returns a stable `onMouseEnter`/`onFocus` handler that prefetches the
 * SalesPage entry queries (`sales.list`, `sales.summary`, `customers.list`,
 * and — when a site is active — `cashSessions.getActive`). The input
 * arguments mirror the `useQuery` calls in `SalesPage` exactly so the
 * prefetched cache entries match the keys the page subscribes to.
 */
export function usePrefetchSales(): () => void {
  const utils = trpc.useUtils();
  const { currentSite } = useTenant();
  const siteId = currentSite?.id ?? null;

  return useCallback(() => {
    void utils.sales.list.prefetch({ page: 1, perPage: 50 });
    void utils.sales.summary.prefetch();
    void utils.customers.list.prefetch({ page: 1, perPage: 100, isActive: true });
    if (siteId) {
      void utils.cashSessions.getActive.prefetch({ siteId });
    }
  }, [utils, siteId]);
}
