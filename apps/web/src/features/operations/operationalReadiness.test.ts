import { describe, expect, it } from 'vitest';

import {
  evaluateBackupSignal,
  evaluateServerSignal,
  evaluateUpdateSignal,
} from './operationalReadiness';

const NOW = Date.parse('2026-07-21T18:00:00.000Z');

describe('operational readiness signal evaluation', () => {
  it('maps server danger, warning, all-clear, and unavailable states', () => {
    const areas = [
      { area: 'sync' as const, severity: 'warning' as const, count: 26 },
      { area: 'fiscal' as const, severity: 'danger' as const, count: 2 },
    ];
    expect(evaluateServerSignal('sync', areas, 'ready')).toMatchObject({ status: 'watch' });
    expect(evaluateServerSignal('fiscal', areas, 'ready')).toMatchObject({
      status: 'action_required',
      count: 2,
    });
    expect(evaluateServerSignal('payments', areas, 'ready')).toMatchObject({
      status: 'healthy',
    });
    expect(evaluateServerSignal('device', undefined, 'error')).toMatchObject({
      status: 'unavailable',
    });
  });

  it('requires an enabled, fresh, successful backup for a healthy signal', () => {
    const base = {
      tenantId: 'tenant-1',
      frequency: 'daily' as const,
      destinationMode: 'managed' as const,
      destinationDirectory: '/backup',
      updatedAt: '2026-07-20T18:00:00.000Z',
      nextRunAt: null,
      lastAttemptAt: '2026-07-21T17:00:00.000Z',
      lastSuccessAt: '2026-07-21T17:00:00.000Z',
      lastPath: '/backup/latest.zip',
      lastSizeBytes: 1024,
      lastError: null,
      inProgress: false,
    };
    const options = {
      supported: true,
      isAdmin: true,
      failed: false,
      loading: false,
      maximumAgeHours: 30,
      nowMs: NOW,
    };

    expect(evaluateBackupSignal(base, options).status).toBe('healthy');
    expect(evaluateBackupSignal({ ...base, frequency: 'off' }, options).status).toBe(
      'action_required'
    );
    expect(
      evaluateBackupSignal({ ...base, lastSuccessAt: '2026-07-19T00:00:00.000Z' }, options).status
    ).toBe('action_required');
    expect(
      evaluateBackupSignal({ ...base, lastSuccessAt: '2026-07-21T19:00:00.000Z' }, options).status
    ).toBe('action_required');
    expect(evaluateBackupSignal(base, { ...options, isAdmin: false }).observation).toBe(
      'adminOwned'
    );
  });

  it('surfaces updater failures and stale checks without treating web as healthy', () => {
    const base = {
      isAvailable: true,
      state: 'idle' as const,
      currentVersion: '1.5.1',
      lastCheckedAt: '2026-07-21T17:00:00.000Z',
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      updateUrl: null,
      error: null,
      reason: null,
    };
    const options = {
      supported: true,
      failed: false,
      loading: false,
      maximumAgeHours: 24,
      nowMs: NOW,
    };

    expect(evaluateUpdateSignal(base, options).status).toBe('healthy');
    expect(evaluateUpdateSignal({ ...base, state: 'error' }, options).status).toBe(
      'action_required'
    );
    expect(
      evaluateUpdateSignal({ ...base, lastCheckedAt: '2026-07-19T00:00:00.000Z' }, options).status
    ).toBe('watch');
    expect(
      evaluateUpdateSignal({ ...base, lastCheckedAt: '2026-07-21T19:00:00.000Z' }, options).status
    ).toBe('watch');
    expect(evaluateUpdateSignal(undefined, { ...options, supported: false }).status).toBe(
      'unavailable'
    );
  });
});
