import { describe, expect, it } from 'vitest';
import { canConvertQuotation } from './quotationStatus';

describe('canConvertQuotation', () => {
  it('compares instants instead of ISO text when offsets differ', () => {
    expect(
      canConvertQuotation(
        { status: 'accepted', validUntil: '2026-09-01T01:00:00-05:00' },
        '2026-09-01T05:30:00.000Z'
      )
    ).toBe(true);
  });

  it('fails closed for invalid or elapsed validity timestamps', () => {
    expect(
      canConvertQuotation({ status: 'accepted', validUntil: 'invalid' }, '2026-09-01T05:30:00.000Z')
    ).toBe(false);
    expect(
      canConvertQuotation(
        { status: 'accepted', validUntil: '2026-09-01T01:00:00-05:00' },
        '2026-09-01T06:30:00.000Z'
      )
    ).toBe(false);
  });
});
