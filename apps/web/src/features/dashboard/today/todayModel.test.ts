import { describe, expect, it } from 'vitest';
import { todayFixture } from './fixtures';
import {
  dayPhases,
  filterPending,
  minutesBetween,
  percentChange,
  placeBandLabels,
  waitingRank,
} from './todayModel';

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
    expect(filterPending(pending, 'mine', true).map(item => item.kind)).toEqual([
      'staleSession',
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

  it('matches an approval to the register of the cashier who asked, by id', () => {
    const today = todayFixture();
    const numbered = today.pending.map((item, index) => ({ item, rank: index + 1 }));
    const register = today.registers[0]!;
    expect(waitingRank({ ...register, cashierName: 'Laura Gómez' }, numbered)).toBe(2);
    expect(waitingRank({ ...register, cashierId: 'u-9' }, numbered)).toBeNull();
  });

  it('drops a phase label that would overlap the one before it', () => {
    const placed = placeBandLabels(
      [
        { x: 100, text: 'Opening' },
        { x: 400, text: 'Peak hour · now' },
        { x: 460, text: 'Handoff' },
      ],
      920,
      24
    );
    expect(placed.map(label => label.text)).toEqual(['Opening', 'Peak hour · now']);
    expect(placed[1]).toMatchObject({ anchor: 'start', textX: 406 });
  });

  it('flips a label near the right edge and still checks it against the previous one', () => {
    const placed = placeBandLabels(
      [
        { x: 700, text: 'Opening' },
        { x: 840, text: 'Peak hour' },
      ],
      920,
      24
    );
    expect(placed.map(label => label.anchor)).toEqual(['start']);
    expect(placeBandLabels([{ x: 880, text: 'Handoff' }], 920, 24)[0]).toMatchObject({
      anchor: 'end',
      textX: 874,
    });
  });

  it('counts whole minutes and never goes negative', () => {
    expect(minutesBetween('2026-11-11T10:00:00.000Z', '2026-11-11T10:23:59.000Z')).toBe(23);
    expect(minutesBetween('2026-11-11T10:05:00.000Z', '2026-11-11T10:00:00.000Z')).toBe(0);
  });
});
