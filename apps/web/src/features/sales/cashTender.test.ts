import { describe, expect, it } from 'vitest';
import { applyKeypadKey, breakdownChange, leadingNotes, suggestCashAmounts } from './cashTender';

describe('breakdownChange', () => {
  it('hands over the largest notes first and leaves the rest as coins', () => {
    expect(breakdownChange(12_580, 'COP')).toEqual({
      notes: [
        { value: 10_000, count: 1 },
        { value: 2_000, count: 1 },
      ],
      coins: 580,
    });
  });

  it('repeats a note when the change needs it', () => {
    expect(breakdownChange(46_000, 'COP')).toEqual({
      notes: [
        { value: 20_000, count: 2 },
        { value: 5_000, count: 1 },
        { value: 1_000, count: 1 },
      ],
      coins: 0,
    });
  });

  it('is all coins below the smallest note', () => {
    expect(breakdownChange(750, 'COP')).toEqual({ notes: [], coins: 750 });
  });

  it('keeps cents exact in a decimal currency', () => {
    expect(breakdownChange(26.35, 'USD')).toEqual({
      notes: [
        { value: 20, count: 1 },
        { value: 5, count: 1 },
        { value: 1, count: 1 },
      ],
      coins: 0.35,
    });
  });

  it('adds back up to the change', () => {
    for (const change of [1, 999, 1_000, 87_420, 199_950, 1_234_567]) {
      const breakdown = breakdownChange(change, 'COP')!;
      const total = breakdown.notes.reduce((sum, note) => sum + note.value * note.count, 0);
      expect(total + breakdown.coins).toBe(change);
      expect(breakdown.coins).toBeLessThan(1_000);
    }
  });

  it('gives no breakdown without change or for an unknown currency', () => {
    expect(breakdownChange(0, 'COP')).toBeNull();
    expect(breakdownChange(-50, 'COP')).toBeNull();
    expect(breakdownChange(500, 'XXX')).toBeNull();
  });

  it('matches the currency code case-insensitively', () => {
    expect(breakdownChange(2_000, 'cop')?.notes).toEqual([{ value: 2_000, count: 1 }]);
  });
});

describe('suggestCashAmounts', () => {
  it('rounds the total up to the notes a customer would hand over', () => {
    expect(suggestCashAmounts(87_420, 'COP')).toEqual([90_000, 100_000, 150_000]);
    expect(suggestCashAmounts(18_800, 'COP')).toEqual([19_000, 20_000, 50_000]);
  });

  it('never repeats the exact total', () => {
    expect(suggestCashAmounts(20_000, 'COP')).toEqual([50_000, 100_000, 150_000]);
  });

  it('still suggests amounts above the largest note', () => {
    const amounts = suggestCashAmounts(1_250_000, 'COP');
    expect(amounts).toHaveLength(3);
    expect(amounts.every(amount => amount > 1_250_000)).toBe(true);
  });

  it('falls back to 1-2-5 steps for an unknown currency', () => {
    expect(suggestCashAmounts(87.42, 'XXX')).toEqual([90, 100, 150]);
  });

  it('suggests nothing for an empty sale', () => {
    expect(suggestCashAmounts(0, 'COP')).toEqual([]);
  });
});

describe('leadingNotes', () => {
  it('names the two largest notes in an amount', () => {
    expect(leadingNotes(90_000, 'COP')).toEqual([50_000, 20_000]);
    expect(leadingNotes(100_000, 'COP')).toEqual([100_000]);
    expect(leadingNotes(100, 'XXX')).toEqual([]);
  });
});

describe('applyKeypadKey', () => {
  it('replaces a preset amount with the first digit', () => {
    expect(applyKeypadKey(87_420, '1', true)).toBe(1);
  });

  it('appends digits and the triple zero', () => {
    expect(applyKeypadKey(1, '0', false)).toBe(10);
    expect(applyKeypadKey(100, '000', false)).toBe(100_000);
    expect(applyKeypadKey(0, '000', false)).toBe(0);
  });

  it('drops the last digit and ignores the cents', () => {
    expect(applyKeypadKey(1_234, 'backspace', false)).toBe(123);
    expect(applyKeypadKey(12.75, 'backspace', false)).toBe(1);
    expect(applyKeypadKey(5, 'backspace', true)).toBe(0);
  });

  it('ignores anything that is not a key', () => {
    expect(applyKeypadKey(42, 'x', false)).toBe(42);
  });
});
