import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import JSZip from 'jszip';
import { createServer, type DatabaseInstance, type PuntovivoServer } from '@puntovivo/server';
import {
  assertSqliteIntegrity,
  BACKUP_BUNDLE_SCHEMA_VERSION,
  createBackupBundle,
  extractBackupBundle,
  isCleartextSqliteFile,
  rekeySqliteDatabase,
  ZIP_DB_ENTRY,
} from '../backup/backup-bundle.ts';
import { countAppliedMigrations, sha256File } from '../recovery-rehearsal/fingerprint.ts';
import {
  assertDatasetCounts,
  expectedDatasetCounts,
  fingerprintPackagedRecoveryDataset,
  inspectPackagedRecoveryDataset,
  PACKAGED_RECOVERY_PROFILE,
  seedPackagedRecoveryDataset,
  type PackagedRecoveryDatasetCounts,
  type PackagedRecoveryProfile,
} from './profile.ts';
import {
  roundMilliseconds,
  writePackagedRecoveryReport,
  type PackagedRecoveryCheck,
  type PackagedRecoveryReport,
} from './report.ts';

interface LiveDatabase extends DatabaseInstance {
  $client: Database.Database;
}

export interface RunPackagedRecoveryOptions {
  outputDirectory: string;
  migrationsFolder: string;
  appVersion: string;
  candidateSha: string;
  packaged: true;
  electronVersion: string;
  profile?: PackagedRecoveryProfile;
  temporaryRoot?: string;
  sourceEncryptionKey?: string;
  destinationEncryptionKey?: string;
  now?: () => Date;
}

export interface RunPackagedRecoveryResult {
  report: PackagedRecoveryReport;
  reportPath: string;
}

async function assertKeyRejected(dbPath: string, encryptionKey: string): Promise<void> {
  try {
    await assertSqliteIntegrity(dbPath, { encryptionKey });
  } catch {
    return;
  }
  throw new Error('rejected database key unexpectedly opened the encrypted database');
}

