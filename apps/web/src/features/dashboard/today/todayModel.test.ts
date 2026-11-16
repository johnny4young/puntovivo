import { describe, expect, it } from 'vitest';
import { todayFixture } from './fixtures';
import { dayPhases, filterPending, percentChange, waitingRank } from './todayModel';

describe('todayModel', () => {
  it('computes the change against last week only when there is a base', () => {
    expect(percentChange(40000, 20000)).toBe(100);
    expect(percentChange(15000, 20000)).toBe(-25);
    expect(percentChange(1000, 0)).toBeNull();
  });

  it('filters the queue by origin and by what the viewer can act on', () => {
    const { pending } = todayFixture();
    expect(filterPending(pending, 'all', true)).toHaveLength(4);
    expect(filterPending(pending, 'cashiers', true).map(item => item.kind)).toEqual([
      'approval',
      'incident',
    ]);
    expect(filterPending(pending, 'mine', false)).toEqual([]);
  });

  it('derives opening, peak and handoff hours from the data', () => {
    const today = todayFixture();
    expect(dayPhases(today, today.dayStartIso)).toEqual({
      openingHour: 7,
      peakHour: 9,
      handoffHour: 14,
    });
  });

  it('links a register card to the queue item it waits on', () => {
    const today = todayFixture();
    const numbered = today.pending.map((item, index) => ({ item, rank: index + 1 }));
    expect(waitingRank(today.registers[0]!, numbered)).toBe(2);
    expect(waitingRank(today.registers[1]!, numbered)).toBe(1);
  });
});
