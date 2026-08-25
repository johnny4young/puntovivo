import { describe, expect, it } from 'vitest';

import { isValidAccountingDateRange } from './accountingDateRange';

describe('isValidAccountingDateRange', () => {
  it('accepts a complete inclusive range', () => {
    expect(isValidAccountingDateRange('2026-08-01', '2026-08-25')).toBe(true);
    expect(isValidAccountingDateRange('2026-08-25', '2026-08-25')).toBe(true);
  });

  it('rejects reversed, incomplete, malformed, and impossible days', () => {
    expect(isValidAccountingDateRange('2026-08-25', '2026-08-01')).toBe(false);
    expect(isValidAccountingDateRange('', '2026-08-25')).toBe(false);
    expect(isValidAccountingDateRange('08/01/2026', '2026-08-25')).toBe(false);
    expect(isValidAccountingDateRange('2026-02-30', '2026-08-25')).toBe(false);
  });
});
