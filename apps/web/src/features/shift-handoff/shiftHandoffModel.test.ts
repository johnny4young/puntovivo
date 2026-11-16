import { describe, expect, it } from 'vitest';
import {
  countedTotal,
  countsMatch,
  denominationLabel,
  isCoin,
  shiftCurvePoints,
} from './shiftHandoffModel';

describe('shiftHandoffModel', () => {
  it('labels thousands compactly and tells coins from notes', () => {
    expect(denominationLabel(100000)).toBe('100');
    expect(denominationLabel(500)).toBe('500');
    expect(isCoin(500)).toBe(true);
    expect(isCoin(2000)).toBe(false);
  });

  it('totals a count and matches within a cent', () => {
    const total = countedTotal([
      { value: 50000, count: 2 },
      { value: 500, count: 3 },
    ]);
    expect(total).toBe(101500);
    expect(countsMatch(total, 101500.004)).toBe(true);
    expect(countsMatch(total, 101400)).toBe(false);
  });

  it('draws the cumulative shift curve inside the box', () => {
    const points = shiftCurvePoints(
      [
        { at: '2026-11-11T13:00:00.000Z', total: 100 },
        { at: '2026-11-11T14:00:00.000Z', total: 300 },
      ],
      '2026-11-11T12:00:00.000Z',
      '2026-11-11T16:00:00.000Z',
      400,
      40
    );
    expect(points).toBe('0,40 100.0,30.0 200.0,0.0 400,0');
    expect(
      shiftCurvePoints([], '2026-11-11T12:00:00.000Z', '2026-11-11T13:00:00.000Z', 10, 4)
    ).toBe('0,4 10,4');
  });
});
