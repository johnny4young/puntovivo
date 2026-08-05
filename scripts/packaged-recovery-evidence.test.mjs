import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PACKAGED_RECOVERY_MINIMUM_COUNTS,
  REQUIRED_PACKAGED_RECOVERY_CHECKS,
  validatePackagedRecoveryEvidence,
  validatePackagedRecoveryEvidenceEnvelope,
} from './lib/packaged-recovery-evidence.mjs';
import {
  buildPackagedRecoveryLaunchArgs,
  parsePackagedRecoveryArgs,
  runPackagedRecoveryCli,
  waitForExit,
} from './run-packaged-recovery-rehearsal.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const HASH = 'a'.repeat(64);

// runPackagedRecoveryCli reads apps/desktop/package.json to learn which app
// version a candidate must report, so the fixture has to follow that same
// source. Hard-coding the version here made every release bump fail this file
// with an app-version mismatch instead of the behaviour under test.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_VERSION = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps/desktop/package.json'), 'utf8')
).version;

export function packagedRecoveryFixture(overrides = {}) {
  const counts = { ...PACKAGED_RECOVERY_MINIMUM_COUNTS };
  return {
    schemaVersion: 1,
    outcome: 'passed',
    candidateSha: SHA,
    startedAt: '2026-08-01T12:00:00.000Z',
    completedAt: '2026-08-01T12:00:10.000Z',
    environment: {
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      nodeVersion: 'v24.0.0',
      electronVersion: '42.6.2',
      appVersion: APP_VERSION,
      databaseSchemaVersion: 33,
    },
    dataset: {
      profile: 'retail-annual-medium-v1',
      counts,
      totalBusinessRows: Object.values(counts).reduce((sum, value) => sum + value, 0),
      logicalSha256: HASH,
      databaseBytes: 1_000_000,
    },
    recovery: {
      bundleSha256: HASH,
      bundleBytes: 500_000,
      manifestSchemaVersion: 1,
      sourceDatabaseSha256: HASH,
      restoredDatabaseSha256: 'b'.repeat(64),
      restoredLogicalSha256: HASH,
      recoveryPointAgeMs: 10,
      recoveryTimeMs: 900,
      wrongKeyRejected: true,
      corruptBundleRejected: true,
      sourceDatabaseUnchanged: true,
      restoredCopyBooted: true,
    },
    timings: {
      datasetSeedMs: 100,
      backupMs: 100,
      wrongKeyRejectionMs: 50,
      corruptBundleRejectionMs: 50,
      restoreMs: 500,
      restoredBootMs: 400,
      totalMs: 1_200,
    },
    checks: REQUIRED_PACKAGED_RECOVERY_CHECKS.map(id => ({
      id,
      outcome: 'passed',
      detail: 'verified',
    })),
    failureCode: null,
    ...overrides,
  };
}

test('packaged recovery evidence requires the complete release contract', () => {
  const report = packagedRecoveryFixture();
  assert.equal(
    validatePackagedRecoveryEvidence(report, {
      candidateSha: SHA,
      appVersion: APP_VERSION,
      platform: 'darwin',
      architecture: 'arm64',
    }),
    report
  );
});

test('packaged recovery evidence rejects insufficient, unsafe, or failed proof', () => {
  const insufficient = packagedRecoveryFixture();
  insufficient.dataset.counts.sales = 49_999;
  insufficient.dataset.totalBusinessRows = Object.values(insufficient.dataset.counts).reduce(
    (sum, value) => sum + value,
    0
  );
  assert.throws(() => validatePackagedRecoveryEvidence(insufficient), /sales volume/);

  const wrongKeySkipped = packagedRecoveryFixture();
  wrongKeySkipped.recovery.wrongKeyRejected = false;
  assert.throws(() => validatePackagedRecoveryEvidence(wrongKeySkipped), /wrong-key restore/);

  const unknownField = packagedRecoveryFixture({ supportPath: '/tmp/private/report.json' });
  assert.throws(() => validatePackagedRecoveryEvidence(unknownField), /root shape is unsupported/);

  const leakedPath = packagedRecoveryFixture();
  leakedPath.checks[0].detail = '/tmp/private/report.json';
  assert.throws(() => validatePackagedRecoveryEvidence(leakedPath), /local filesystem path/);

  const failedCheck = packagedRecoveryFixture();
  failedCheck.checks = failedCheck.checks.map(check =>
    check.id === 'corrupt-bundle-rejected' ? { ...check, outcome: 'failed' } : check
  );
  assert.throws(() => validatePackagedRecoveryEvidence(failedCheck), /corrupt-bundle-rejected/);
});

