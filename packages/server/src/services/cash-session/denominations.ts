/**
 * Cash denomination + over/short validators.
 *
 * The opening-float and closing-count checks (a declared amount must
 * equal the sum of its per-denomination counts), the register-name
 * normalizer, the default denomination builder, and the over/short
 * computation. Pure functions over denomination arrays.
 *
 * @module services/cash-session/denominations
 */

import type { CashSessionDenomination } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import {
  CASH_SESSION_EPSILON,
  DEFAULT_CASH_SESSION_DENOMINATION_VALUES,
  DEFAULT_REGISTER_NAME,
} from './constants.js';

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
