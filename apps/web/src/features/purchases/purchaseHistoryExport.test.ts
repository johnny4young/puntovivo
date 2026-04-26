import { describe, it, expect } from 'vitest';
import type { Purchase } from '@/types';
import { purchaseHistoryExportColumns } from './purchaseHistoryExport';

function findColumn(key: string) {
  const col = purchaseHistoryExportColumns.find(c => c.key === key);
  if (!col) throw new Error(`Column ${key} not found`);
  return col;
}

const fixtureRow: Purchase = {} as Purchase;

describe('purchaseHistoryExportColumns', () => {
  it('exposes the expected columns in the documented order', () => {
    expect(purchaseHistoryExportColumns.map(c => c.key)).toEqual([
      'purchaseNumber',
      'status',
      'createdAt',
      'providerName',
      'siteName',
      'subtotal',
      'total',
      'returnedAmount',
      'returnedAt',
      'latestReturnReason',
      'latestReturnCreatedByName',
      'notes',
    ]);
  });

  it('status replaces underscores with spaces (e.g. "partially_returned" → "partially returned")', () => {
    const fmt = findColumn('status').formatter!;
    expect(fmt('partially_returned', fixtureRow)).toBe('partially returned');
    expect(fmt('completed', fixtureRow)).toBe('completed');
    expect(fmt(null, fixtureRow)).toBe('');
    expect(fmt(undefined, fixtureRow)).toBe('');
  });

  it('providerName / siteName fall back to "-" when missing or empty', () => {
    for (const key of ['providerName', 'siteName']) {
      const fmt = findColumn(key).formatter!;
      expect(fmt('Provider X', fixtureRow)).toBe('Provider X');
      expect(fmt('', fixtureRow)).toBe('-');
      expect(fmt(null, fixtureRow)).toBe('-');
      expect(fmt(undefined, fixtureRow)).toBe('-');
      expect(fmt(42 as unknown, fixtureRow)).toBe('-');
    }
  });

  it('subtotal, total, returnedAmount format as currency and coerce nullish to 0', () => {
    for (const key of ['subtotal', 'total', 'returnedAmount']) {
      const fmt = findColumn(key).formatter!;
      const zero = fmt(null, fixtureRow);
      expect(zero).toMatch(/0/);
      expect(fmt(undefined, fixtureRow)).toBe(zero);
      expect(fmt(1500, fixtureRow)).toMatch(/1[,.]?500|1500/);
    }
  });

  it('returnedAt formats only when a value is present (otherwise emits "-")', () => {
    const fmt = findColumn('returnedAt').formatter!;
    expect(fmt(null, fixtureRow)).toBe('-');
    expect(fmt(undefined, fixtureRow)).toBe('-');
    expect(fmt('', fixtureRow)).toBe('-');
    const out = fmt('2026-04-25T12:00:00', fixtureRow);
    expect(typeof out).toBe('string');
    expect(out).not.toBe('-');
    expect(out.length).toBeGreaterThan(0);
  });

  it('latestReturnReason / latestReturnCreatedByName / notes fall back to "-" when missing or empty', () => {
    for (const key of ['latestReturnReason', 'latestReturnCreatedByName', 'notes']) {
      const fmt = findColumn(key).formatter!;
      expect(fmt('something', fixtureRow)).toBe('something');
      expect(fmt('', fixtureRow)).toBe('-');
      expect(fmt(null, fixtureRow)).toBe('-');
      expect(fmt(undefined, fixtureRow)).toBe('-');
    }
  });
});
