/**
 * FEFO selection + COGS costing (Auditoría 2026-07 — lots & costing).
 */
import { describe, it, expect } from 'vitest';
import {
  orderLotsFefo,
  selectLotsFefo,
  weightedAverageUnitCost,
  type SelectableLot,
} from '../services/inventory-lots/select-fefo.js';

function lot(overrides: Partial<SelectableLot> & { id: string }): SelectableLot {
  return {
    expiresAt: null,
    onHand: 10,
    unitCost: 100,
    receivedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('orderLotsFefo', () => {
  it('orders by expiry asc, nulls last, then receivedAt, then id', () => {
    const lots = [
      lot({ id: 'c', expiresAt: null, receivedAt: '2026-01-01T00:00:00.000Z' }),
      lot({ id: 'a', expiresAt: '2026-03-01', receivedAt: '2026-01-05T00:00:00.000Z' }),
      lot({ id: 'b', expiresAt: '2026-02-01', receivedAt: '2026-01-02T00:00:00.000Z' }),
      lot({ id: 'd', expiresAt: '2026-03-01', receivedAt: '2026-01-03T00:00:00.000Z' }),
    ];
    expect(orderLotsFefo(lots).map(l => l.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('is deterministic on identical expiry + receipt via id tiebreak', () => {
    const lots = [
      lot({ id: 'y', expiresAt: '2026-02-01', receivedAt: '2026-01-01T00:00:00.000Z' }),
      lot({ id: 'x', expiresAt: '2026-02-01', receivedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(orderLotsFefo(lots).map(l => l.id)).toEqual(['x', 'y']);
  });
});

describe('selectLotsFefo', () => {
  it('draws the soonest-expiring lot first and reports exact COGS', () => {
    const lots = [
      lot({ id: 'far', expiresAt: '2026-06-01', onHand: 10, unitCost: 120 }),
      lot({ id: 'soon', expiresAt: '2026-02-01', onHand: 6, unitCost: 100 }),
    ];
    const sel = selectLotsFefo(lots, 8);
    // 6 from the soonest lot @100, then 2 from the next @120.
    expect(sel.allocations).toEqual([
      { lotId: 'soon', quantity: 6, unitCost: 100, lineCost: 600 },
      { lotId: 'far', quantity: 2, unitCost: 120, lineCost: 240 },
    ]);
    expect(sel.totalCost).toBe(840);
    expect(sel.shortfall).toBe(0);
  });

  it('reports a shortfall instead of throwing when lots cannot cover demand', () => {
    const lots = [lot({ id: 'only', onHand: 3, unitCost: 100 })];
    const sel = selectLotsFefo(lots, 5);
    expect(sel.allocations).toEqual([
      { lotId: 'only', quantity: 3, unitCost: 100, lineCost: 300 },
    ]);
    expect(sel.shortfall).toBe(2);
  });

  it('skips empty lots and handles a zero request', () => {
    const lots = [lot({ id: 'empty', onHand: 0 }), lot({ id: 'ok', onHand: 4, unitCost: 50 })];
    expect(selectLotsFefo(lots, 0)).toEqual({ allocations: [], totalCost: 0, shortfall: 0 });
    const sel = selectLotsFefo(lots, 3);
    expect(sel.allocations.map(a => a.lotId)).toEqual(['ok']);
  });

  it('handles fractional weighed quantities with 2-decimal cost', () => {
    const lots = [lot({ id: 'kg', onHand: 2.5, unitCost: 33.33 })];
    const sel = selectLotsFefo(lots, 1.75);
    expect(sel.allocations[0]!.quantity).toBe(1.75);
    // roundMoney(1.75 * 33.33) = 58.33
    expect(sel.totalCost).toBe(58.33);
  });
});

describe('weightedAverageUnitCost', () => {
  it('blends the per-lot costs of a multi-lot allocation', () => {
    const sel = selectLotsFefo(
      [
        lot({ id: 'a', expiresAt: '2026-01-01', onHand: 4, unitCost: 100 }),
        lot({ id: 'b', expiresAt: '2026-02-01', onHand: 4, unitCost: 200 }),
      ],
      8
    );
    // (4*100 + 4*200) / 8 = 150
    expect(weightedAverageUnitCost(sel)).toBe(150);
  });

  it('is 0 for an empty plan', () => {
    expect(weightedAverageUnitCost({ allocations: [], totalCost: 0, shortfall: 0 })).toBe(0);
  });
});
