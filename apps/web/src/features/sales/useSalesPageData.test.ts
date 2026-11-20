import { describe, expect, it } from 'vitest';
import { firstParkedDraft } from './useSalesPageData';

const row = (saleNumber: string, suspendedAt: string | null, total = 1_000) => ({
  saleNumber,
  total,
  suspendedAt,
  suspendedLabel: null,
  restaurantCheckLabel: null,
});

describe('firstParkedDraft', () => {
  it('skips the active resumed draft the list also returns', () => {
    expect(
      firstParkedDraft([row('VTA-1', null, 5_000), row('VTA-2', '2026-11-16T10:00:00Z', 2_500)])
    ).toEqual({ label: 'VTA-2', total: 2_500 });
  });

  it('is empty when the only draft is the active one', () => {
    expect(firstParkedDraft([row('VTA-1', null)])).toBeNull();
    expect(firstParkedDraft(undefined)).toBeNull();
  });

  it('prefers the table, then the parked label', () => {
    const parked = row('VTA-3', '2026-11-16T10:00:00Z');
    expect(firstParkedDraft([{ ...parked, suspendedLabel: 'Ana' }])?.label).toBe('Ana');
    expect(
      firstParkedDraft([{ ...parked, suspendedLabel: 'Ana', restaurantCheckLabel: 'Mesa 4' }])
        ?.label
    ).toBe('Mesa 4');
  });
});
