/**
 * Conversion eligibility moved from the browser to the server so a
 * workstation's clock skew can no longer decide whether an operator is
 * offered a conversion. These cases are the ones the client test used to
 * own, plus the calendar-validity case the strict parser now catches.
 */

import { describe, expect, it } from 'vitest';
import { isQuotationConvertibleAt } from '../services/quotations/eligibility.js';

describe('isQuotationConvertibleAt', () => {
  it('compares instants instead of ISO text when offsets differ', () => {
    expect(
      isQuotationConvertibleAt(
        { status: 'accepted', validUntil: '2026-09-01T01:00:00-05:00' },
        '2026-09-01T05:30:00.000Z'
      )
    ).toBe(true);
  });

  it('fails closed for invalid or elapsed validity timestamps', () => {
    expect(
      isQuotationConvertibleAt(
        { status: 'accepted', validUntil: 'invalid' },
        '2026-09-01T05:30:00.000Z'
      )
    ).toBe(false);
    expect(
      isQuotationConvertibleAt(
        { status: 'accepted', validUntil: '2026-09-01T01:00:00-05:00' },
        '2026-09-01T06:30:00.000Z'
      )
    ).toBe(false);
  });

  it('fails closed on a calendar date that does not exist', () => {
    // Date.parse rolls 2026-02-30 forward to March 2nd, which would have
    // silently extended the validity window by two days.
    expect(
      isQuotationConvertibleAt(
        { status: 'accepted', validUntil: '2026-02-30' },
        '2026-03-01T00:00:00.000Z'
      )
    ).toBe(false);
  });

  it('only an accepted quotation is convertible', () => {
    for (const status of ['draft', 'sent', 'rejected', 'expired', 'converted']) {
      expect(
        isQuotationConvertibleAt({ status, validUntil: null }, '2026-09-01T00:00:00.000Z')
      ).toBe(false);
    }
    expect(
      isQuotationConvertibleAt({ status: 'accepted', validUntil: null }, '2026-09-01T00:00:00.000Z')
    ).toBe(true);
  });

  it('the validity boundary is inclusive', () => {
    const at = '2026-09-01T05:30:00.000Z';
    expect(isQuotationConvertibleAt({ status: 'accepted', validUntil: at }, at)).toBe(true);
  });
});
