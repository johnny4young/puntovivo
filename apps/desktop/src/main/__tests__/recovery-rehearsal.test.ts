import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRecoveryRehearsal } from '../recovery-rehearsal/run.ts';

describe('encrypted recovery rehearsal', () => {
  let scratch: string;

  before(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'puntovivo-recovery-test-'));
  });

  after(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('upgrades v1.7.0, preserves two tenant graphs, refuses downgrade, and boots twice', async () => {
    const outputDirectory = join(scratch, 'report');
    const temporaryRoot = join(scratch, 'temporary-success');
    await mkdir(temporaryRoot);
    const { report, reportPath } = await runRecoveryRehearsal({
      outputDirectory,
      encryptionKey: 'a'.repeat(64),
      destinationEncryptionKey: 'b'.repeat(64),
      temporaryRoot,
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });

    assert.equal(report.outcome, 'passed');
    assert.equal(report.reportVersion, 2);
    assert.equal(report.sourceVersion, '1.7.0');
    assert.equal(report.sourceMigrationCount, 11);
    assert.ok(report.targetMigrationCount > report.sourceMigrationCount);
    assert.match(report.databaseSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.deepEqual(
      report.checks.map(check => [check.id, check.outcome]),
      [
        ['historical-contract', 'passed'],
        ['historical-encrypted-fixture', 'passed'],
        ['upgrade-preserves-data', 'passed'],
        ['current-schema-ready', 'passed'],
        ['current-domain-sentinels', 'passed'],
        ['idempotent-second-boot', 'passed'],
        ['downgrade-refused', 'passed'],
        ['encrypted-backup-created', 'passed'],
        ['isolated-cross-key-restore', 'passed'],
        ['restored-data-preserved', 'passed'],
      ]
    );
    assert.match(report.backup.bundleSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.ok(report.backup.bundleBytes > 0);
    assert.equal(report.backup.deviceIdentityIncluded, true);
    assert.match(report.restore.databaseSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(report.restore.migrationCount, report.targetMigrationCount);
    assert.equal(report.restore.historicalTableCount, 17);
    assert.equal(report.restore.currentTableCount, 7);
    assert.equal(report.restore.destinationKeyVerified, true);
    assert.equal(report.restore.sourceKeyRejected, true);
    assert.equal(report.restore.deviceIdentityPreserved, true);
    assert.ok(report.timings.backupMs >= 0);
    assert.ok(report.timings.restoreMs >= 0);

    const serialized = await readFile(reportPath, 'utf8');
    assert.deepEqual(JSON.parse(serialized), report);
    assert.equal(serialized.includes('a'.repeat(64)), false, 'report must not contain DB key');
    assert.equal(
      serialized.includes('b'.repeat(64)),
      false,
      'report must not contain destination DB key'
    );
    assert.equal(
      serialized.includes('rehearsal-device-primary'),
      false,
      'report must not contain device identity'
    );
    assert.equal(
      serialized.includes(tmpdir()),
      false,
      'report must not contain absolute temp paths'
    );
    if (process.platform !== 'win32') {
      assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
    }
    assert.deepEqual(await readdir(temporaryRoot), [], 'temporary installation must be removed');
  });

  it('writes a bounded failure report without exposing the underlying secret', async () => {
    const outputDirectory = join(scratch, 'failed-report');
    const { report, reportPath } = await runRecoveryRehearsal({
      outputDirectory,
      encryptionKey: 'deliberately-invalid-secret',
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });

    assert.equal(report.outcome, 'failed');
    assert.equal(report.failureCode, 'HISTORICAL_FIXTURE_FAILED');
    assert.equal(report.checks.at(-1)?.detail, 'Error');
    const serialized = await readFile(reportPath, 'utf8');
    assert.equal(serialized.includes('deliberately-invalid-secret'), false);
    assert.equal(serialized.includes(tmpdir()), false);
  });

  it('bounds an isolated-restore key failure after retaining valid backup evidence', async () => {
    const outputDirectory = join(scratch, 'failed-restore-report');
    const temporaryRoot = join(scratch, 'temporary-restore-failure');
    await mkdir(temporaryRoot);
    const { report, reportPath } = await runRecoveryRehearsal({
      outputDirectory,
      encryptionKey: 'c'.repeat(64),
      destinationEncryptionKey: 'destination-key-must-never-leak',
      temporaryRoot,
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });

    assert.equal(report.outcome, 'failed');
    assert.equal(report.failureCode, 'RESTORE_FAILED');
    assert.ok(report.backup.bundleBytes > 0, 'valid backup evidence must survive restore failure');
    assert.equal(report.restore.destinationKeyVerified, false);
    assert.equal(report.checks.at(-1)?.detail, 'Error');
    const serialized = await readFile(reportPath, 'utf8');
    assert.equal(serialized.includes('c'.repeat(64)), false);
    assert.equal(serialized.includes('destination-key-must-never-leak'), false);
    assert.equal(serialized.includes(tmpdir()), false);
    assert.deepEqual(await readdir(temporaryRoot), [], 'failed restore staging must be removed');
  });
});