async function writeCorruptedBundle(sourcePath: string, destinationPath: string): Promise<void> {
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  const dbEntry = zip.file(ZIP_DB_ENTRY);
  if (!dbEntry) throw new Error('valid backup is missing its database entry');
  const dbBytes = await dbEntry.async('nodebuffer');
  const truncatedLength = Math.max(256, Math.floor(dbBytes.byteLength / 3));
  zip.file(ZIP_DB_ENTRY, dbBytes.subarray(0, truncatedLength));
  await writeFile(destinationPath, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function assertCorruptedBundleRejected(
  bundlePath: string,
  extractionDirectory: string,
  encryptionKey: string
): Promise<void> {
  const extracted = await extractBackupBundle(bundlePath, extractionDirectory);
  let rejected = false;
  try {
    await assertSqliteIntegrity(extracted.dbPath, { encryptionKey });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('corrupted backup unexpectedly passed integrity verification');
}

function totalBusinessRows(counts: PackagedRecoveryDatasetCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

export async function runPackagedRecoveryRehearsal(
  options: RunPackagedRecoveryOptions
): Promise<RunPackagedRecoveryResult> {
  const profile = options.profile ?? PACKAGED_RECOVERY_PROFILE;
  const expectedCounts = expectedDatasetCounts(profile);
  const sourceKey = options.sourceEncryptionKey ?? randomBytes(32).toString('hex');
  const destinationKey = options.destinationEncryptionKey ?? randomBytes(32).toString('hex');
  if (sourceKey === destinationKey) {
    throw new Error('packaged recovery source and destination keys must differ');
  }
  let wrongKey = randomBytes(32).toString('hex');
  while (wrongKey === sourceKey || wrongKey === destinationKey) {
    wrongKey = randomBytes(32).toString('hex');
  }
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const totalStarted = performance.now();
  const scratch = await mkdtemp(
    join(options.temporaryRoot ?? tmpdir(), 'puntovivo-packaged-recovery-')
  );
  const sourceDbPath = join(scratch, 'source.db');
  const deviceIdPath = join(scratch, 'device-id.txt');
  const bundlePath = join(scratch, 'recovery.zip');
  const corruptBundlePath = join(scratch, 'recovery-corrupt.zip');
  const checks: PackagedRecoveryCheck[] = [
    { id: 'packaged-runtime', outcome: 'passed', detail: 'electron packaged binary' },
  ];
  const timings = {
    datasetSeedMs: 0,
    backupMs: 0,
    wrongKeyRejectionMs: 0,
    corruptBundleRejectionMs: 0,
    restoreMs: 0,
    restoredBootMs: 0,
    totalMs: 0,
  };
  let migrationCount = 0;
  let datasetCounts: PackagedRecoveryDatasetCounts = {
    products: 0,
    customers: 0,
    cashSessions: 0,
    sales: 0,
    saleItems: 0,
    salePayments: 0,
  };
  let logicalSha256: string | null = null;
  let databaseBytes = 0;
  let bundleSha256: string | null = null;
  let bundleBytes = 0;
  let manifestSchemaVersion: number | null = null;
  let sourceDatabaseSha256: string | null = null;
  let restoredDatabaseSha256: string | null = null;
  let restoredLogicalSha256: string | null = null;
  let recoveryPointAgeMs: number | null = null;
  let recoveryTimeMs: number | null = null;
  let wrongKeyRejected = false;
  let corruptBundleRejected = false;
  let sourceDatabaseUnchanged = false;
  let restoredCopyBooted = false;
  let failureCode: string | null = null;
  let currentFailureCode = 'DATASET_CREATION_FAILED';
  let activeServer: PuntovivoServer | null = null;

  try {
    const seedStarted = performance.now();
    const sourceServer = await createServer({
      dbPath: sourceDbPath,
      migrationsFolder: options.migrationsFolder,
      encryptionKey: sourceKey,
      seedData: true,
      verbose: false,
    });
    activeServer = sourceServer;
    const sourceSqlite = (sourceServer.db as LiveDatabase).$client;
    migrationCount = countAppliedMigrations(sourceSqlite);
    datasetCounts = seedPackagedRecoveryDataset(sourceSqlite, profile);
    logicalSha256 = fingerprintPackagedRecoveryDataset(sourceSqlite);
    await sourceServer.close();
    activeServer = null;
    databaseBytes = (await stat(sourceDbPath)).size;
    timings.datasetSeedMs = roundMilliseconds(performance.now() - seedStarted);
    checks.push({
      id: 'representative-dataset',
      outcome: 'passed',
      detail: `${totalBusinessRows(datasetCounts)} business rows`,
    });

    currentFailureCode = 'BACKUP_CREATION_FAILED';
    const backupStarted = performance.now();
    await writeFile(deviceIdPath, 'packaged-recovery-device\n', { mode: 0o600 });
    const bundle = await createBackupBundle({
      dbPath: sourceDbPath,
      deviceIdPath,
      outZipPath: bundlePath,
      encryptionKey: sourceKey,
      manifest: { appVersion: options.appVersion },
    });
    bundleSha256 = await sha256File(bundlePath);
    bundleBytes = bundle.zipBytes;
    manifestSchemaVersion = bundle.manifest.schemaVersion;
    sourceDatabaseSha256 = await sha256File(sourceDbPath);
    timings.backupMs = roundMilliseconds(performance.now() - backupStarted);
    checks.push({
      id: 'encrypted-backup-created',
      outcome: 'passed',
      detail: 'integrity checked',
    });

    currentFailureCode = 'WRONG_KEY_REJECTION_FAILED';
    const wrongKeyStarted = performance.now();
    const validExtract = await extractBackupBundle(bundlePath, join(scratch, 'valid-extract'));
    if (
      validExtract.format !== 'zip' ||
      validExtract.manifest?.schemaVersion !== BACKUP_BUNDLE_SCHEMA_VERSION ||
      validExtract.manifest.appVersion !== options.appVersion ||
      !validExtract.deviceIdPath
    ) {
      throw new Error('packaged backup manifest or device identity is incomplete');
    }
    if (await isCleartextSqliteFile(validExtract.dbPath)) {
      throw new Error('packaged backup exposed a cleartext SQLite database');
    }
    await assertSqliteIntegrity(validExtract.dbPath, { encryptionKey: sourceKey });
    await assertKeyRejected(validExtract.dbPath, wrongKey);
    wrongKeyRejected = true;
    timings.wrongKeyRejectionMs = roundMilliseconds(performance.now() - wrongKeyStarted);
    checks.push({ id: 'wrong-key-rejected', outcome: 'passed', detail: 'source remains readable' });

    currentFailureCode = 'CORRUPT_BUNDLE_REJECTION_FAILED';
    const corruptStarted = performance.now();
    await writeCorruptedBundle(bundlePath, corruptBundlePath);
    await assertCorruptedBundleRejected(
      corruptBundlePath,
      join(scratch, 'corrupt-extract'),
      sourceKey
    );
    corruptBundleRejected = true;
    timings.corruptBundleRejectionMs = roundMilliseconds(performance.now() - corruptStarted);
    checks.push({
      id: 'corrupt-bundle-rejected',
      outcome: 'passed',
      detail: 'truncated database refused',
    });

    currentFailureCode = 'RESTORE_FAILED';
    const restoreStarted = performance.now();
    rekeySqliteDatabase(validExtract.dbPath, { fromKey: sourceKey, toKey: destinationKey });
    await assertSqliteIntegrity(validExtract.dbPath, { encryptionKey: destinationKey });
    await assertKeyRejected(validExtract.dbPath, sourceKey);
    recoveryPointAgeMs = Math.max(
      0,
      now().getTime() - Date.parse(validExtract.manifest.generatedAt)
    );
    timings.restoreMs = roundMilliseconds(performance.now() - restoreStarted);
    checks.push({
      id: 'correct-key-restored',
      outcome: 'passed',
      detail: 'cross-key rekey verified',
    });

    currentFailureCode = 'RESTORED_BOOT_FAILED';
    const bootStarted = performance.now();
    const restoredServer = await createServer({
      dbPath: validExtract.dbPath,
      migrationsFolder: options.migrationsFolder,
      encryptionKey: destinationKey,
      seedData: false,
      verbose: false,
    });
    activeServer = restoredServer;
    const restoredSqlite = (restoredServer.db as LiveDatabase).$client;
    if (countAppliedMigrations(restoredSqlite) !== migrationCount) {
      throw new Error('restored copy migration count differs from the packaged source');
    }
    const restoredCounts = inspectPackagedRecoveryDataset(restoredSqlite);
    assertDatasetCounts(restoredCounts, expectedCounts);
    restoredLogicalSha256 = fingerprintPackagedRecoveryDataset(restoredSqlite);
    if (restoredLogicalSha256 !== logicalSha256) {
      throw new Error('restored business-row fingerprint differs from the source');
    }
    await restoredServer.close();
    activeServer = null;
    restoredCopyBooted = true;
    restoredDatabaseSha256 = await sha256File(validExtract.dbPath);
    timings.restoredBootMs = roundMilliseconds(performance.now() - bootStarted);
    recoveryTimeMs = roundMilliseconds(timings.restoreMs + timings.restoredBootMs);
    checks.push({ id: 'restored-copy-booted', outcome: 'passed', detail: 'packaged schema ready' });
    checks.push({
      id: 'logical-data-preserved',
      outcome: 'passed',
      detail: `${totalBusinessRows(restoredCounts)} rows fingerprinted`,
    });

    currentFailureCode = 'SOURCE_MUTATION_DETECTED';
    sourceDatabaseUnchanged = (await sha256File(sourceDbPath)) === sourceDatabaseSha256;
    if (!sourceDatabaseUnchanged) {
      throw new Error('packaged recovery modified the source database');
    }
    checks.push({
      id: 'source-database-unchanged',
      outcome: 'passed',
      detail: 'byte hash unchanged after restore',
    });
  } catch (error) {
    failureCode = currentFailureCode;
    checks.push({
      id: 'rehearsal-completion',
      outcome: 'failed',
      detail: error instanceof Error ? error.name : 'unknown failure',
    });
  } finally {
    if (activeServer !== null) await activeServer.close().catch(() => undefined);
    timings.totalMs = roundMilliseconds(performance.now() - totalStarted);
  }

  const report: PackagedRecoveryReport = {
    schemaVersion: 1,
    outcome: failureCode === null ? 'passed' : 'failed',
    candidateSha: options.candidateSha,
    startedAt: startedAt.toISOString(),
    completedAt: now().toISOString(),
    environment: {
      packaged: options.packaged,
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      electronVersion: options.electronVersion,
      appVersion: options.appVersion,
      databaseSchemaVersion: migrationCount,
    },
    dataset: {
      profile: profile.id,
      counts: datasetCounts,
      totalBusinessRows: totalBusinessRows(datasetCounts),
      logicalSha256,
      databaseBytes,
    },
    recovery: {
      bundleSha256,
      bundleBytes,
      manifestSchemaVersion,
      sourceDatabaseSha256,
      restoredDatabaseSha256,
      restoredLogicalSha256,
      recoveryPointAgeMs,
      recoveryTimeMs,
      wrongKeyRejected,
      corruptBundleRejected,
      sourceDatabaseUnchanged,
      restoredCopyBooted,
    },
    timings,
    checks,
    failureCode,
  };
  let reportPath: string;
  try {
    reportPath = await writePackagedRecoveryReport(options.outputDirectory, report);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return { report, reportPath };
}
