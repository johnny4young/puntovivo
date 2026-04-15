import { and, desc, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { cashSessions, type CashSessionDenomination } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';

const CASH_SESSION_EPSILON = 1e-6;

export function normalizeRegisterName(registerName: string): string {
  const normalized = registerName.trim();
  return normalized.length > 0 ? normalized : 'Main register';
}

export function getCashSessionDenominationTotal(
  denominations: readonly CashSessionDenomination[]
): number {
  return denominations.reduce((total, denomination) => {
    return total + denomination.value * denomination.count;
  }, 0);
}

export function amountsMatch(
  expectedAmount: number,
  denominations: readonly CashSessionDenomination[]
): boolean {
  return (
    Math.abs(getCashSessionDenominationTotal(denominations) - expectedAmount) < CASH_SESSION_EPSILON
  );
}

export function assertOpeningFloatMatchesDenominations(
  openingFloat: number,
  denominations: readonly CashSessionDenomination[]
): void {
  if (!Number.isFinite(openingFloat) || openingFloat < 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_OPENING_FLOAT_INVALID',
      message: 'Opening float must be zero or greater',
      details: { openingFloat },
    });
  }

  if (!amountsMatch(openingFloat, denominations)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_OPENING_FLOAT_MISMATCH',
      message: 'Opening float must match the denomination count total',
      details: {
        openingFloat,
        countedTotal: getCashSessionDenominationTotal(denominations),
      },
    });
  }
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
