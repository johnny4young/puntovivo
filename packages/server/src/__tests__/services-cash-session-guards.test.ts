/**
 * `services/cash-session` — direct unit coverage for the drawer-math guards
 * that every cash flow leans on but no suite exercised head-on:
 *
 * - `getCashMovementSignedAmount` — THE sign-convention table (ENG-055/056:
 *   the sign lives only here; a drift silently corrupts expected_balance).
 * - `assertOpeningFloatMatchesDenominations` / `getClosingCountTotal` — the
 *   declared-amount vs counted-denominations reconciliation with its two
 *   distinct rejections and the sub-cent IEEE-754 tolerance.
 * - `assertCashSessionStillOpen` — the in-transaction TOCTOU re-check
 *   (ENG-042/055) on its rejecting branch.
 * - `requireActiveCashSession` — the no-active-site rejection.
 * - register-name + default-denomination normalization helpers.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  assertCashSessionStillOpen,
  assertOpeningFloatMatchesDenominations,
  createDefaultCashSessionDenominations,
  getCashMovementSignedAmount,
  getCashSessionDenominationTotal,
  getCashSessionOverShort,
  getClosingCountTotal,
  normalizeRegisterName,
  requireActiveCashSession,
} from '../services/cash-session.js';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

afterEach(() => {
  closeDatabase();
});

describe('getCashMovementSignedAmount — sign convention table', () => {
  it('maps inflows to +amount: sale, paid_in, replenishment', () => {
    expect(getCashMovementSignedAmount('sale', 125.5)).toBe(125.5);
    expect(getCashMovementSignedAmount('paid_in', 40)).toBe(40);
    expect(getCashMovementSignedAmount('replenishment', 200)).toBe(200);
  });

  it('maps outflows to -amount: refund, paid_out, skim', () => {
    expect(getCashMovementSignedAmount('refund', 125.5)).toBe(-125.5);
    expect(getCashMovementSignedAmount('paid_out', 40)).toBe(-40);
    expect(getCashMovementSignedAmount('skim', 200)).toBe(-200);
  });

  it('rejects zero, negative, and non-finite amounts (sign never rides the magnitude)', () => {
    expect(() => getCashMovementSignedAmount('sale', 0)).toThrowError(
      /greater than zero/
    );
    expect(() => getCashMovementSignedAmount('sale', -5)).toThrowError(
      /greater than zero/
    );
    expect(() => getCashMovementSignedAmount('sale', Number.NaN)).toThrowError(
      /greater than zero/
    );
    expect(() =>
      getCashMovementSignedAmount('sale', Number.POSITIVE_INFINITY)
    ).toThrowError(/greater than zero/);
  });

  it('rejects an unclassified movement type instead of defaulting to zero', () => {
    expect(() =>
      getCashMovementSignedAmount('adjustment' as never, 10)
    ).toThrowError(/Unsupported cash movement type/);
  });
});

describe('opening float / closing count vs denomination reconciliation', () => {
  it('accepts an exact denomination match', () => {
    expect(() =>
      assertOpeningFloatMatchesDenominations(70000, [
        { value: 50000, count: 1 },
        { value: 20000, count: 1 },
      ])
    ).not.toThrow();
  });

  it('tolerates sub-cent IEEE-754 drift between declared amount and counted total', () => {
    // 0.1 + 0.2 sums to 0.30000000000000004 — within the 1e-6 epsilon.
    expect(() =>
      assertOpeningFloatMatchesDenominations(0.3, [
        { value: 0.1, count: 1 },
        { value: 0.2, count: 1 },
      ])
    ).not.toThrow();
  });

  it('rejects a negative or non-finite opening float as INVALID', () => {
    expect(() => assertOpeningFloatMatchesDenominations(-50, [])).toThrowError(
      /zero or greater/
    );
    expect(() =>
      assertOpeningFloatMatchesDenominations(Number.NaN, [])
    ).toThrowError(/zero or greater/);
  });

  it('rejects a real divergence between declared float and counted total as MISMATCH', () => {
    expect(() =>
      assertOpeningFloatMatchesDenominations(100000, [{ value: 50000, count: 1 }])
    ).toThrowError(/match the denomination count total/);
  });

  it('getClosingCountTotal returns the counted total as the canonical figure', () => {
    expect(
      getClosingCountTotal(70000, [
        { value: 50000, count: 1 },
        { value: 10000, count: 2 },
      ])
    ).toBe(70000);
  });

  it('getClosingCountTotal rejects a count that does not match its denominations', () => {
    expect(() =>
      getClosingCountTotal(80000, [{ value: 50000, count: 1 }])
    ).toThrowError(/match the denomination count total/);
  });
});

describe('over/short and normalization helpers', () => {
  it('getCashSessionOverShort: positive when the drawer has more than expected, negative when short', () => {
    expect(getCashSessionOverShort(100000, 105000)).toBe(5000);
    expect(getCashSessionOverShort(100000, 98000)).toBe(-2000);
  });

  it('getCashSessionOverShort rounds away IEEE-754 noise', () => {
    expect(getCashSessionOverShort(0.1 + 0.2, 0.3)).toBe(0);
  });

  it('normalizeRegisterName trims and falls back to the default register on blank input', () => {
    expect(normalizeRegisterName('  Caja 2  ')).toBe('Caja 2');
    expect(normalizeRegisterName('   ')).toBe('Main register');
    expect(normalizeRegisterName('')).toBe('Main register');
  });

  it('createDefaultCashSessionDenominations starts every COP denomination at count 0', () => {
    const denominations = createDefaultCashSessionDenominations();
    expect(denominations.length).toBeGreaterThan(0);
    expect(denominations.every(d => d.count === 0 && d.value > 0)).toBe(true);
    expect(getCashSessionDenominationTotal(denominations)).toBe(0);
  });
});

describe('DB-backed guards', () => {
  it('assertCashSessionStillOpen throws CASH_SESSION_REQUIRED when the session is gone (TOCTOU branch)', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    expect(() =>
      assertCashSessionStillOpen(getDatabase(), 'tenant-x', 'no-such-session')
    ).toThrowError(/closed between the precondition check/);
  });

  it('requireActiveCashSession rejects when the user has no active site', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    await expect(
      requireActiveCashSession(getDatabase(), 'tenant-x', null, 'cashier-x')
    ).rejects.toThrowError(/active site is required/);
  });
});
