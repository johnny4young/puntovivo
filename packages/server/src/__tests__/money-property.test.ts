/**
 * property-based invariants for roundMoney.
 *
 * The golden-vector parity suites pin both implementations to a reference
 * formula over a fixed sweep; these properties cover the space between the
 * vectors with generated doubles. The invariants:
 * - idempotence: rounding a rounded value is a fixed point;
 * - sign symmetry: roundMoney(-x) === -roundMoney(x) (half-away-from-zero
 * must mirror across zero — the documented Math.round pitfall);
 * - bounded error: |x − roundMoney(x)| never exceeds half a cent (plus
 * float noise at large magnitudes).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { roundMoney } from '../lib/money.js';

const finiteMoney = fc.double({
  min: -1e9,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});

const RUNS = { numRuns: 1000 };

describe('roundMoney properties', () => {
  it('is idempotent: roundMoney(roundMoney(x)) === roundMoney(x)', () => {
    fc.assert(
      fc.property(finiteMoney, x => {
        const once = roundMoney(x);
        expect(roundMoney(once)).toBe(once);
      }),
      RUNS
    );
  });

  it('is sign-symmetric: roundMoney(-x) === -roundMoney(x)', () => {
    fc.assert(
      fc.property(finiteMoney, x => {
        // `===` treats -0 and 0 as equal, which matches the documented
        // normalization (roundMoney never returns -0).
        expect(roundMoney(-x)).toBe(-roundMoney(x) === 0 ? 0 : -roundMoney(x));
      }),
      RUNS
    );
  });

  it('never returns -0', () => {
    fc.assert(
      fc.property(finiteMoney, x => {
        expect(Object.is(roundMoney(x), -0)).toBe(false);
      }),
      RUNS
    );
  });

  it('rounds within half a cent: |x − roundMoney(x)| ≤ 0.005 (+ float noise)', () => {
    fc.assert(
      fc.property(finiteMoney, x => {
        const error = Math.abs(x - roundMoney(x));
        // ulp of a double near 1e9 is ~1.2e-7; the 1e-6 slack absorbs it.
        expect(error).toBeLessThanOrEqual(0.005 + 1e-6);
      }),
      RUNS
    );
  });

  it('holds the documented edge cases', () => {
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(-0)).toBe(0);
    expect(roundMoney(0.005)).toBe(0.01);
    expect(roundMoney(-0.005)).toBe(-0.01);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(-2.345)).toBe(-2.35);
  });
});
