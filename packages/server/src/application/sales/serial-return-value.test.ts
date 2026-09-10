import { describe, expect, it } from 'vitest';
import { resolveSerialReturnValue } from './serial-return-value.js';

const original = [
  { id: 'a', costCents: 33 },
  { id: 'b', costCents: 34 },
  { id: 'c', costCents: 33 },
];
const base = () => ({
  original,
  selected: [{ saleItemSerialId: 'b', costCents: 34 }],
  prior: new Map<string, number | null>(),
  inventoryCostCents: 100,
  cogsCostCents: 100,
  priorInventoryValue: 0,
  priorCogsValue: 0,
  originalBaseQuantity: 3,
  priorBaseQuantity: 0,
});

describe('frozen serial return value', () => {
  it('returns the selected identity cost, not the line average', () => {
    expect(resolveSerialReturnValue(base())).toBe(0.34);
    expect(
      resolveSerialReturnValue({
        ...base(),
        selected: [
          { saleItemSerialId: 'a', costCents: 33 },
          { saleItemSerialId: 'c', costCents: 33 },
        ],
        prior: new Map([['b', 34]]),
        priorBaseQuantity: 1,
        priorCogsValue: 0.34,
        priorInventoryValue: 0.34,
      })
    ).toBe(0.66);
  });
  it('retains all-unknown historical line and identity proof without fabricating cents', () => {
    expect(
      resolveSerialReturnValue({
        ...base(),
        original: original.map(row => ({ ...row, costCents: null })),
        selected: [{ saleItemSerialId: 'b', costCents: null }],
        cogsCostCents: null,
        inventoryCostCents: null,
      })
    ).toBeNull();
  });
  it.each([
    { cogsCostCents: 99 },
    { inventoryCostCents: null },
    { original: original.map(row => ({ ...row, costCents: null })) },
    { originalBaseQuantity: 4 },
    { priorBaseQuantity: 1 },
    {
      prior: new Map([['b', 33]]),
      priorBaseQuantity: 1,
      priorCogsValue: 0.33,
      priorInventoryValue: 0.33,
    },
    { prior: new Map<string, number | null>([['b', null]]), priorBaseQuantity: 1 },
    {
      prior: new Map([['b', 34]]),
      priorBaseQuantity: 1,
      priorCogsValue: 0.34,
      priorInventoryValue: 0.33,
    },
  ])('rejects missing or inconsistent line/prior identity evidence %#', changed => {
    expect(() => resolveSerialReturnValue({ ...base(), ...changed })).toThrow();
  });
});
