import { and, asc, desc, eq, max, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import {
  cashMovementTypeEnum,
  cashMovements,
  cashSessions,
  denominationTemplates,
  type CashSessionDenomination,
} from '../db/schema.js';
import { roundMoney } from '../lib/money.js';
import { throwServerError } from '../lib/errorCodes.js';

const CASH_SESSION_EPSILON = 1e-6;
const DEFAULT_REGISTER_NAME = 'Main register';
const REGISTER_ASSIGNMENT_BACKFILL_LIMIT = 100;
const DEFAULT_CASH_SESSION_DENOMINATION_VALUES = [
  100000,
  50000,
  20000,
  10000,
  5000,
  2000,
  1000,
  500,
  200,
  100,
  50,
] as const;
const CASH_MOVEMENT_POSITIVE_TYPES = new Set<
  (typeof cashMovementTypeEnum)[number]
>(['sale', 'paid_in', 'replenishment']);
const CASH_MOVEMENT_NEGATIVE_TYPES = new Set<
  (typeof cashMovementTypeEnum)[number]
>(['refund', 'paid_out', 'skim']);

export type CashMovementType = (typeof cashMovementTypeEnum)[number];

export function normalizeRegisterName(registerName: string): string {
  const normalized = registerName.trim();
  return normalized.length > 0 ? normalized : DEFAULT_REGISTER_NAME;
}

export function createDefaultCashSessionDenominations(): CashSessionDenomination[] {
  return DEFAULT_CASH_SESSION_DENOMINATION_VALUES.map(value => ({
    value,
    count: 0,
  }));
}

export function getCashSessionDenominationTotal(
  denominations: readonly CashSessionDenomination[]
): number {
  return denominations.reduce((total, denomination) => {
    return total + denomination.value * denomination.count;
  }, 0);
}

/**
 * Shared validator behind the opening-float and closing-count checks: a
 * declared cash `amount` must equal the sum of the per-denomination counts.
 *
 * Two distinct rejections (so the renderer can message each precisely):
 * - `invalidCode` when the declared amount is non-finite or negative.
 * - `mismatchCode` when the counted denomination total diverges from the
 *   declared amount by `CASH_SESSION_EPSILON` (1e-6) or more. The epsilon is
 *   a sub-cent floating-point tolerance so an exact count whose IEEE-754 sum
 *   carries representation drift still passes.
 *
 * Returns the counted denomination total, which callers persist as the
 * canonical figure rather than the operator-typed `amount`.
 */
function assertCashAmountMatchesDenominations(args: {
  amount: number;
  denominations: readonly CashSessionDenomination[];
  invalidCode: 'CASH_SESSION_OPENING_FLOAT_INVALID' | 'CASH_SESSION_COUNT_INVALID';
  invalidMessage: string;
  mismatchCode: 'CASH_SESSION_OPENING_FLOAT_MISMATCH' | 'CASH_SESSION_COUNT_MISMATCH';
  mismatchMessage: string;
  amountKey: 'openingFloat' | 'actualCount';
}) {
  const countedTotal = getCashSessionDenominationTotal(args.denominations);

  if (!Number.isFinite(args.amount) || args.amount < 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: args.invalidCode,
      message: args.invalidMessage,
      details: { [args.amountKey]: args.amount },
    });
  }

  if (Math.abs(countedTotal - args.amount) >= CASH_SESSION_EPSILON) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: args.mismatchCode,
      message: args.mismatchMessage,
      details: {
        [args.amountKey]: args.amount,
        countedTotal,
      },
    });
  }

  return countedTotal;
}

export function assertOpeningFloatMatchesDenominations(
  openingFloat: number,
  denominations: readonly CashSessionDenomination[]
): void {
  assertCashAmountMatchesDenominations({
    amount: openingFloat,
    denominations,
    invalidCode: 'CASH_SESSION_OPENING_FLOAT_INVALID',
    invalidMessage: 'Opening float must be zero or greater',
    mismatchCode: 'CASH_SESSION_OPENING_FLOAT_MISMATCH',
    mismatchMessage: 'Opening float must match the denomination count total',
    amountKey: 'openingFloat',
  });
}

