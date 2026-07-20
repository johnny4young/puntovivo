/**
 * Cash-movement math + the in-transaction drawer mutations.
 *
 * The invariant core ( / 055 / 056): the sign-convention SSOT
 * (`getCashMovementSignedAmount`), the TOCTOU re-check that the bound
 * session is still open (`assertCashSessionStillOpen`), the lockstep
 * movement-insert + expected-balance advance (`insertCashMovement`),
 * and the persisted-sale cash read.
 *
 * @module services/cash-session/movements
 */

import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { cashMovements, cashSessions } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import {
  CASH_MOVEMENT_NEGATIVE_TYPES,
  CASH_MOVEMENT_POSITIVE_TYPES,
  type CashMovementType,
} from './constants.js';

/**
 * Map an always-positive cash-movement `amount` to its signed drawer delta.
 *
 * Invariants:
 * - `amount` is ALWAYS supplied positive-and-finite; the sign lives entirely
 * in the movement `type`, never in the magnitude. A non-finite or
 * non-positive `amount` is rejected with `CASH_MOVEMENT_INVALID_AMOUNT`.
 * - Sign convention (the single source of truth for drawer math): inflows
 * `sale` / `paid_in` / `replenishment` return `+amount`; outflows
 * `refund` / `paid_out` / `skim` return `-amount`. Any type outside both
 * sets throws `CASH_MOVEMENT_UNSUPPORTED_TYPE` — there is no silent
 * zero-fallback, so a new enum member must be classified explicitly.
 *
 * Preconditions: callers pass a finite, positive cents-level amount and a
 * movement type from `cashMovementTypeEnum`.
 *
 * Postconditions: the returned value is what `insertCashMovement` adds to
 * `expected_balance`; callers must not re-sign it.
 */
export function getCashMovementSignedAmount(type: CashMovementType, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_MOVEMENT_INVALID_AMOUNT',
      message: 'Cash movement amount must be greater than zero',
      details: { amount },
    });
  }

  if (CASH_MOVEMENT_POSITIVE_TYPES.has(type)) {
    return amount;
  }

  if (CASH_MOVEMENT_NEGATIVE_TYPES.has(type)) {
    return -amount;
  }

  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'CASH_MOVEMENT_UNSUPPORTED_TYPE',
    message: `Unsupported cash movement type: ${type}`,
    details: { type },
  });
}

/**
 * /  — in-transaction TOCTOU re-check that the cash session
 * bound to a sale write is STILL open.
 *
 * Invariants:
 * - `requireActiveCashSession(...)` runs OUTSIDE the transaction as a
 * fast-fail UX guard (so the common no-session case never opens a BEGIN).
 * This helper re-validates `status='open'` against the in-transaction
 * snapshot immediately before any sale write touches `cashSessionId`.
 * Without it, a concurrent `cashSessions.close` landing between the outer
 * check and the transaction body would silently bind the new sale /
 * refund / completion to a now-closed shift. better-sqlite3 single-process
 * serialization keeps the window small but non-zero, and the libSQL/Turso
 * replication planned in  widens it.
 * - Read-only: takes a `Pick<DatabaseInstance, 'select'>` and mutates
 * nothing. The caller owns the surrounding transaction.
 *
 * Preconditions: called inside the same transaction as the dependent write,
 * scoped to `(tenantId, cashSessionId)`.
 *
 * Postconditions: returns silently when the session is open; throws
 * `CASH_SESSION_REQUIRED` (wired in en + es locales) otherwise, rolling back
 * the caller's transaction.
 */
export function assertCashSessionStillOpen(
  tx: Pick<DatabaseInstance, 'select'>,
  tenantId: string,
  cashSessionId: string
): void {
  const stillOpen = tx
    .select({ id: cashSessions.id })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.id, cashSessionId),
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.status, 'open')
      )
    )
    .get();

  if (!stillOpen) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_REQUIRED',
      message: 'Cash session was closed between the precondition check and the transaction body',
      details: { cashSessionId },
    });
  }
}

