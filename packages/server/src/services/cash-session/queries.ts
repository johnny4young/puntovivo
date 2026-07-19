/**
 * Open-cash-session lookups + the sale precondition guard.
 *
 * The active-session reads keyed by (tenant, site, cashier) and by
 * (tenant, site, register), plus `requireActiveCashSession` — the
 * canonical fast-fail precondition every sale-completion path calls
 * before writing.
 *
 * @module services/cash-session/queries
 */

import { and, desc, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

export function getActiveCashSessionForCashier(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  cashierId: string
) {
  return db
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.siteId, siteId),
        eq(cashSessions.cashierId, cashierId),
        eq(cashSessions.status, 'open')
      )
    )
    .orderBy(desc(cashSessions.openedAt))
    .get();
}

export async function getOpenCashSessionForRegister(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  registerName: string
) {
  return db
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.siteId, siteId),
        eq(cashSessions.registerName, registerName),
        eq(cashSessions.status, 'open')
      )
    )
    .orderBy(desc(cashSessions.openedAt))
    .get();
}

/**
 * Fast-fail precondition guard: the (tenant, site, cashier) triple must have
 * an open cash session before a sale can complete.
 *
 * Invariants:
 * - At most one open session per `(tenantId, siteId, cashierId)` is assumed;
 *   if more than one exists the most recently opened (`openedAt DESC`) wins.
 *   This is the canonical building block for the active-session lookup — never
 *   re-implement it inline.
 * - Runs OUTSIDE any transaction as a UX fast-fail so the common no-session
 *   case never opens a BEGIN. It is NOT a TOCTOU guard — the in-transaction
 *   re-check is `assertCashSessionStillOpen`, which must still run before the
 *   dependent write.
 *
 * Preconditions: `siteId` must be non-null (an active site is required);
 * otherwise throws `CASH_SESSION_SITE_REQUIRED`.
 *
 * Postconditions: returns the open `cash_sessions` row, or throws
 * `CASH_SESSION_REQUIRED` when none is open.
 */
export async function requireActiveCashSession(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string | null,
  cashierId: string
) {
  if (!siteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'An active site is required to use cash sessions',
    });
  }

  const activeSession = await getActiveCashSessionForCashier(db, tenantId, siteId, cashierId);

  if (!activeSession) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_REQUIRED',
      message: 'An open cash session is required before completing sales',
    });
  }

  return activeSession;
}