export function getClosingCountTotal(
  actualCount: number,
  denominations: readonly CashSessionDenomination[]
): number {
  return assertCashAmountMatchesDenominations({
    amount: actualCount,
    denominations,
    invalidCode: 'CASH_SESSION_COUNT_INVALID',
    invalidMessage: 'Closing count must be zero or greater',
    mismatchCode: 'CASH_SESSION_COUNT_MISMATCH',
    mismatchMessage: 'Closing count must match the denomination count total',
    amountKey: 'actualCount',
  });
}

export function getCashSessionOverShort(expectedBalance: number, actualCount: number): number {
  return roundMoney(actualCount - expectedBalance);
}

/**
 * Map an always-positive cash-movement `amount` to its signed drawer delta.
 *
 * Invariants:
 * - `amount` is ALWAYS supplied positive-and-finite; the sign lives entirely
 *   in the movement `type`, never in the magnitude. A non-finite or
 *   non-positive `amount` is rejected with `CASH_MOVEMENT_INVALID_AMOUNT`.
 * - Sign convention (the single source of truth for drawer math): inflows
 *   `sale` / `paid_in` / `replenishment` return `+amount`; outflows
 *   `refund` / `paid_out` / `skim` return `-amount`. Any type outside both
 *   sets throws `CASH_MOVEMENT_UNSUPPORTED_TYPE` — there is no silent
 *   zero-fallback, so a new enum member must be classified explicitly.
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
 * ENG-042 / ENG-055 — in-transaction TOCTOU re-check that the cash session
 * bound to a sale write is STILL open.
 *
 * Invariants:
 * - `requireActiveCashSession(...)` runs OUTSIDE the transaction as a
 *   fast-fail UX guard (so the common no-session case never opens a BEGIN).
 *   This helper re-validates `status='open'` against the in-transaction
 *   snapshot immediately before any sale write touches `cashSessionId`.
 *   Without it, a concurrent `cashSessions.close` landing between the outer
 *   check and the transaction body would silently bind the new sale /
 *   refund / completion to a now-closed shift. better-sqlite3 single-process
 *   serialization keeps the window small but non-zero, and the libSQL/Turso
 *   replication planned in ENG-037 widens it.
 * - Read-only: takes a `Pick<DatabaseInstance, 'select'>` and mutates
 *   nothing. The caller owns the surrounding transaction.
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
      message:
        'Cash session was closed between the precondition check and the transaction body',
      details: { cashSessionId },
    });
  }
}

/**
 * ENG-055 / ENG-056 — Insert a `cash_movements` row + advance the session's
 * `expected_balance` in lockstep, scoped to the caller's transaction.
 *
 * Invariants:
 * - The movement insert and the `expected_balance` advance happen in the
 *   SAME transaction (the caller's `args.tx`); the drawer total never drifts
 *   from the sum of its movements. The advance is `+getCashMovementSignedAmount(type, amount)`
 *   so the sign convention lives in exactly one place.
 * - Two-decimal money invariant: the input is `roundMoney`-ed BEFORE the
 *   positivity guard so a sub-cent positive (e.g. 0.001) collapses to 0 and
 *   skips rather than tripping the `chk_cash_movements_amount_2dec` CHECK;
 *   the balance update is wrapped in SQLite `round(..., 2)` to absorb
 *   IEEE-754 addition drift before the `chk_cash_sessions_expected_2dec`
 *   CHECK sees it.
 * - `referenceId` is `string | null`: a sale/refund movement points at the
 *   sale id; a manual shift movement (`paid_in` / `paid_out` / `skim` /
 *   `replenishment`, routed via `application/cash-sessions/recordCashMovement`)
 *   has no source reference and passes `null`.
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
  // ENG-176a-rounding — round BEFORE the positivity guard so the
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

  // ENG-176a-rounding — `expected_balance + signedAmount` runs at the
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

export async function getActiveCashSessionForCashier(
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
 *   This is the canonical building block referenced in AGENTS.md — never
 *   re-implement the active-session lookup inline.
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

async function getNextRegisterTemplateSortOrder(
  db: DatabaseInstance,
  siteId: string
) {
  const [result] = await db
    .select({ value: max(denominationTemplates.sortOrder) })
    .from(denominationTemplates)
    .where(eq(denominationTemplates.siteId, siteId));

  return (result?.value ?? -1) + 1;
}

export async function ensureRegisterAssignmentTemplate(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    registerName: string;
    openingFloat: number;
    denominations: CashSessionDenomination[];
  }
) {
  const registerName = normalizeRegisterName(args.registerName);
  const existing = await db
    .select()
    .from(denominationTemplates)
    .where(
      and(
        eq(denominationTemplates.tenantId, args.tenantId),
        eq(denominationTemplates.siteId, args.siteId),
        eq(denominationTemplates.registerName, registerName)
      )
    )
    .get();

  const now = new Date().toISOString();
  const openingFloat = roundMoney(args.openingFloat);

  if (existing) {
    await db
      .update(denominationTemplates)
      .set({
        label: registerName,
        openingFloat,
        denominations: args.denominations,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(denominationTemplates.id, existing.id));

    return existing.id;
  }

  const sortOrder = await getNextRegisterTemplateSortOrder(db, args.siteId);
  const id = nanoid();

  await db.insert(denominationTemplates).values({
    id,
    tenantId: args.tenantId,
    siteId: args.siteId,
    registerName,
    label: registerName,
    openingFloat,
    denominations: args.denominations,
    sortOrder,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function ensureRegisterAssignmentTemplatesForSite(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
  }
) {
  const existingTemplates = await db
    .select()
    .from(denominationTemplates)
    .where(
      and(
        eq(denominationTemplates.tenantId, args.tenantId),
        eq(denominationTemplates.siteId, args.siteId)
      )
    )
    .orderBy(asc(denominationTemplates.sortOrder), asc(denominationTemplates.label));

  // Backfill templates from historical sessions only when no templates exist.
  // Once templates are seeded, `open` keeps them in sync via
  // `ensureRegisterAssignmentTemplate`, so rescanning session history on every
  // POS page load would be wasted work.
  if (existingTemplates.length === 0) {
    const knownRegisterNames = new Set<string>();
    const recentRegisterSessions = await db
      .select({
        registerName: cashSessions.registerName,
        openingFloat: cashSessions.openingFloat,
        denominations: cashSessions.openingCountDenominations,
      })
      .from(cashSessions)
      .where(
        and(eq(cashSessions.tenantId, args.tenantId), eq(cashSessions.siteId, args.siteId))
      )
      .orderBy(desc(cashSessions.openedAt))
      .limit(REGISTER_ASSIGNMENT_BACKFILL_LIMIT);

    for (const session of recentRegisterSessions) {
      const registerName = normalizeRegisterName(session.registerName);

      if (knownRegisterNames.has(registerName)) {
        continue;
      }

      knownRegisterNames.add(registerName);
      await ensureRegisterAssignmentTemplate(db, {
        tenantId: args.tenantId,
        siteId: args.siteId,
        registerName,
        openingFloat: session.openingFloat,
        denominations: session.denominations,
      });
    }

    if (knownRegisterNames.size === 0) {
      await ensureRegisterAssignmentTemplate(db, {
        tenantId: args.tenantId,
        siteId: args.siteId,
        registerName: DEFAULT_REGISTER_NAME,
        openingFloat: 0,
        denominations: createDefaultCashSessionDenominations(),
      });
    }
  }

  return db
    .select()
    .from(denominationTemplates)
    .where(
      and(
        eq(denominationTemplates.tenantId, args.tenantId),
        eq(denominationTemplates.siteId, args.siteId),
        eq(denominationTemplates.isActive, true)
      )
    )
    .orderBy(asc(denominationTemplates.sortOrder), asc(denominationTemplates.label));
}