/**
 * /  — Insert a `cash_movements` row + advance the session's
 * `expected_balance` in lockstep, scoped to the caller's transaction.
 *
 * Invariants:
 * - The movement insert and the `expected_balance` advance happen in the
 * SAME transaction (the caller's `args.tx`); the drawer total never drifts
 * from the sum of its movements. The advance is `+getCashMovementSignedAmount(type, amount)`
 * so the sign convention lives in exactly one place.
 * - Two-decimal money invariant: the input is `roundMoney`-ed BEFORE the
 * positivity guard so a sub-cent positive (e.g. 0.001) collapses to 0 and
 * skips rather than tripping the `chk_cash_movements_amount_2dec` CHECK;
 * the balance update is wrapped in SQLite `round(..., 2)` to absorb
 * IEEE-754 addition drift before the `chk_cash_sessions_expected_2dec`
 * CHECK sees it.
 * - `referenceId` is `string | null`: a sale/refund movement points at the
 * sale id; a manual shift movement (`paid_in` / `paid_out` / `skim` /
 * `replenishment`, routed via `application/cash-sessions/recordCashMovement`)
 * has no source reference and passes `null`.
 *
 * Preconditions: called inside the same transaction that owns the parent
 * sale/session mutation; the target cash session already belongs to
 * `(tenantId, sessionId)`.
 *
 * Postconditions: returns the inserted row id on a real persistence, or
 * `null` when the call was a no-op because the rounded `amount <= 0` (a
 * credit-tender sale, or a refund whose persisted cash contribution was
 * zero — both legitimate, frequent sale-lifecycle cases). Use the return to
 * decide whether to emit a `cash_movement` journal effect (and as the
 * effect's `resourceId`).
 */
export function insertCashMovement(args: {
  tx: DatabaseInstance;
  tenantId: string;
  sessionId: string;
  type: CashMovementType;
  amount: number;
  referenceId: string | null;
  note: string;
  createdBy: string;
  createdAt: string;
}): string | null {
  // round BEFORE the positivity guard so the
  // `<= 0` test runs against the cents-precision value that will be
  // persisted, not the raw float. Pre-Step-b the guard ran on the
  // raw input, which let sub-cent positives (e.g. 0.001) pass — they
  // were inserted as-is and later crashed the new
  // `chk_cash_movements_amount_2dec` CHECK. With the rounding here
  // those sub-cent positives collapse to 0 and silently skip, which
  // is the right contract: a cash movement smaller than one cent is
  // not a legal monetary event under the audit's "money columns are
  // two decimals" invariant. If a caller ever needs sub-cent
  // granularity it must use a different column type, not a real
  // column under the precision CHECK.
  const amount = roundMoney(args.amount);
  if (amount <= 0) {
    return null;
  }

  const id = nanoid();
  args.tx
    .insert(cashMovements)
    .values({
      id,
      tenantId: args.tenantId,
      sessionId: args.sessionId,
      type: args.type,
      amount,
      referenceId: args.referenceId,
      note: args.note,
      createdBy: args.createdBy,
      createdAt: args.createdAt,
    })
    .run();

  // `expected_balance + signedAmount` runs at the
  // SQLite layer, where IEEE-754 addition can produce sub-cent drift
  // that the precision CHECK (`chk_cash_sessions_expected_2dec`) would
  // reject on the next update. Wrap in `round(..., 2)` so the stored
  // value always lands on a clean cent boundary.
  args.tx
    .update(cashSessions)
    .set({
      expectedBalance: sql`round(${cashSessions.expectedBalance} + ${getCashMovementSignedAmount(args.type, amount)}, 2)`,
      updatedAt: args.createdAt,
    })
    .where(and(eq(cashSessions.id, args.sessionId), eq(cashSessions.tenantId, args.tenantId)))
    .run();

  return id;
}

export async function getPersistedSaleCashContribution(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    saleId: string;
    fallbackAmount: number;
  }
): Promise<number> {
  const rows = await db
    .select({ amount: cashMovements.amount })
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.tenantId, args.tenantId),
        eq(cashMovements.referenceId, args.saleId),
        eq(cashMovements.type, 'sale')
      )
    )
    .all();

  if (rows.length === 0) {
    return args.fallbackAmount;
  }

  return rows.reduce((total, row) => roundMoney(total + row.amount), 0);
}
