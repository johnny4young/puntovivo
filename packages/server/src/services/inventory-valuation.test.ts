import { describe, expect, it } from 'vitest';
import {
  allocateInventoryValue,
  partitionInventoryValue,
  addInventoryValues,
  legacyInventoryValue,
} from './inventory-valuation.js';

describe('inventory carrying-value arithmetic', () => {
  it('retains the cent lost by a rounded unit cost over chained fractional debits', () => {
    const first = allocateInventoryValue(1, 3.001, 1.001);
    expect(first).toEqual({ consumedValue: 0.33, remainingValue: 0.67 });
    const final = allocateInventoryValue(first.remainingValue, 2, 2);
    expect(final).toEqual({ consumedValue: 0.67, remainingValue: 0 });
    expect(addInventoryValues(first.consumedValue, final.consumedValue)).toBe(1);
  });

  it('preserves values smaller than a rounded per-unit price', () => {
    expect(allocateInventoryValue(0.01, 3, 1)).toEqual({ consumedValue: 0, remainingValue: 0.01 });
    expect(allocateInventoryValue(0.01, 2, 1)).toEqual({ consumedValue: 0.01, remainingValue: 0 });
    expect(allocateInventoryValue(0, 1, 1)).toEqual({ consumedValue: 0, remainingValue: 0 });
  });

  it('uses half-away-from-zero cents without changing the stored quantity precision', () => {
    expect(allocateInventoryValue(0.01, 0.002, 0.001)).toEqual({
      consumedValue: 0.01,
      remainingValue: 0,
    });
    expect(allocateInventoryValue(-0.01, 0.002, 0.001)).toEqual({
      consumedValue: -0.01,
      remainingValue: 0,
    });
    expect(allocateInventoryValue(1, 0.000000000002, 0.000000000001)).toEqual({
      consumedValue: 0.5,
      remainingValue: 0.5,
    });
  });

  it('conserves every cent across deterministic partition/property cases', () => {
    for (let seed = 1; seed <= 500; seed++) {
      let quantity = seed * 7 + 11;
      let value = ((seed * 31) % 9991) / 100;
      const original = value;
      let consumed = 0;
      while (quantity > 0) {
        const part = Math.min(quantity, ((seed * quantity) % 97) + 1);
        const allocation = allocateInventoryValue(value, quantity / 1000, part / 1000);
        expect(addInventoryValues(allocation.consumedValue, allocation.remainingValue)).toBe(value);
        expect(allocation.remainingValue).toBeGreaterThanOrEqual(0);
        consumed = addInventoryValues(consumed, allocation.consumedValue);
        value = allocation.remainingValue;
        quantity -= part;
      }
      expect(value).toBe(0);
      expect(consumed).toBe(original);
    }
  });

  it('uses exact integer ratios for large finite quantities too', () => {
    expect(allocateInventoryValue(100, 1e25, 1e24)).toEqual({
      consumedValue: 10,
      remainingValue: 90,
    });
    expect(allocateInventoryValue(10, 1e-10, 5e-11)).toEqual({
      consumedValue: 5,
      remainingValue: 5,
    });
  });

  it.each([
    [NaN, 1, 1],
    [Infinity, 1, 1],
    [0.001, 1, 1],
    [1, 0, 0],
    [1, 1, 2],
    [1, 1, -1],
    [1, Infinity, 1],
    [1, 1, NaN],
  ])(
    'rejects invalid or silently rounded value inputs (%s,%s,%s)',
    (value, available, consumed) => {
      expect(() => allocateInventoryValue(value, available, consumed)).toThrow(RangeError);
    }
  );

  it('preserves legacy adoption but rejects cent overflow', () => {
    expect(legacyInventoryValue(0.125, 1)).toBe(0.13);
    expect(addInventoryValues(0.1, 0.2, -0.3)).toBe(0);
    expect(() => addInventoryValues(90_000_000_000_000, 90_000_000_000_000)).toThrow(RangeError);
    expect(() => legacyInventoryValue(Infinity, 1)).toThrow(RangeError);
  });
  it('partitions receipt cents without independently rounding each identity', () => {
    expect(partitionInventoryValue(0.01, [0.005, 0.005])).toEqual([0.01, 0]);
    expect(partitionInventoryValue(1, [1, 1, 1])).toEqual([0.33, 0.34, 0.33]);
    expect(partitionInventoryValue(0, [])).toEqual([]);
    for (let count = 1; count <= 100; count++) {
      const total = count / 100;
      expect(
        addInventoryValues(
          ...partitionInventoryValue(
            total,
            Array.from({ length: count }, (_, i) => (i + 1) / 1000)
          )
        )
      ).toBe(total);
    }
    expect(() => partitionInventoryValue(1, [])).toThrow(RangeError);
    expect(() => partitionInventoryValue(1, [0])).toThrow(RangeError);
    expect(() => partitionInventoryValue(-1, [1])).toThrow(RangeError);
  });
});
