import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { AutoUpdateStatus } from '../auto-updater/contracts.ts';
import { resolveTrayUpdatePresentation } from '../auto-updater/tray-presentation.ts';

const STATUS: AutoUpdateStatus = {
  isAvailable: true,
  state: 'idle',
  installMode: 'auto',
  currentVersion: '1.11.0',
  lastCheckedAt: null,
  lastUpdatedAt: null,
  downloadedVersion: null,
  downloadedAt: null,
  installReady: false,
  updateFloorVersion: '1.11.0',
  rolloutMode: null,
  rolloutPercentage: null,
  rolloutTargetVersion: null,
  rolloutPolicyCheckedAt: null,
  releaseName: null,
  releaseNotes: null,
  releaseDate: null,
  updateUrl: null,
  error: null,
  reason: null,
};

describe('updater tray presentation', () => {
  it('shows no badge before a completed download', () => {
    assert.equal(resolveTrayUpdatePresentation(STATUS), null);
  });

  it('badges persisted downloads but disables restart until reconfirmed', () => {
    assert.deepEqual(resolveTrayUpdatePresentation({ ...STATUS, state: 'downloaded' }), {
      badge: true,
      action: 'verification-pending',
      actionEnabled: false,
    });
    assert.deepEqual(
      resolveTrayUpdatePresentation({ ...STATUS, state: 'downloaded', installReady: true }),
      { badge: true, action: 'restart', actionEnabled: true }
    );
  });
});
