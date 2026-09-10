/**
 * Every stock guard in the application tolerates a debit that overshoots the
 * recorded balance by up to QUANTITY_EPSILON, because a balance that has
 * crossed SQLite and repeated unit arithmetic carries IEEE-754 residue. The
 * debits that followed then subtracted the FULL requested amount, so the
 * tolerated overshoot was persisted as a small NEGATIVE site balance — and
 * site balances carry no non-negative constraint, so it stuck and compounded.
 *
 * These cases pin the settlement rule shared by all five debit paths.
 */

import { describe, expect, it } from 'vitest';
import { QUANTITY_EPSILON, settleDebitedBalance } from '../lib/quantity.js';

describe('settleDebitedBalance', () => {
  it('canonicalises a tolerated overshoot to exactly zero', () => {
    // The reviewer's example: this pair passes every guard and used to leave
    // -0.0000005 behind.
    expect(settleDebitedBalance(0.9999995, 1)).toBe(0);
    expect(settleDebitedBalance(1 - QUANTITY_EPSILON / 2, 1)).toBe(0);
  });

  it('canonicalises float residue on an exact debit', () => {
    // 0.1 + 0.2 - 0.3 is not 0 in IEEE-754; the remainder must still read as
    // empty stock rather than as a sliver that later reports as available.
    expect(settleDebitedBalance(0.1 + 0.2, 0.3)).toBe(0);
  });

  it('leaves a real remainder untouched', () => {
    expect(settleDebitedBalance(10, 3)).toBe(7);
    expect(settleDebitedBalance(0.005, 0.002)).toBeCloseTo(0.003, 12);
  });

  it('does NOT hide a genuine shortfall', () => {
    // Beyond the tolerance the deficit is real missing stock. Clamping it to
    // zero here would silently absorb an operational discrepancy, so the
    // negative survives for the caller's guard to reject.
    expect(settleDebitedBalance(1, 2)).toBe(-1);
    expect(settleDebitedBalance(0.5, 0.6)).toBeLessThan(0);
  });

  it('separates a tolerated overshoot from a real one', () => {
    // Deliberately NOT asserting the exact epsilon boundary: `1 - EPSILON`
    // minus `1` lands a hair outside the tolerance in IEEE-754, so pinning the
    // boundary would be testing float representation rather than the rule.
    expect(settleDebitedBalance(1, 1 + QUANTITY_EPSILON / 2)).toBe(0);
    expect(settleDebitedBalance(1, 1 + QUANTITY_EPSILON * 10)).toBeLessThan(0);
  });
});
