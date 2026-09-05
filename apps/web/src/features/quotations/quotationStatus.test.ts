import { describe, expect, it } from 'vitest';
import { canConvertQuotation } from './quotationStatus';

describe('canConvertQuotation', () => {
  // The rule itself now lives on the server (services/quotations/eligibility)
  // and is covered by quotation-eligibility.test.ts. What matters here is that
  // the client reports the server's verdict rather than recomputing it from
  // the browser clock, which is what made eligibility depend on workstation
  // time in the first place.
  it('reports the server verdict verbatim', () => {
    expect(canConvertQuotation({ convertible: true })).toBe(true);
    expect(canConvertQuotation({ convertible: false })).toBe(false);
  });
});
