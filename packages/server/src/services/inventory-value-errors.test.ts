import { describe, expect, it } from 'vitest';
import { inventoryValueGuard } from './inventory-value-errors.js';
import { fromInventoryCents } from './inventory-valuation.js';

describe('inventory value error boundary', () => {
  it.each(['INVENTORY_VALUE_INVALID', 'LOT_COST_INVALID'] as const)(
    'maps invalid exact cents to %s without the arithmetic message',
    code => {
      expect(() => inventoryValueGuard(() => fromInventoryCents(0.5), code)).toThrow(
        expect.objectContaining({
          code: 'CONFLICT',
          cause: expect.objectContaining({ errorCode: code }),
        })
      );
      try {
        inventoryValueGuard(() => fromInventoryCents(0.5), code);
      } catch (error) {
        expect((error as Error).message).not.toContain('Invalid inventory cents');
      }
    }
  );
  it('does not mask unrelated transaction failures', () => {
    const failure = new Error('injected SQL failure');
    expect(() =>
      inventoryValueGuard(() => {
        throw failure;
      })
    ).toThrow(failure);
  });
  it('returns the unchanged valid value', () => {
    expect(inventoryValueGuard(() => fromInventoryCents(67))).toBe(0.67);
  });
});
