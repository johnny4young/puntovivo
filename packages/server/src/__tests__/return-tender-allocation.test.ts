import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocateReturnTenderCents } from '../application/sales/return-tender-allocation.js';

describe('partial-return tender cents', () => {
  it('never withdraws a cent already refunded by the earlier allocation rule', () => {
    expect(allocateReturnTenderCents(1, [1, 1, 1])).toEqual([0, 1, 0]);
    expect(allocateReturnTenderCents(1, [1, 0, 1])).toEqual([1, 0, 0]);
    expect(allocateReturnTenderCents(1, [0, 0, 1])).toEqual([0, 0, 1]);
  });

  it('keeps proportional half-away-from-zero boundaries without float products', () => {
    expect(allocateReturnTenderCents(5, [4, 6])).toEqual([2, 3]);
    expect(allocateReturnTenderCents(1, [1, 1])).toEqual([1, 0]);
    expect(allocateReturnTenderCents(0, [0, 0])).toEqual([0, 0]);
    expect(allocateReturnTenderCents(0, [])).toEqual([]);
    const max = Number.MAX_SAFE_INTEGER;
    expect(allocateReturnTenderCents(max - 1, [max - 1, 1])).toEqual([max - 2, 1]);
  });

  it('rejects invalid, overdrawn and unsafe balances instead of dropping cents', () => {
    for (const invalid of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(allocateReturnTenderCents(invalid, [1])).toBeNull();
      expect(allocateReturnTenderCents(0, [invalid])).toBeNull();
    }
    expect(allocateReturnTenderCents(1, [])).toBeNull();
    expect(allocateReturnTenderCents(3, [1, 1])).toBeNull();
    expect(allocateReturnTenderCents(1, [Number.MAX_SAFE_INTEGER, 1])).toBeNull();
  });

  it('conserves arbitrary partial refunds, never exceeds a source and exhausts exactly', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100_000_000 }), { minLength: 1, maxLength: 12 }),
        fc.array(fc.nat(), { maxLength: 30 }),
        (original, partitions) => {
          let remaining = [...original];
          const refunded = original.map(() => 0);
          for (const partition of [...partitions, -1]) {
            const total = remaining.reduce((sum, cents) => sum + cents, 0);
            const requested = partition === -1 ? total : partition % (total + 1);
            const allocated = allocateReturnTenderCents(requested, remaining);
            expect(allocated).not.toBeNull();
            expect(allocated).toEqual(allocateReturnTenderCents(requested, remaining));
            expect(allocated!.reduce((sum, cents) => sum + cents, 0)).toBe(requested);
            remaining = remaining.map((capacity, index) => {
              const amount = allocated![index]!;
              expect(Number.isSafeInteger(amount)).toBe(true);
              expect(amount).toBeGreaterThanOrEqual(0);
              expect(amount).toBeLessThanOrEqual(capacity);
              refunded[index] = refunded[index]! + amount;
              return capacity - amount;
            });
          }
          expect(remaining).toEqual(original.map(() => 0));
          expect(refunded).toEqual(original);
        }
      ),
      { numRuns: 1000, seed: 218 }
    );
  });
});
