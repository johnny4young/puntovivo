import { afterEach, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { createBackupBundle, ZIP_MANIFEST_ENTRY } from '../backup/backup-bundle.ts';
import { BackupRestoreDrillError, createBackupRestoreDrill } from '../backup/restore-drill.ts';
import type { BackupScheduleStatus } from '../backup/scheduler.ts';

const ENCRYPTION_KEY = 'd'.repeat(64);
const TABLES = ['products', 'customers', 'sales', 'inventory_movements', 'audit_logs'] as const;
let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'puntovivo-restore-drill-test-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function applySqlCipherKey(db: Database.Database): void {
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${ENCRYPTION_KEY}'"`);
}

function createTenantDatabase(
  path: string,
  tenantCounts: Partial<Record<(typeof TABLES)[number], number>>,
  foreignCount = 2
): Database.Database {
  const db = new Database(path);
  applySqlCipherKey(db);
  for (const table of TABLES) {
    db.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL)`);
    const insert = db.prepare(`INSERT INTO "${table}" (id, tenant_id) VALUES (?, ?)`);
    for (let index = 0; index < (tenantCounts[table] ?? 0); index += 1) {
      insert.run(`${table}-tenant-${index}`, 'tenant-1');
    }
    for (let index = 0; index < foreignCount; index += 1) {
      insert.run(`${table}-foreign-${index}`, 'tenant-2');
    }
  }
  return db;
}

function scheduleStatus(
  lastPath: string | null,
  lastSizeBytes: number | null
): BackupScheduleStatus {
  return {
    tenantId: 'tenant-1',
    frequency: 'daily',
    destinationMode: 'managed',
    destinationDirectory: join(scratch, 'backups'),
    updatedAt: '2026-07-14T12:00:00.000Z',
    nextRunAt: '2026-07-15T12:00:00.000Z',
    lastAttemptAt: '2026-07-14T12:00:00.000Z',
    lastSuccessAt: lastPath ? '2026-07-14T12:00:01.000Z' : null,
    lastPath,
    lastSizeBytes,
    lastError: null,
    inProgress: false,
  };
}

describe('backup restore drill (ENG-136b)', () => {
  it('verifies an encrypted snapshot and compares only the active tenant', async () => {
    const snapshotDbPath = join(scratch, 'snapshot-source.db');
    const snapshotDb = createTenantDatabase(snapshotDbPath, {
      products: 2,
      customers: 1,
      sales: 2,
      inventory_movements: 3,
      audit_logs: 1,
    });
    snapshotDb.close();
    const bundlePath = join(scratch, 'snapshot.zip');
    const bundle = await createBackupBundle({
      dbPath: snapshotDbPath,
      outZipPath: bundlePath,
      encryptionKey: ENCRYPTION_KEY,
      manifest: { tenantSlug: 'tenant-1' },
    });

    const currentDb = createTenantDatabase(join(scratch, 'current.db'), {
      products: 3,
      customers: 2,
      sales: 2,
      inventory_movements: 4,
      audit_logs: 1,
    });
    const stagingRoot = join(scratch, 'staging');
    await mkdir(stagingRoot);
    const lifecycle: string[] = [];
    const drill = createBackupRestoreDrill({
      backupScheduler: {
        getStatus: async tenantId => {
          assert.equal(tenantId, 'tenant-1');
          return scheduleStatus(bundlePath, bundle.zipBytes);
        },
      },
      getCurrentDatabase: () => currentDb,
      resolveDatabaseEncryptionKey: async () => ENCRYPTION_KEY,
      runExclusive: async operation => {
        lifecycle.push('exclusive:start');
        const result = await operation();
        lifecycle.push('exclusive:end');
        return result;
      },
      getTemporaryRoot: () => stagingRoot,
      now: () => new Date('2026-07-14T12:05:00.000Z'),
    });

    try {
      const report = await drill.run('tenant-1');

      assert.equal(report.outcome, 'passed');
      assert.equal(report.checkedAt, '2026-07-14T12:05:00.000Z');
      assert.equal(report.snapshotSizeBytes, bundle.zipBytes);
      assert.equal(report.currentTotal, 12);
      assert.equal(report.snapshotTotal, 9);
      assert.deepEqual(
        report.tables.map(row => [row.table, row.currentCount, row.snapshotCount, row.delta]),
        [
          ['products', 3, 2, 1],
          ['customers', 2, 1, 1],
          ['sales', 2, 2, 0],
          ['inventory_movements', 4, 3, 1],
          ['audit_logs', 1, 1, 0],
        ]
      );
      assert.deepEqual(lifecycle, ['exclusive:start', 'exclusive:end']);
      assert.deepEqual(await readdir(stagingRoot), [], 'ephemeral extraction must be removed');
      assert.equal(
        (currentDb.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number })
          .count,
        5,
        'drill must not mutate current or foreign-tenant rows'
      );
    } finally {
      currentDb.close();
    }
  });

  it('fails closed when no scheduler-owned snapshot exists', async () => {
    const drill = createBackupRestoreDrill({
      backupScheduler: { getStatus: async () => scheduleStatus(null, null) },
      getCurrentDatabase: () => {
        throw new Error('current DB should not be read');
      },
      resolveDatabaseEncryptionKey: async () => ENCRYPTION_KEY,
      runExclusive: operation => operation(),
    });

    await assert.rejects(drill.run('tenant-1'), (error: unknown) => {
      assert.ok(error instanceof BackupRestoreDrillError);
      assert.equal(error.code, 'snapshot_unavailable');
      return true;
    });
  });

  it('rejects a valid snapshot that belongs to another tenant and cleans staging', async () => {
    const snapshotDbPath = join(scratch, 'foreign-source.db');
    const snapshotDb = createTenantDatabase(snapshotDbPath, { products: 1 });
    snapshotDb.close();
    const bundlePath = join(scratch, 'foreign.zip');
    const bundle = await createBackupBundle({
      dbPath: snapshotDbPath,
      outZipPath: bundlePath,
      encryptionKey: ENCRYPTION_KEY,
      manifest: { tenantSlug: 'tenant-2' },
    });
    const stagingRoot = join(scratch, 'staging');
    await mkdir(stagingRoot);
    const drill = createBackupRestoreDrill({
      backupScheduler: {
        getStatus: async () => scheduleStatus(bundlePath, bundle.zipBytes),
      },
      getCurrentDatabase: () => {
        throw new Error('current DB should not be read');
      },
      resolveDatabaseEncryptionKey: async () => ENCRYPTION_KEY,
      runExclusive: operation => operation(),
      getTemporaryRoot: () => stagingRoot,
    });

    await assert.rejects(drill.run('tenant-1'), (error: unknown) => {
      assert.ok(error instanceof BackupRestoreDrillError);
      assert.equal(error.code, 'drill_failed');
      return true;
    });
    assert.deepEqual(await readdir(stagingRoot), []);
  });

  it('rejects an unsupported backup-bundle schema version', async () => {
    const snapshotDbPath = join(scratch, 'future-source.db');
    const snapshotDb = createTenantDatabase(snapshotDbPath, { products: 1 });
    snapshotDb.close();
    const bundlePath = join(scratch, 'future.zip');
    const bundle = await createBackupBundle({
      dbPath: snapshotDbPath,
      outZipPath: bundlePath,
      encryptionKey: ENCRYPTION_KEY,
      manifest: { tenantSlug: 'tenant-1' },
    });
    const zip = await JSZip.loadAsync(await readFile(bundlePath));
    const manifestEntry = zip.file(ZIP_MANIFEST_ENTRY);
    assert.ok(manifestEntry);
    const manifest = JSON.parse(await manifestEntry.async('string')) as Record<string, unknown>;
    zip.file(ZIP_MANIFEST_ENTRY, JSON.stringify({ ...manifest, schemaVersion: 999 }));
    await writeFile(bundlePath, await zip.generateAsync({ type: 'nodebuffer' }));

    const stagingRoot = join(scratch, 'staging');
    await mkdir(stagingRoot);
    const drill = createBackupRestoreDrill({
      backupScheduler: {
        getStatus: async () => scheduleStatus(bundlePath, bundle.zipBytes),
      },
      getCurrentDatabase: () => {
        throw new Error('current DB should not be read');
      },
      resolveDatabaseEncryptionKey: async () => ENCRYPTION_KEY,
      runExclusive: operation => operation(),
      getTemporaryRoot: () => stagingRoot,
    });

    await assert.rejects(drill.run('tenant-1'), (error: unknown) => {
      assert.ok(error instanceof BackupRestoreDrillError);
      assert.equal(error.code, 'drill_failed');
      return true;
    });
    assert.deepEqual(await readdir(stagingRoot), []);
  });
});
