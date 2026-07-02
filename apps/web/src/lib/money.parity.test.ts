/**
 * Parity pin for the client-side `roundMoney` mirror.
 *
 * The renderer's copy MUST stay behavior-identical to the server's
 * canonical implementation in `packages/server/src/lib/money.ts`
 * (ENG-176a) — a preview that rounds differently from the receipt reads
 * as a money bug at the register. Until a `packages/shared` workspace
 * exists, this suite (and its twin,
 * `packages/server/src/__tests__/lib-money-parity.test.ts`) pins both
 * sides to the same inlined reference formula over the same
 * deterministic sweep: if either implementation drifts from the
 * canonical EPSILON-corrected half-away-from-zero form, its side fails.
 */
import { describe, expect, it } from 'vitest';
import { roundMoney } from './money';

/** The canonical formula, restated verbatim. Keep in sync with the twin test. */
function referenceRoundMoney(value: number): number {
  const rounded =
    Math.sign(value) * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100);
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Deterministic LCG so both twin suites sweep the exact same values. */
function* seededValues(count: number): Generator<number> {
  let state = 0x2f6e2b1;
  for (let i = 0; i < count; i++) {
    state = (state * 48271) % 0x7fffffff;
    const magnitude = (state % 10_000_000) / 1000; // 0 .. 9999.999
    yield i % 2 === 0 ? magnitude : -magnitude;
  }
}

const EDGE_CASES = [
  0, -0, 1.005, -1.005, 2.675, 10.005, 0.1 + 0.2, 99.99000000000001,
  100 / 1.19, 84.03 * 1.19, 0.004999999, 0.005, -2.345, 1e9 + 0.005,
  0.015, 0.025, 0.035, 1.115, 1.245,
];

describe('roundMoney parity with the server canonical formula', () => {
  it('matches the reference on every edge case', () => {
    for (const value of EDGE_CASES) {
      expect(roundMoney(value), `value=${value}`).toBe(referenceRoundMoney(value));
    }
  });

  it('matches the reference across a 10k-value deterministic sweep', () => {
    for (const value of seededValues(10_000)) {
      const actual = roundMoney(value);
      const expected = referenceRoundMoney(value);
      if (actual !== expected) {
        expect(actual, `value=${value}`).toBe(expected);
      }
    }
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundMoney(-0), -0)).toBe(false);
    expect(Object.is(roundMoney(-0.001), -0)).toBe(false);
  });
});
