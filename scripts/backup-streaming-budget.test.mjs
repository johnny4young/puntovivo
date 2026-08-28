import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  BACKUP_STREAM_PROFILE_PREFIX,
  compareBackupStreamingProfile,
  parseBackupStreamingMeasurement,
  resolveBackupStreamingProfileOptions,
} from './backup-streaming-budget.mjs';

const budget = JSON.parse(readFileSync(new URL('../perf-budget.json', import.meta.url), 'utf8'));

test('backup streaming profile resolves exact CI and release fixture sizes', () => {
  assert.deepEqual(resolveBackupStreamingProfileOptions({ argv: ['--strict'], budget }), {
    profile: 'ci',
    fixtureMiB: 256,
    strict: true,
  });
  assert.deepEqual(resolveBackupStreamingProfileOptions({ argv: ['--profile=release'], budget }), {
    profile: 'release',
    fixtureMiB: 1024,
    strict: false,
  });
  assert.throws(
    () => resolveBackupStreamingProfileOptions({ argv: ['--profile', 'tiny'], budget }),
    /Expected ci or release/
  );
});

test('backup streaming comparison rejects RSS ceilings and undersized fixtures', () => {
  const contract = budget.operationalProfile.encryptedBackup.streamingProfile;
  assert.deepEqual(
    compareBackupStreamingProfile(
      { fixtureMiB: 256, dbMiB: 256.1, rssGrowthMiB: 95.9, peakRssMiB: 255.9 },
      contract
    ),
    []
  );
  assert.deepEqual(
    compareBackupStreamingProfile(
      { fixtureMiB: 256, dbMiB: 255, rssGrowthMiB: 97, peakRssMiB: 257 },
      contract
    ).map(result => result.metric),
    ['rssGrowthMiB', 'peakRssMiB', 'dbMiB']
  );
});

test('backup streaming measurement parser fails closed on missing or malformed evidence', () => {
  const measurement = { fixtureMiB: 256, peakRssMiB: 100 };
  assert.deepEqual(
    parseBackupStreamingMeasurement(
      `noise\n${BACKUP_STREAM_PROFILE_PREFIX}${JSON.stringify(measurement)}\n`
    ),
    measurement
  );
  assert.equal(parseBackupStreamingMeasurement('no evidence'), null);
  assert.equal(parseBackupStreamingMeasurement(`${BACKUP_STREAM_PROFILE_PREFIX}{bad`), null);
});
