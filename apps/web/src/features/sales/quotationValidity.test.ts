import { describe, expect, it } from 'vitest';
import { quotationDaysLeft, quotationExpiryLabel } from './quotationValidity';

describe('quotationDaysLeft', () => {
  const zone = 'America/Bogota';
  // 15:48 in Bogotá on 21 November.
  const now = new Date('2026-11-21T20:48:00Z');

  it('counts business days in the tenant time zone, not 24-hour spans', () => {
    expect(quotationDaysLeft('2026-11-26T04:59:59Z', zone, now)).toBe(4);
    expect(quotationDaysLeft('2026-11-22T05:30:00Z', zone, now)).toBe(1);
    // Past midnight UTC but still the 21st in Bogotá.
    expect(quotationDaysLeft('2026-11-22T03:00:00Z', zone, now)).toBe(0);
  });

  it('reads a past day as negative', () => {
    expect(quotationDaysLeft('2026-11-21T04:00:00Z', zone, now)).toBe(-1);
  });

  it('has nothing to say without a valid date', () => {
    expect(quotationDaysLeft(null, zone, now)).toBeNull();
    expect(quotationDaysLeft('not a date', zone, now)).toBeNull();
  });
});

describe('quotationExpiryLabel', () => {
  it('names expired, today and the days left', () => {
    expect(quotationExpiryLabel(-2)).toEqual(['quotationCart.expired']);
    expect(quotationExpiryLabel(0)).toEqual(['quotationCart.expiresToday']);
    expect(quotationExpiryLabel(4)).toEqual(['quotationCart.expiresIn', 4]);
  });
});
