import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPackagedRecoveryRehearsal } from '../packaged-recovery/run.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const SOURCE_KEY = 'a'.repeat(64);
const DESTINATION_KEY = 'b'.repeat(64);
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));

describe('packaged encrypted recovery rehearsal', () => {
  let scratch: string;

  before(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'puntovivo-packaged-recovery-test-'));
  });

  after(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('restores representative encrypted rows and rejects wrong-key and corrupt bundles', async () => {
    const outputDirectory = join(scratch, 'evidence');
    const temporaryRoot = join(scratch, 'temporary');
    await mkdir(temporaryRoot);
    const { report, reportPath } = await runPackagedRecoveryRehearsal({
      outputDirectory,
      migrationsFolder: join(REPOSITORY_ROOT, 'packages/server/src/db/migrations'),
      appVersion: '1.9.0-test',
      candidateSha: SHA,
      packaged: true,
      electronVersion: '43.4.1-test',
      profile: {
        id: 'test-retail-profile',
        products: 8,
        customers: 10,
        cashSessions: 4,
        sales: 12,
        itemsPerSale: 3,
      },
      sourceEncryptionKey: SOURCE_KEY,
      destinationEncryptionKey: DESTINATION_KEY,
      temporaryRoot,
    });

    assert.equal(report.outcome, 'passed');
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.candidateSha, SHA);
    assert.equal(report.environment.packaged, true);
    assert.equal(report.environment.appVersion, '1.9.0-test');
    assert.ok(report.environment.databaseSchemaVersion > 0);
    assert.deepEqual(report.dataset.counts, {
      products: 8,
      customers: 10,
      cashSessions: 4,
      sales: 12,
      saleItems: 36,
      salePayments: 12,
    });
    assert.equal(report.dataset.totalBusinessRows, 82);
    assert.match(report.dataset.logicalSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(report.recovery.restoredLogicalSha256, report.dataset.logicalSha256);
    assert.equal(report.recovery.wrongKeyRejected, true);
    assert.equal(report.recovery.corruptBundleRejected, true);
    assert.equal(report.recovery.sourceDatabaseUnchanged, true);
    assert.equal(report.recovery.restoredCopyBooted, true);
    assert.ok((report.recovery.recoveryTimeMs ?? -1) >= 0);
    assert.ok((report.recovery.recoveryPointAgeMs ?? -1) >= 0);
    assert.deepEqual(
      report.checks.map(check => [check.id, check.outcome]),
      [
        ['packaged-runtime', 'passed'],
        ['representative-dataset', 'passed'],
        ['encrypted-backup-created', 'passed'],
        ['wrong-key-rejected', 'passed'],
        ['corrupt-bundle-rejected', 'passed'],
        ['correct-key-restored', 'passed'],
        ['restored-copy-booted', 'passed'],
        ['logical-data-preserved', 'passed'],
        ['source-database-unchanged', 'passed'],
      ]
    );

    const serialized = await readFile(reportPath, 'utf8');
    assert.deepEqual(JSON.parse(serialized), report);
    assert.equal(serialized.includes(SOURCE_KEY), false);
    assert.equal(serialized.includes(DESTINATION_KEY), false);
    assert.equal(serialized.includes('packaged-recovery-device'), false);
    assert.equal(serialized.includes(temporaryRoot), false);
    if (process.platform !== 'win32') {
      assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
    }
    assert.deepEqual(await readdir(temporaryRoot), []);
  });
});
