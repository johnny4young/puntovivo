import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SaleCartItem } from '@/features/sales/saleCart';
import { nextReadKey, useLastRead } from './useLastRead';

function line(key: string, quantity: number, overrides?: Partial<SaleCartItem>): SaleCartItem {
  return {
    key,
    productId: key,
    productName: `Product ${key}`,
    productSku: key.toUpperCase(),
    unitId: 'unit-1',
    unitName: 'Unit',
    unitEquivalence: 1,
    quantity,
    unitPrice: 6800,
    discount: 0,
    taxRate: 19,
    availableStock: 15,
    sellByFraction: false,
    ...overrides,
  };
}

describe('nextReadKey', () => {
  it('reads the new line', () => {
    expect(nextReadKey([line('a', 1)], [line('a', 1), line('b', 1)], 'a')).toBe('b');
  });

  it('reads the line whose quantity grew', () => {
    expect(nextReadKey([line('a', 1), line('b', 1)], [line('a', 2), line('b', 1)], 'b')).toBe('a');
  });

  it('keeps the read through edits to other lines', () => {
    expect(nextReadKey([line('a', 3), line('b', 1)], [line('a', 2), line('b', 1)], 'b')).toBe('b');
    expect(nextReadKey([line('a', 1), line('b', 1)], [line('b', 1)], 'b')).toBe('b');
  });

  it('clears the read when its line is undone or removed', () => {
    expect(nextReadKey([line('a', 2)], [line('a', 1)], 'a')).toBeNull();
    expect(nextReadKey([line('a', 1), line('b', 1)], [line('a', 1)], 'b')).toBeNull();
  });
});

describe('useLastRead', () => {
  it('follows adds, repeat scans and undo on one ticket', () => {
    const { result, rerender } = renderHook(
      ({ items, ticket }: { items: SaleCartItem[]; ticket: string }) => useLastRead(items, ticket),
      { initialProps: { items: [] as SaleCartItem[], ticket: 't1' } }
    );
    expect(result.current).toBeNull();

    rerender({ items: [line('a', 1)], ticket: 't1' });
    expect(result.current).toMatchObject({ key: 'a', productName: 'Product a', remaining: 14 });

    rerender({ items: [line('a', 2)], ticket: 't1' });
    expect(result.current).toMatchObject({ key: 'a', quantity: 2, remaining: 13 });

    rerender({ items: [line('a', 1)], ticket: 't1' });
    expect(result.current).toBeNull();
  });

  it('ignores a fresh array with the same lines', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: SaleCartItem[] }) => useLastRead(items, 't1'),
      { initialProps: { items: [] as SaleCartItem[] } }
    );
    rerender({ items: [line('a', 1)] });
    rerender({ items: [line('a', 1)] });
    expect(result.current?.key).toBe('a');
  });

  it('starts clean on another ticket', () => {
    const { result, rerender } = renderHook(
      ({ items, ticket }: { items: SaleCartItem[]; ticket: string }) => useLastRead(items, ticket),
      { initialProps: { items: [] as SaleCartItem[], ticket: 't1' } }
    );
    rerender({ items: [line('a', 1)], ticket: 't1' });
    rerender({ items: [line('b', 4)], ticket: 't2' });
    expect(result.current).toBeNull();
  });

  it('counts what is left in base units and never below zero', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: SaleCartItem[] }) => useLastRead(items, 't1'),
      { initialProps: { items: [] as SaleCartItem[] } }
    );
    rerender({ items: [line('box', 2, { unitEquivalence: 6, availableStock: 20 })] });
    expect(result.current?.remaining).toBe(8);

    rerender({ items: [line('box', 4, { unitEquivalence: 6, availableStock: 20 })] });
    expect(result.current?.remaining).toBe(0);
  });

  it('counts every line of the same product against its stock', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: SaleCartItem[] }) => useLastRead(items, 't1'),
      { initialProps: { items: [] as SaleCartItem[] } }
    );
    const box = line('box', 1, { productId: 'p', unitEquivalence: 6, availableStock: 20 });
    rerender({ items: [box] });
    rerender({ items: [box, line('unit', 3, { productId: 'p', availableStock: 20 })] });
    expect(result.current).toMatchObject({ key: 'unit', remaining: 11 });
  });

  it('reports no stock for a service line', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: SaleCartItem[] }) => useLastRead(items, 't1'),
      { initialProps: { items: [] as SaleCartItem[] } }
    );
    rerender({ items: [line('svc', 1, { tracksStock: false })] });
    expect(result.current?.remaining).toBeNull();
  });
});
