import { describe, it, expect } from 'vitest';
import type { Sale } from '@/types';
import { saleHistoryExportColumns } from './saleHistoryExport';

function findColumn(key: string) {
  const col = saleHistoryExportColumns.find(c => c.key === key);
  if (!col) throw new Error(`Column ${key} not found`);
  return col;
}

const fixtureRow: Sale = {} as Sale;

describe('saleHistoryExportColumns', () => {
  it('exposes the expected columns in the documented order', () => {
    expect(saleHistoryExportColumns.map(c => c.key)).toEqual([
      'saleNumber',
      'createdAt',
      'customerName',
      'subtotal',
      'taxAmount',
      'total',
      'paymentMethod',
      'paymentStatus',
      'status',
    ]);
  });

  it('saleNumber, paymentMethod, paymentStatus, status have no formatter (raw passthrough)', () => {
    for (const key of ['saleNumber', 'paymentMethod', 'paymentStatus', 'status']) {
      expect(findColumn(key).formatter).toBeUndefined();
    }
  });

  it('customerName falls back to "Walk-in" when missing or empty', () => {
    const fmt = findColumn('customerName').formatter!;
    expect(fmt('Ana López', fixtureRow)).toBe('Ana López');
    expect(fmt('', fixtureRow)).toBe('Walk-in');
    expect(fmt(null, fixtureRow)).toBe('Walk-in');
    expect(fmt(undefined, fixtureRow)).toBe('Walk-in');
    expect(fmt(123 as unknown, fixtureRow)).toBe('Walk-in');
  });

  it('subtotal, taxAmount, total format numbers as currency (and coerce nullish to 0)', () => {
    const subtotal = findColumn('subtotal').formatter!;
    const tax = findColumn('taxAmount').formatter!;
    const total = findColumn('total').formatter!;
    expect(subtotal(0, fixtureRow)).toMatch(/0/);
    expect(subtotal(null, fixtureRow)).toMatch(/0/);
    expect(subtotal(undefined, fixtureRow)).toMatch(/0/);
    expect(tax(150, fixtureRow)).toMatch(/150|150\.00/);
    expect(total(94000, fixtureRow)).toMatch(/94\D*000/);
  });

  it('createdAt feeds the value through formatDateTime (handles missing values gracefully)', () => {
    const fmt = findColumn('createdAt').formatter!;
    // Empty / null / undefined should not throw.
    expect(typeof fmt(null, fixtureRow)).toBe('string');
    expect(typeof fmt('', fixtureRow)).toBe('string');
    const out = fmt('2026-04-25T15:30:45', fixtureRow);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
