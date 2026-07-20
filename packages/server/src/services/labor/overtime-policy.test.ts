import { describe, expect, it } from 'vitest';
import { resolveOvertimePolicy } from './overtime-policy.js';

describe('overtime policy catalogue', () => {
  it('resolves Colombia weekly and night-window transitions by local date', () => {
    expect(resolveOvertimePolicy('CO', '2026-07-14')).toMatchObject({
      id: 'CO-2025-44H-NIGHT-19',
      weeklyRegularSeconds: 44 * 3_600,
      nightStartMinute: 19 * 60,
    });
    expect(resolveOvertimePolicy('CO', '2026-07-15')).toMatchObject({
      id: 'CO-2026-42H',
      weeklyRegularSeconds: 42 * 3_600,
      nightStartMinute: 19 * 60,
    });
  });

  it('resolves Chile gradual weekly limits', () => {
    expect(resolveOvertimePolicy('CL', '2026-04-25')?.weeklyRegularSeconds).toBe(44 * 3_600);
    expect(resolveOvertimePolicy('CL', '2026-04-26')?.weeklyRegularSeconds).toBe(42 * 3_600);
    expect(resolveOvertimePolicy('CL', '2028-04-26')?.weeklyRegularSeconds).toBe(40 * 3_600);
  });

  it('returns null for countries without a reviewed baseline', () => {
    expect(resolveOvertimePolicy('US', '2026-07-15')).toBeNull();
  });
});
