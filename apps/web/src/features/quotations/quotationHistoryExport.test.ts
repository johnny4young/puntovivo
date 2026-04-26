import { describe, it, expect } from 'vitest';
import type { QuotationListEntry } from '@/types';
import { quotationHistoryExportColumns } from './quotationHistoryExport';

function findColumn(key: string) {
  const col = quotationHistoryExportColumns.find(c => c.key === key);
  if (!col) throw new Error(`Column ${key} not found`);
  return col;
}

const fixtureRow: QuotationListEntry = {} as QuotationListEntry;

describe('quotationHistoryExportColumns', () => {
  it('exposes the expected columns in the documented order', () => {
    expect(quotationHistoryExportColumns.map(c => c.key)).toEqual([
      'quotationNumber',
      'createdAt',
      'customerName',
      'siteName',
      'itemCount',
      'subtotal',
      'taxAmount',
      'total',
      'validUntil',
      'status',
    ]);
  });

  it('quotationNumber, siteName, itemCount, status have no formatter (raw passthrough)', () => {
    for (const key of ['quotationNumber', 'siteName', 'itemCount', 'status']) {
      expect(findColumn(key).formatter).toBeUndefined();
    }
  });

  it('customerName falls back to "Walk-in" when missing or empty', () => {
    const fmt = findColumn('customerName').formatter!;
    expect(fmt('Juan', fixtureRow)).toBe('Juan');
    expect(fmt('', fixtureRow)).toBe('Walk-in');
    expect(fmt(null, fixtureRow)).toBe('Walk-in');
    expect(fmt(undefined, fixtureRow)).toBe('Walk-in');
    expect(fmt(0 as unknown, fixtureRow)).toBe('Walk-in');
  });

  it('subtotal, taxAmount, total format as currency and coerce nullish to 0', () => {
    for (const key of ['subtotal', 'taxAmount', 'total']) {
      const fmt = findColumn(key).formatter!;
      expect(fmt(null, fixtureRow)).toMatch(/0/);
      expect(fmt(undefined, fixtureRow)).toMatch(/0/);
      expect(fmt(2500, fixtureRow)).toMatch(/2[,.]?500|2500/);
    }
  });

  it('validUntil emits the em-dash sentinel when no value is present', () => {
    const fmt = findColumn('validUntil').formatter!;
    expect(fmt(null, fixtureRow)).toBe('—');
    expect(fmt(undefined, fixtureRow)).toBe('—');
    expect(fmt('', fixtureRow)).toBe('—');
    const out = fmt('2026-05-15', fixtureRow);
    expect(typeof out).toBe('string');
    expect(out).not.toBe('—');
    expect(out.length).toBeGreaterThan(0);
  });

  it('createdAt formats every input shape (including missing) as a string', () => {
    const fmt = findColumn('createdAt').formatter!;
    expect(typeof fmt(null, fixtureRow)).toBe('string');
    expect(typeof fmt('2026-04-25T15:30:45', fixtureRow)).toBe('string');
  });
});
