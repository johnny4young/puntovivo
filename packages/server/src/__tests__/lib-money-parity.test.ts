/**
 * Parity pin for the canonical `roundMoney` (ENG-176a) — twin of
 * `apps/web/src/lib/money.parity.test.ts`.
 *
 * The web renderer hand-mirrors this helper; both suites assert their
 * local implementation against the SAME inlined reference formula over
 * the SAME deterministic sweep, so a drift on either side fails that
 * side's gate. Until a `packages/shared` workspace exists, these twin
 * files are the parity contract — keep the reference formula, the LCG
 * seed, and the edge-case list identical in both.
 */
import { describe, expect, it } from 'vitest';
import { roundMoney } from '../lib/money.js';

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

describe('roundMoney parity contract (twin of the web suite)', () => {
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
