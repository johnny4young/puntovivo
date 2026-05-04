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
  return Math.round((actualCount - expectedBalance) * 100) / 100;
}

export function getCashMovementSignedAmount(type: CashMovementType, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Cash movement amount must be greater than zero');
  }

  if (CASH_MOVEMENT_POSITIVE_TYPES.has(type)) {
    return amount;
  }

  if (CASH_MOVEMENT_NEGATIVE_TYPES.has(type)) {
    return -amount;
  }

  throw new Error(`Unsupported cash movement type: ${type}`);
}

/**
 * ENG-042 / ENG-055 — TOCTOU defense for sale lifecycle transactions.
 *
 * `requireActiveCashSession(...)` runs OUTSIDE the transaction (as a
 * fast-fail UX guard, so the common no-session case never opens a
 * BEGIN). This helper re-validates the session is still open against
 * the in-transaction snapshot before any sale write touches
 * `cashSessionId`. Without it, a concurrent `cashSessions.close`
 * between the outer check and the transaction body would silently
 * bind the new sale (or refund / completion) to a now-closed shift.
 *
 * better-sqlite3 single-process serialization keeps the production
 * window small but not zero, and the libSQL/Turso replication planned
 * in ENG-037 will widen it. The defense is also structurally correct
 * for any future runtime (Bun, Deno, multi-process) the project may
 * adopt.
 *
 * Throws `CASH_SESSION_REQUIRED` (already wired in en + es locales).
 * Originally lived inline in `trpc/routers/sales.ts` (and a private
 * copy in `application/sales/completeSale.ts`); ENG-055 unifies the
 * implementation here.
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
 * ENG-055 / ENG-056 — Insert a `cash_movements` row + advance the
 * session's `expected_balance` in lockstep, scoped to the caller's
 * transaction.
 *
 * Returns the inserted row id on a real persistence, or `null` when the
 * call was a no-op because `amount <= 0` (a credit-tender sale, or a
 * refund whose persisted cash contribution was zero — both legitimate
 * cases the sale lifecycle hits frequently). Use the return value to
 * decide whether to emit a `cash_movement` journal effect (and as the
 * effect's `resourceId`).
 *
 * Originally a private helper duplicated by `application/sales/completeSale.ts`
 * and `trpc/routers/sales.ts`; ENG-055 unified the sale-lifecycle copies.
 * ENG-056 broadens `type` to the full `CashMovementType` enum so manual
 * shift movements (`paid_in`, `paid_out`, `skim`, `replenishment`)
 * routed through `application/cash-sessions/recordCashMovement` reuse the
 * same insertion path. The signed-amount math in
 * `getCashMovementSignedAmount` already covers all six types.
 * `referenceId` widens to `string | null` because manual movements have
 * no source reference (sale id) to point at.
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
  if (args.amount <= 0) {
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
      amount: args.amount,
      referenceId: args.referenceId,
      note: args.note,
      createdBy: args.createdBy,
      createdAt: args.createdAt,
    })
    .run();

  args.tx
    .update(cashSessions)
    .set({
      expectedBalance: sql`${cashSessions.expectedBalance} + ${getCashMovementSignedAmount(args.type, args.amount)}`,
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

  return rows.reduce((total, row) => total + row.amount, 0);
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

  if (existing) {
    await db
      .update(denominationTemplates)
      .set({
        label: registerName,
        openingFloat: args.openingFloat,
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
    openingFloat: args.openingFloat,
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
