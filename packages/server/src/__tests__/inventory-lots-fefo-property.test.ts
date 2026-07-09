/**
 * ENG-196 — property-based invariants for the FEFO allocation engine.
 *
 * `selectLotsFefo` is pure, so its money/stock invariants can be asserted
 * over generated lot sets instead of hand-picked fixtures:
 *   - conservation: Σ allocated + shortfall === requested;
 *   - no allocation ever exceeds its lot's on-hand;
 *   - allocations respect the FEFO order (soonest expiry, nulls last, then
 *     receipt, then id) and every non-final draw exhausts its lot;
 *   - the COGS layer is exact: lineCost = roundMoney(qty × cost) and
 *     totalCost accumulates with roundMoney at every step;
 *   - weightedAverageUnitCost is the rounded blend of the plan.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  orderLotsFefo,
  selectLotsFefo,
  weightedAverageUnitCost,
  type SelectableLot,
} from '../services/inventory-lots/select-fefo.js';
import { roundMoney } from '../lib/money.js';

const EPSILON = 1e-9;

/** One generated lot; ids are assigned per-array so they stay unique. */
const lotShape = fc.record({
  // ~40% non-perishable (null), rest a date in a narrow window so expiry
  // collisions (the receivedAt/id tiebreakers) actually get exercised.
  expiresAt: fc.option(
    fc.integer({ min: 0, max: 30 }).map(d => `2026-08-${String(d + 1).padStart(2, '0')}`),
    { nil: null, freq: 5 }
  ),
  // Fractional on-hands (weighed goods) including tiny and zero lots.
  onHand: fc.oneof(
    fc.constant(0),
    fc.double({ min: 0.001, max: 10_000, noNaN: true, noDefaultInfinity: true })
  ),
  // 2-decimal non-negative cost, the shape the DB CHECK enforces.
  unitCost: fc.integer({ min: 0, max: 1_000_000 }).map(cents => cents / 100),
  receivedAt: fc
    .integer({ min: 0, max: 10_000 })
    .map(offset => new Date(1_750_000_000_000 + offset * 60_000).toISOString()),
});

const lotsArb = fc
  .array(lotShape, { minLength: 0, maxLength: 12 })
  .map(shapes =>
    shapes.map((shape, index) => ({ ...shape, id: `lot-${String(index).padStart(2, '0')}` }))
  ) as fc.Arbitrary<SelectableLot[]>;

const quantityArb = fc.oneof(
  fc.constant(0),
  fc.double({ min: 0.001, max: 25_000, noNaN: true, noDefaultInfinity: true })
);

const RUNS = { numRuns: 500 };

describe('selectLotsFefo properties (ENG-196)', () => {
  it('conserves quantity: Σ allocations + shortfall === requested', () => {
    fc.assert(
      fc.property(lotsArb, quantityArb, (lots, quantity) => {
        const { allocations, shortfall } = selectLotsFefo(lots, quantity);
        const allocated = allocations.reduce((sum, a) => sum + a.quantity, 0);
        const requested = Math.max(0, quantity);
        // Float accumulation across up to 12 draws; tolerance scales with
        // magnitude (ulp near 1e4 is ~2e-12 per op).
        expect(Math.abs(allocated + shortfall - requested)).toBeLessThanOrEqual(
          1e-6 * Math.max(1, requested)
        );
        expect(shortfall).toBeGreaterThanOrEqual(0);
      }),
      RUNS
    );
  });

  it('never draws more than a lot has on hand', () => {
    fc.assert(
      fc.property(lotsArb, quantityArb, (lots, quantity) => {
        const byId = new Map(lots.map(lot => [lot.id, lot]));
        for (const allocation of selectLotsFefo(lots, quantity).allocations) {
          const lot = byId.get(allocation.lotId)!;
          expect(allocation.quantity).toBeGreaterThan(0);
          expect(allocation.quantity).toBeLessThanOrEqual(lot.onHand + EPSILON);
        }
      }),
      RUNS
    );
  });

  it('respects FEFO order and exhausts every non-final lot it draws from', () => {
    fc.assert(
      fc.property(lotsArb, quantityArb, (lots, quantity) => {
        const { allocations } = selectLotsFefo(lots, quantity);
        const fefoIndex = new Map(orderLotsFefo(lots).map((lot, i) => [lot.id, i]));
        const byId = new Map(lots.map(lot => [lot.id, lot]));
        for (let i = 1; i < allocations.length; i++) {
          // Strictly increasing position in the FEFO ordering.
          expect(fefoIndex.get(allocations[i]!.lotId)!).toBeGreaterThan(
            fefoIndex.get(allocations[i - 1]!.lotId)!
          );
        }
        // Every allocation except the last must fully drain its lot (the
        // engine only moves on when a lot is exhausted).
        for (const allocation of allocations.slice(0, -1)) {
          const lot = byId.get(allocation.lotId)!;
          expect(Math.abs(allocation.quantity - lot.onHand)).toBeLessThanOrEqual(1e-9);
        }
      }),
      RUNS
    );
  });

  it('prices the plan exactly: per-line and total COGS use roundMoney', () => {
    fc.assert(
      fc.property(lotsArb, quantityArb, (lots, quantity) => {
        const selection = selectLotsFefo(lots, quantity);
        let expectedTotal = 0;
        for (const allocation of selection.allocations) {
          expect(allocation.lineCost).toBe(roundMoney(allocation.quantity * allocation.unitCost));
          expectedTotal = roundMoney(expectedTotal + allocation.lineCost);
        }
        expect(selection.totalCost).toBe(expectedTotal);
      }),
      RUNS
    );
  });

  it('blends the weighted-average unit cost as roundMoney(total / qty)', () => {
    fc.assert(
      fc.property(lotsArb, quantityArb, (lots, quantity) => {
        const selection = selectLotsFefo(lots, quantity);
        const totalQty = selection.allocations.reduce((sum, a) => sum + a.quantity, 0);
        const expected = totalQty > 0 ? roundMoney(selection.totalCost / totalQty) : 0;
        expect(weightedAverageUnitCost(selection)).toBe(expected);
      }),
      RUNS
    );
  });
});