test('packaged recovery envelope accepts only bounded sanitized failure evidence', () => {
  const report = packagedRecoveryFixture();
  report.outcome = 'failed';
  report.failureCode = 'RESTORE_FAILED';
  report.checks = [
    { id: 'packaged-runtime', outcome: 'passed', detail: 'electron packaged binary' },
    { id: 'rehearsal-completion', outcome: 'failed', detail: 'Error' },
  ];
  assert.equal(
    validatePackagedRecoveryEvidenceEnvelope(report, {
      candidateSha: SHA,
      appVersion: APP_VERSION,
      platform: 'darwin',
      architecture: 'arm64',
    }),
    report
  );
  report.checks[1].detail = '/tmp/private/source.db';
  assert.throws(() => validatePackagedRecoveryEvidenceEnvelope(report), /local filesystem path/);
});

test('packaged recovery host retains sanitized evidence before a failed exit blocks promotion', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'puntovivo-packaged-recovery-host-test-'));
  const output = path.join(scratch, 'retained-failure.json');
  const report = packagedRecoveryFixture();
  report.outcome = 'failed';
  report.failureCode = 'RESTORE_FAILED';
  report.checks = [
    { id: 'packaged-runtime', outcome: 'passed', detail: 'electron packaged binary' },
    { id: 'rehearsal-completion', outcome: 'failed', detail: 'Error' },
  ];
  const spawnProcess = (_binary, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(async () => {
      try {
        const outputDirectory = args
          .find(argument => argument.startsWith('--recovery-output='))
          .slice('--recovery-output='.length);
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(report));
        child.emit('close', 1, null);
      } catch (error) {
        child.emit('error', error);
      }
    });
    return child;
  };
  try {
    await assert.rejects(
      runPackagedRecoveryCli(
        {
          packagedPath: scratch,
          candidateSha: SHA,
          output,
          timeoutMs: 5_000,
        },
        {
          platform: 'darwin',
          architecture: 'arm64',
          resolveBinary: () => '/fake/puntovivo',
          spawnProcess,
        }
      ),
      /sanitized evidence retained/
    );
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), report);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('packaged recovery timeout waits for child shutdown before rejecting', async () => {
  const child = new EventEmitter();
  let killCount = 0;
  child.kill = () => {
    killCount += 1;
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  await assert.rejects(waitForExit(child, 5), /timed out after 5 ms/);
  assert.equal(killCount, 1);
});

test('packaged recovery host CLI uses explicit immutable and isolated arguments', () => {
  assert.deepEqual(
    parsePackagedRecoveryArgs([
      '--against-packaged',
      'apps/desktop/out-builder',
      '--candidate-sha',
      SHA.toUpperCase(),
      '--output',
      'evidence.json',
    ]),
    {
      packagedPath: 'apps/desktop/out-builder',
      candidateSha: SHA,
      output: 'evidence.json',
      timeoutMs: 900_000,
    }
  );
  assert.throws(
    () =>
      parsePackagedRecoveryArgs([
        '--against-packaged',
        'out',
        '--candidate-sha',
        'main',
        '--output',
        'evidence.json',
      ]),
    /40-character/
  );
  assert.deepEqual(
    buildPackagedRecoveryLaunchArgs({
      outputDirectory: '/tmp/evidence',
      candidateSha: SHA,
      userDataDirectory: '/tmp/user-data',
      platform: 'linux',
    }),
    [
      '--puntovivo-packaged-recovery-rehearsal',
      '--recovery-output=/tmp/evidence',
      `--candidate-sha=${SHA}`,
      '--user-data-dir=/tmp/user-data',
      '--password-store=basic',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ]
  );
});
