import { describe, expect, it } from 'vitest';
import {
  draftsPassingOn,
  initialsOf,
  lowChangeCoins,
  shiftDuration,
  sparkline,
} from './handoffModel';

describe('lowChangeCoins', () => {
  it('lists the coins when the drawer holds fewer than ten', () => {
    expect(
      lowChangeCoins(
        [
          { value: 100000, count: 6 },
          { value: 500, count: 1 },
          { value: 200, count: 1 },
          { value: 100, count: 0 },
        ],
        'COP'
      )
    ).toEqual([
      { value: 500, count: 1 },
      { value: 200, count: 1 },
    ]);
  });

  it('stays quiet with enough coins or an unknown currency', () => {
    expect(lowChangeCoins([{ value: 500, count: 10 }], 'COP')).toBeNull();
    expect(lowChangeCoins([{ value: 1, count: 0 }], 'XYZ')).toBeNull();
  });
});

describe('shiftDuration', () => {
  it('splits the elapsed time into hours and minutes', () => {
    expect(shiftDuration('2026-11-21T06:58:00Z', new Date('2026-11-21T14:04:30Z'))).toEqual({
      hours: 7,
      minutes: 6,
    });
  });
});

describe('sparkline', () => {
  it('ends on the last slice and closes the area along the base', () => {
    const path = sparkline([0, 10, 5], 100, 40);
    expect(path?.end).toEqual({ x: 100, y: 22 });
    expect(path?.line.startsWith('M0,40')).toBe(true);
    expect(path?.area.endsWith('L100,40 L0,40 Z')).toBe(true);
  });

  it('draws nothing without sales', () => {
    expect(sparkline([0, 0, 0], 100, 40)).toBeNull();
  });
});

describe('draftsPassingOn', () => {
  const base = {
    saleNumber: 'S-1',
    total: 1,
    suspendedLabel: null,
    tableId: null,
    suspendedAt: '2026-11-21T10:00:00Z',
    suspendedBy: 'me',
    createdBy: 'me',
    cashSessionId: 'cs1',
  };

  it('keeps the cashier’s parked retail drafts only', () => {
    const drafts = [
      { ...base, id: 'mine' },
      { ...base, id: 'legacy', suspendedBy: null },
      { ...base, id: 'other', suspendedBy: 'other' },
      { ...base, id: 'table', tableId: 't1' },
      { ...base, id: 'active', suspendedAt: null },
      { ...base, id: 'sessionless', cashSessionId: null },
    ];
    expect(draftsPassingOn(drafts, 'me').map(draft => draft.id)).toEqual(['mine', 'legacy']);
  });
});

describe('initialsOf', () => {
  it('takes the first two words', () => {
    expect(initialsOf('andrés rojas pérez')).toBe('AR');
    expect(initialsOf(undefined)).toBe('');
  });
});
