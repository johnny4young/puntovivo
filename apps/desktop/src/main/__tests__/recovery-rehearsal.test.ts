import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
    const { report, reportPath } = await runRecoveryRehearsal({
      outputDirectory,
      encryptionKey: 'a'.repeat(64),
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });

    assert.equal(report.outcome, 'passed');
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
        ['idempotent-second-boot', 'passed'],
        ['downgrade-refused', 'passed'],
      ]
    );

    const serialized = await readFile(reportPath, 'utf8');
    assert.deepEqual(JSON.parse(serialized), report);
    assert.equal(serialized.includes('a'.repeat(64)), false, 'report must not contain DB key');
    assert.equal(
      serialized.includes(tmpdir()),
      false,
      'report must not contain absolute temp paths'
    );
    if (process.platform !== 'win32') {
      assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
    }
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
});
