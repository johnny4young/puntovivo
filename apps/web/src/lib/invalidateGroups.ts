/**
 * Helper for the recurring tRPC react-query invalidation pattern in mutation
 * `onSuccess` handlers. It collapses the
 *
 * await Promise.all([
 * utils.foo.list.invalidate(),
 * utils.bar.summary.invalidate(),
 * ...
 * ]);
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
 * u => u.sales.list,
 * u => u.cashSessions.getActive,
 * u => u.products.list,
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
 * Refresh read projections after an irreversible server command has already
 * committed. Unlike {@link invalidateGroups}, this helper never rejects: a
 * cache-refresh failure must not turn a successful sale, table move or draft
 * transition into a false mutation error that invites the operator to retry.
 * The boolean lets the caller render an honest reload warning instead.
 */
export async function invalidateCommittedGroups(
  utils: TrpcUtils,
  pickers: ReadonlyArray<InvalidationPicker>
): Promise<boolean> {
  try {
    await invalidateGroups(utils, pickers);
    return true;
  } catch {
    return false;
  }
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
 * Read projections changed whenever a sale draft reserves or releases stock.
 * Keep this group shared by restaurant ordering, classic parking and discard
 * so a successful command cannot leave catalog availability, movement history
 * or serial lookup caches on different versions of the inventory ledger.
 */
export const INVENTORY_RESERVATION_INVALIDATIONS: ReadonlyArray<InvalidationPicker> = [
  u => u.inventory.listMovements,
  u => u.inventory.listStock,
  u => u.products.list,
  u => u.products.search,
  ...SERIAL_INVENTORY_INVALIDATIONS,
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
  // the shell celebrates only after the server confirms the
  // tenant's first completed sale.
  u => u.setupReadiness.firstSale,
  u => u.cashSessions.getActive,
  u => u.cashSessions.myPace,
  u => u.cashSessions.movements,
  // the pace HUD should jump the moment a sale lands, not on
  // its 60 s poll; no-op while the HUD is opted out (query disabled).
  u => u.cashSessions.pace,
  u => u.cashSessions.report,
  u => u.cashSessions.registerAssignments,
  u => u.sales.list,
  u => u.sales.listDrafts,
  u => u.sales.summary,
  // Completing a normalized restaurant draft settles its check and may close
  // the table service in the same transaction.
  u => u.restaurantTables.listWithDraftStatus,
  u => u.restaurantServices.getTableState,
  ...INVENTORY_RESERVATION_INVALIDATIONS,
  // credit sales mutate the ledger, so the cupo card
  // inside SalePaymentModal must refetch on the next open.
  u => u.customerLedger.getBalance,
  u => u.customerLedger.list,
  // the sale may have accrued points; refresh the balance chip
  // so the next checkout shows the customer's real total.
  u => u.loyalty.forCustomer,
  // An accepted quotation may have transitioned to converted in the same
  // sale transaction. Refresh both its history row and any open detail view.
  u => u.quotations.list,
  u => u.quotations.getById,
];

/** Queries affected when the current operator opens a cash session. */
export const CASH_SESSION_OPEN_INVALIDATIONS: ReadonlyArray<InvalidationPicker> = [
  u => u.setupReadiness.firstSale,
  u => u.cashSessions.getActive,
  u => u.cashSessions.myPace,
  u => u.cashSessions.report,
  u => u.cashSessions.registerAssignments,
  // opening a drawer can atomically clock the cashier in.
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
