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

export type TrpcUtils = ReturnType<typeof trpc.useUtils>;

interface Invalidatable {
  invalidate: () => Promise<void>;
}

/** A single typed invalidation target, e.g. `u => u.sales.list`. */
export type InvalidationPicker = (u: TrpcUtils) => Invalidatable;

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
  pickers: ReadonlyArray<InvalidationPicker>
): Promise<void> {
  if (pickers.length === 0) {
    return;
  }
  await Promise.all(pickers.map(pick => pick(utils).invalidate()));
}

/**
 * Every mutation that changes a serialized unit's availability or warranty
 * provenance must invalidate both read surfaces. Queries are input-scoped
 * (site/product for list, serial number for lookup), so invalidating the leaf
 * refreshes every active variant without callers having to reconstruct keys.
 */
export const SERIAL_INVENTORY_INVALIDATIONS: ReadonlyArray<InvalidationPicker> = [
  u => u.productSerials.list,
  u => u.productSerials.lookup,
];

/**
 * The canonical "a sale was completed" invalidation set, shared by every
 * surface that finishes a sale (desktop SalesPage epilogue and the touch
 * POS). Completing a sale touches cash sessions, sales lists/summary,
 * inventory stock + movements, product availability, and — for credit
 * sales — the customer ledger; missing any of these leaves another page
 * showing pre-sale data for the whole staleTime window.
 */
export const SALE_COMPLETION_INVALIDATIONS: ReadonlyArray<InvalidationPicker> = [
  // ENG-202 — the shell celebrates only after the server confirms the
  // tenant's first completed sale.
  u => u.setupReadiness.firstSale,
  u => u.cashSessions.getActive,
  u => u.cashSessions.myPace,
  u => u.cashSessions.movements,
  u => u.cashSessions.report,
  u => u.cashSessions.registerAssignments,
  u => u.sales.list,
  u => u.sales.listDrafts,
  u => u.sales.summary,
  u => u.inventory.listMovements,
  u => u.inventory.listStock,
  u => u.products.list,
  u => u.products.search,
  ...SERIAL_INVENTORY_INVALIDATIONS,
  // ENG-090 — credit sales mutate the ledger, so the cupo card
  // inside SalePaymentModal must refetch on the next open.
  u => u.customerLedger.getBalance,
  u => u.customerLedger.list,
];

/** Queries affected when the current operator opens a cash session. */
export const CASH_SESSION_OPEN_INVALIDATIONS: ReadonlyArray<InvalidationPicker> = [
  u => u.setupReadiness.firstSale,
  u => u.cashSessions.getActive,
  u => u.cashSessions.myPace,
  u => u.cashSessions.report,
  u => u.cashSessions.registerAssignments,
  // ENG-140d — opening a drawer can atomically clock the cashier in.
  u => u.employeeShifts.current,
  u => u.employeeShifts.attendance.list,
];

/** Queries affected when the current operator closes a cash session. */
export const CASH_SESSION_CLOSE_INVALIDATIONS: ReadonlyArray<InvalidationPicker> = [
  u => u.cashSessions.getActive,
  u => u.cashSessions.myPace,
  u => u.cashSessions.report,
  u => u.cashSessions.registerAssignments,
  // Closing removes the clock-out guard but deliberately leaves attendance open.
  u => u.employeeShifts.current,
  u => u.employeeShifts.attendance.list,
];
