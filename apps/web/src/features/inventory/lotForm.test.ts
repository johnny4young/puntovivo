import { describe, expect, it } from 'vitest';
import {
  createLotReceiptDraft,
  formatLotExpiryDate,
  haveSameExactLotOptions,
  isExactLotAllocationValid,
  isLotExpiredAt,
  normalizeExactLotAllocations,
  normalizeLotReceipts,
  quantitiesMatch,
  sumExactLotAllocations,
  sumLotReceiptQuantity,
} from './lotForm';

describe('lot form normalization', () => {
  it('normalizes distinct receipt identities and preserves base-unit precision', () => {
    const rows = [
      createLotReceiptDraft({
        lotNumber: ' LOT-A ',
        expiresAt: '2027-01-31',
        baseQuantity: '0.375',
      }),
      createLotReceiptDraft({ lotNumber: 'LOT-B', baseQuantity: '1.125', notes: ' cold ' }),
    ];

    expect(sumLotReceiptQuantity(rows)).toBe(1.5);
    expect(normalizeLotReceipts(rows)).toEqual([
      { lotNumber: 'LOT-A', expiresAt: '2027-01-31', baseQuantity: 0.375 },
      { lotNumber: 'LOT-B', baseQuantity: 1.125, notes: 'cold' },
    ]);
  });

  it('rejects duplicate identities, invalid quantities and allocation overflow', () => {
    expect(
      normalizeLotReceipts([
        createLotReceiptDraft({ lotNumber: 'Batch', baseQuantity: '1' }),
        createLotReceiptDraft({ lotNumber: ' batch ', baseQuantity: '2' }),
      ])
    ).toBeNull();

    const options = [
      { id: 'lot-a', lotNumber: 'A', availableQuantity: 2 },
      { id: 'lot-b', lotNumber: 'B', availableQuantity: 1 },
    ];
    expect(normalizeExactLotAllocations(options, { 'lot-a': '2.001' })).toBeNull();
    expect(isExactLotAllocationValid(options, { 'lot-a': '1.5', 'lot-b': '0.5' }, 2)).toBe(true);
    expect(sumExactLotAllocations({ 'lot-a': '1.5', 'lot-b': '-4' })).toBe(1.5);
    expect(quantitiesMatch(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('formats a date-only expiry without shifting it through the local timezone', () => {
    expect(formatLotExpiryDate('2026-08-31', 'en-US')).toBe('Aug 31, 2026');
    expect(formatLotExpiryDate('2026-08-31T12:00:00.000Z', 'en-US')).toBe('Aug 31, 2026');
  });

  it('keeps expiry and option equality fail-closed at the allocation boundary', () => {
    const now = Date.parse('2026-09-01T12:00:00.000Z');
    expect(isLotExpiredAt('2026-08-31', now)).toBe(true);
    expect(isLotExpiredAt('2026-09-01', now)).toBe(false);
    expect(isLotExpiredAt('not-a-date', now)).toBe(true);

    const options = [
      {
        id: 'lot-a',
        lotNumber: 'A',
        expiresAt: '2027-01-01',
        status: 'active',
        availableQuantity: 2,
      },
    ];
    expect(haveSameExactLotOptions(options, [...options])).toBe(true);
    expect(haveSameExactLotOptions(options, [{ ...options[0]!, availableQuantity: 1 }])).toBe(
      false
    );
  });
});
