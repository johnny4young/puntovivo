import { describe, expect, it } from 'vitest';
import { todayFixture } from './fixtures';
import { dayArcSpan } from './arcGeometry';
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

  describe('dayArcSpan', () => {
    const start = todayFixture().dayStartIso;
    const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
    const hourly = (sales: Record<number, number> = {}) =>
      Array.from({ length: 24 }, (_, hour) => ({ hour, today: sales[hour] ?? 0, comparison: 0 }));

    it('runs from the first shift start to the last shift end', () => {
      const span = dayArcSpan(todayFixture());
      expect(span.from).toBe(7);
      expect(span.to).toBe(21);
      expect(span.now).toBeCloseTo(11.4);
    });

    it('widens to sales made outside the shifts', () => {
      const today = todayFixture({ hourly: hourly({ 5: 1000, 22: 4000 }) });
      expect(dayArcSpan(today)).toMatchObject({ from: 5, to: 23 });
    });

    it('falls back to the band window on a day with no shifts and no sales', () => {
      const empty = { hourly: hourly(), shifts: [] };
      expect(dayArcSpan(todayFixture(empty))).toMatchObject({ from: 6, to: 21 });
      expect(dayArcSpan(todayFixture({ ...empty, generatedAt: at(4.5) }))).toMatchObject({
        from: 4,
        to: 21,
      });
    });

    it('stretches the close to now once the last shift has ended', () => {
      const span = dayArcSpan(todayFixture({ generatedAt: at(22.5) }));
      expect(span).toMatchObject({ from: 7, to: 23 });
      expect(span.now).toBeCloseTo(22.5);
    });

    it('stays inside the business day and never collapses', () => {
      const today = todayFixture({
        hourly: hourly(),
        shifts: [
          { userId: 'u-1', userName: 'Laura', siteId: 'site-1', startsAt: at(-2), endsAt: at(-1) },
        ],
        generatedAt: at(-0.5),
      });
      expect(dayArcSpan(today)).toEqual({ from: 0, to: 1, now: 0 });
    });
  });
});
