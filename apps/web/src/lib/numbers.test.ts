import { describe, expect, it } from 'vitest';
import { sumBy } from './numbers';

describe('sumBy', () => {
  it('returns 0 for an empty array', () => {
    expect(sumBy<number>([], () => 1)).toBe(0);
  });

  it('sums a numeric field via selector', () => {
    expect(sumBy([{ n: 1 }, { n: 2 }, { n: 3 }], x => x.n)).toBe(6);
  });

  it('preserves native float arithmetic semantics', () => {
    expect(sumBy([{ n: 1.1 }, { n: 2.2 }], x => x.n)).toBe(1.1 + 2.2);
  });

  it('lets callers keep coercion in the selector', () => {
    expect(
      sumBy([{ a: '5' }, { a: '7.5' }], x => Number(x.a) || 0)
    ).toBe(12.5);
  });

  it('treats coerced NaN-or-falsy via the selector contract', () => {
    expect(
      sumBy([{ a: '' }, { a: 'not-a-number' }, { a: '3' }], x => Number(x.a) || 0)
    ).toBe(3);
  });

  it('iterates a readonly tuple without mutating it', () => {
    const items = [{ n: 10 }, { n: 20 }] as const;
    expect(sumBy(items, x => x.n)).toBe(30);
    expect(items).toEqual([{ n: 10 }, { n: 20 }]);
  });
});
