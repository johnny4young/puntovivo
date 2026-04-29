/**
 * Helper for the recurring tRPC react-query invalidation pattern in mutation
 * `onSuccess` handlers. Introduced by ENG-028 to collapse the
 *
 *   await Promise.all([
 *     utils.foo.list.invalidate(),
 *     utils.bar.summary.invalidate(),
 *     ...
 *   ]);
 *
 * boilerplate that recurs across SalesPage, SaleDetailsModal,
 * SuspendedSalesPanel, PurchasesPage, and PurchaseDetailsModal.
 *
 * The picker-array shape preserves the typed tRPC proxy (autocomplete +
 * structural type checking) — there are no string keys, no loss of
 * inference. Each picker selects a leaf with an `.invalidate()` method.
 */

import type { trpc } from '@/lib/trpc';

type TrpcUtils = ReturnType<typeof trpc.useUtils>;

interface Invalidatable {
  invalidate: () => Promise<void>;
}

/**
 * Invalidate every picked tRPC query in parallel and resolve once all
 * invalidations have completed. Promise.all semantics: any single picker
 * rejection rejects the outer promise.
 *
 * @example
 * await invalidateGroups(utils, [
 *   u => u.sales.list,
 *   u => u.cashSessions.getActive,
 *   u => u.products.list,
 * ]);
 */
export async function invalidateGroups(
  utils: TrpcUtils,
  pickers: ReadonlyArray<(u: TrpcUtils) => Invalidatable>
): Promise<void> {
  if (pickers.length === 0) {
    return;
  }
  await Promise.all(pickers.map(pick => pick(utils).invalidate()));
}
