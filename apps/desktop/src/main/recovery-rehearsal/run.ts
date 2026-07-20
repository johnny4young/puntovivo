import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import {
  assertSqliteIntegrity,
  BACKUP_BUNDLE_SCHEMA_VERSION,
  createBackupBundle,
  extractBackupBundle,
  isCleartextSqliteFile,
  rekeySqliteDatabase,
} from '../backup/backup-bundle.ts';
import {
  createServer,
  type DatabaseInstance,
  type PuntovivoServer,
} from '../../../../../packages/server/dist/index.js';
import {
  REHEARSAL_TABLES,
  buildHistoricalMigrationFixture,
  seedHistoricalSentinels,
} from './fixture.ts';
import { CURRENT_REHEARSAL_TABLES, seedCurrentSentinels } from './current-sentinels.ts';
import {
  assertCurrentSchemaReady,
  assertFingerprintsEqual,
  captureHistoricalColumns,
  countAppliedMigrations,
  fingerprintSentinels,
  sha256File,
} from './fingerprint.ts';
import {
  roundMilliseconds,
  writeRecoveryReport,
  type RecoveryCheck,
  type RecoveryRehearsalReport,
} from './report.ts';

interface LiveDatabase extends DatabaseInstance {
  $client: Database.Database;
}

export interface RecoveryRehearsalOptions {
  repositoryRoot?: string;
  outputDirectory: string;
  encryptionKey?: string;
  destinationEncryptionKey?: string;
  temporaryRoot?: string;
  now?: () => Date;
}

export interface RecoveryRehearsalResult {
  report: RecoveryRehearsalReport;
  reportPath: string;
}

function getRepositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
}

async function readTargetVersion(repositoryRoot: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
    version: string;
  };
  return packageJson.version;
}

async function readMigrationCount(migrationsFolder: string): Promise<number> {
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')
  ) as { entries: unknown[] };
  return journal.entries.length;
}

async function assertKeyCannotReadDatabase(dbPath: string, encryptionKey: string): Promise<void> {
  try {
    await assertSqliteIntegrity(dbPath, { encryptionKey });
  } catch {
    return;
  }
  throw new Error('database unexpectedly opened with the rejected encryption key');
}

function spawnDowngradeProbe(options: {
  repositoryRoot: string;
  dbPath: string;
  migrationsFolder: string;
  encryptionKey: string;
}): Promise<void> {
  const serverModuleUrl = pathToFileURL(
    join(options.repositoryRoot, 'packages/server/dist/index.js')
  ).href;
  const probe = `
    import { createServer } from ${JSON.stringify(serverModuleUrl)};
    try {
      const server = await createServer({
        dbPath: process.env.REHEARSAL_DB_PATH,
        migrationsFolder: process.env.REHEARSAL_MIGRATIONS,
        encryptionKey: process.env.REHEARSAL_DB_KEY,
        seedData: false,
        verbose: false,
      });
      await server.close();
      process.stderr.write('RECOVERY_PROBE:UNEXPECTED_SUCCESS\\n');
      process.exitCode = 2;
    } catch (error) {
      if (error instanceof Error && error.message.includes('schema is NEWER than this build')) {
        process.stdout.write('RECOVERY_PROBE:REFUSED\\n');
      } else {
        process.stderr.write('RECOVERY_PROBE:WRONG_FAILURE\\n');
        process.exitCode = 3;
      }
    }
  `;
  return new Promise((resolveProbe, rejectProbe) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: options.repositoryRoot,
      env: {
        ...process.env,
        REHEARSAL_DB_PATH: options.dbPath,
        REHEARSAL_MIGRATIONS: options.migrationsFolder,
        REHEARSAL_DB_KEY: options.encryptionKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
    child.once('error', rejectProbe);
    child.once('exit', code => {
      if (code === 0 && stdout.includes('RECOVERY_PROBE:REFUSED')) resolveProbe();
      else
        rejectProbe(
          new Error(
            `downgrade probe did not refuse safely (exit ${String(code)}, marker ${stderr.trim() || 'missing'})`
          )
        );
    });
  });
}

export async function runRecoveryRehearsal(
  options: RecoveryRehearsalOptions
): Promise<RecoveryRehearsalResult> {
  const repositoryRoot = options.repositoryRoot ?? getRepositoryRoot();
  const currentMigrations = join(repositoryRoot, 'packages/server/src/db/migrations');
  const encryptionKey = options.encryptionKey ?? randomBytes(32).toString('hex');
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const totalStarted = performance.now();
  const runId = `${startedAt.toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
  const scratch = await mkdtemp(
    join(options.temporaryRoot ?? tmpdir(), 'puntovivo-recovery-rehearsal-')
  );
  const dbPath = join(scratch, 'historical.db');
  const checks: RecoveryCheck[] = [];
  const timings = {
    fixtureBuildMs: 0,
    upgradeMs: 0,
    downgradeRefusalMs: 0,
    idempotentBootMs: 0,
    backupMs: 0,
    restoreMs: 0,
    totalMs: 0,
  };
  let sourceVersion = 'unknown';
  let sourceMigrationCount = 0;
  let targetMigrationCount = 0;
  let databaseSha256: string | null = null;
  const backup = {
    bundleSha256: null as string | null,
    bundleBytes: 0,
    manifestSchemaVersion: null as number | null,
    snapshotGeneratedAt: null as string | null,
    deviceIdentityIncluded: false,
  };
  const restore = {
    databaseSha256: null as string | null,
    migrationCount: 0,
    historicalTableCount: 0,
    currentTableCount: 0,
    destinationKeyVerified: false,
    sourceKeyRejected: false,
    deviceIdentityPreserved: false,
    snapshotAgeAtRestoreMs: null as number | null,
  };
  const targetVersion = await readTargetVersion(repositoryRoot);
  let failureCode: string | null = null;
  let currentFailureCode = 'HISTORICAL_FIXTURE_FAILED';
  let activeServer: PuntovivoServer | null = null;
  let historicalColumns: ReturnType<typeof captureHistoricalColumns>;
  let historicalFingerprints: ReturnType<typeof fingerprintSentinels>;
  let currentColumns: ReturnType<typeof captureHistoricalColumns>;
  let currentFingerprints: ReturnType<typeof fingerprintSentinels>;

  try {
    const fixtureStarted = performance.now();
    const fixture = await buildHistoricalMigrationFixture(repositoryRoot, scratch);
    timings.fixtureBuildMs = roundMilliseconds(performance.now() - fixtureStarted);
    sourceVersion = fixture.contract.sourceVersion;
    sourceMigrationCount = fixture.contract.migrationCount;
    checks.push({ id: 'historical-contract', outcome: 'passed', detail: 'verified' });

    const historicalServer = await createServer({
      dbPath,
      migrationsFolder: fixture.migrationsFolder,
      encryptionKey,
      seedData: false,
      verbose: false,
    });
    activeServer = historicalServer;
    const historicalSqlite = (historicalServer.db as LiveDatabase).$client;
    seedHistoricalSentinels(historicalSqlite);
    historicalColumns = captureHistoricalColumns(historicalSqlite, REHEARSAL_TABLES);
    historicalFingerprints = fingerprintSentinels(historicalSqlite, historicalColumns);
    if (countAppliedMigrations(historicalSqlite) !== sourceMigrationCount) {
      throw new Error('historical database migration count does not match its fixture');
    }
    await historicalServer.close();
    activeServer = null;
    checks.push({ id: 'historical-encrypted-fixture', outcome: 'passed', detail: '2 tenants' });

    currentFailureCode = 'UPGRADE_FAILED';
    const upgradeStarted = performance.now();
    const currentServer = await createServer({
      dbPath,
      migrationsFolder: currentMigrations,
      encryptionKey,
      seedData: false,
      verbose: false,
    });
    activeServer = currentServer;
    const currentSqlite = (currentServer.db as LiveDatabase).$client;
    targetMigrationCount = await readMigrationCount(currentMigrations);
    const appliedAfterUpgrade = countAppliedMigrations(currentSqlite);
    if (appliedAfterUpgrade !== targetMigrationCount) {
      throw new Error(
        `upgrade did not apply the complete current migration journal (${appliedAfterUpgrade}/${targetMigrationCount})`
      );
    }
    assertFingerprintsEqual(
      historicalFingerprints,
      fingerprintSentinels(currentSqlite, historicalColumns)
    );
    assertCurrentSchemaReady(currentSqlite);
    seedCurrentSentinels(currentSqlite);
    currentColumns = captureHistoricalColumns(currentSqlite, CURRENT_REHEARSAL_TABLES);
    currentFingerprints = fingerprintSentinels(currentSqlite, currentColumns);
    await currentServer.close();
    activeServer = null;
    timings.upgradeMs = roundMilliseconds(performance.now() - upgradeStarted);
    checks.push({ id: 'upgrade-preserves-data', outcome: 'passed', detail: '17 tables' });
    checks.push({
      id: 'current-schema-ready',
      outcome: 'passed',
      detail: 'defaults and FKs valid',
    });
    checks.push({
      id: 'current-domain-sentinels',
      outcome: 'passed',
      detail: `${CURRENT_REHEARSAL_TABLES.length} tables`,
    });

    currentFailureCode = 'IDEMPOTENT_BOOT_FAILED';
    const idempotentStarted = performance.now();
    const secondServer = await createServer({
      dbPath,
      migrationsFolder: currentMigrations,
      encryptionKey,
      seedData: false,
      verbose: false,
    });
    activeServer = secondServer;
    const secondSqlite = (secondServer.db as LiveDatabase).$client;
    if (countAppliedMigrations(secondSqlite) !== targetMigrationCount) {
      throw new Error('second current boot changed the applied migration count');
    }
    assertFingerprintsEqual(
      historicalFingerprints,
      fingerprintSentinels(secondSqlite, historicalColumns)
    );
    assertFingerprintsEqual(
      currentFingerprints,
      fingerprintSentinels(secondSqlite, currentColumns)
    );
    await secondServer.close();
    activeServer = null;
    timings.idempotentBootMs = roundMilliseconds(performance.now() - idempotentStarted);
    checks.push({ id: 'idempotent-second-boot', outcome: 'passed', detail: '0 new migrations' });

    currentFailureCode = 'DOWNGRADE_REFUSAL_FAILED';
    const downgradeStarted = performance.now();
    const beforeDowngrade = await sha256File(dbPath);
    await spawnDowngradeProbe({
      repositoryRoot,
      dbPath,
      migrationsFolder: fixture.migrationsFolder,
      encryptionKey,
    });
    const afterDowngrade = await sha256File(dbPath);
    if (afterDowngrade !== beforeDowngrade) {
      throw new Error('downgrade refusal modified the encrypted database');
    }
    databaseSha256 = afterDowngrade;
    timings.downgradeRefusalMs = roundMilliseconds(performance.now() - downgradeStarted);
    checks.push({ id: 'downgrade-refused', outcome: 'passed', detail: 'database unchanged' });

    currentFailureCode = 'BACKUP_CREATION_FAILED';
    const backupStarted = performance.now();
    const sourceDeviceIdPath = join(scratch, 'source-device-id.txt');
    const bundlePath = join(scratch, 'recovery.zip');
    const sourceDeviceId = 'rehearsal-device-primary';
    await writeFile(sourceDeviceIdPath, `${sourceDeviceId}\n`, { encoding: 'utf8', mode: 0o600 });
    const bundle = await createBackupBundle({
      dbPath,
      deviceIdPath: sourceDeviceIdPath,
      outZipPath: bundlePath,
      encryptionKey,
      manifest: { appVersion: targetVersion },
    });
    if (bundle.zipBytes <= 0 || bundle.manifest.dbBytes <= 0) {
      throw new Error('backup bundle did not contain database bytes');
    }
    backup.bundleSha256 = await sha256File(bundlePath);
    backup.bundleBytes = bundle.zipBytes;
    backup.manifestSchemaVersion = bundle.manifest.schemaVersion;
    backup.snapshotGeneratedAt = bundle.manifest.generatedAt;
    backup.deviceIdentityIncluded = true;
    timings.backupMs = roundMilliseconds(performance.now() - backupStarted);
    checks.push({ id: 'encrypted-backup-created', outcome: 'passed', detail: 'bundle verified' });

    currentFailureCode = 'RESTORE_FAILED';
    const restoreStarted = performance.now();
    const destinationKey = options.destinationEncryptionKey ?? randomBytes(32).toString('hex');
    const destinationDirectory = join(scratch, 'restored-install');
    const sourceBeforeRestore = await sha256File(dbPath);
    const extracted = await extractBackupBundle(bundlePath, destinationDirectory);
    if (
      extracted.format !== 'zip' ||
      extracted.manifest === undefined ||
      extracted.manifest.schemaVersion !== BACKUP_BUNDLE_SCHEMA_VERSION ||
      extracted.manifest.appVersion !== targetVersion ||
      extracted.manifest.dbBytes !== bundle.manifest.dbBytes
    ) {
      throw new Error('backup manifest did not match the source evidence');
    }
    if (extracted.deviceIdPath === undefined) {
      throw new Error('backup bundle did not preserve the device identity passenger');
    }
    const restoredDeviceId = (await readFile(extracted.deviceIdPath, 'utf8')).trim();
    if (restoredDeviceId !== sourceDeviceId) {
      throw new Error('restored installation device identity did not match the backup');
    }
    restore.deviceIdentityPreserved = true;

    if (await isCleartextSqliteFile(extracted.dbPath)) {
      throw new Error('backup bundle exposed a cleartext SQLite database');
    }
    await assertSqliteIntegrity(extracted.dbPath, { encryptionKey });
    await assertKeyCannotReadDatabase(extracted.dbPath, destinationKey);
    rekeySqliteDatabase(extracted.dbPath, { fromKey: encryptionKey, toKey: destinationKey });
    await assertSqliteIntegrity(extracted.dbPath, { encryptionKey: destinationKey });
    restore.destinationKeyVerified = true;
    await assertKeyCannotReadDatabase(extracted.dbPath, encryptionKey);
    restore.sourceKeyRejected = true;

    const restoredServer = await createServer({
      dbPath: extracted.dbPath,
      migrationsFolder: currentMigrations,
      encryptionKey: destinationKey,
      seedData: false,
      verbose: false,
    });
    activeServer = restoredServer;
    const restoredSqlite = (restoredServer.db as LiveDatabase).$client;
    restore.migrationCount = countAppliedMigrations(restoredSqlite);
    if (restore.migrationCount !== targetMigrationCount) {
      throw new Error('restored installation migration count does not match the current journal');
    }
    assertFingerprintsEqual(
      historicalFingerprints,
      fingerprintSentinels(restoredSqlite, historicalColumns)
    );
    assertFingerprintsEqual(
      currentFingerprints,
      fingerprintSentinels(restoredSqlite, currentColumns)
    );
    assertCurrentSchemaReady(restoredSqlite, { expectedTracksSerials: 1 });
    await restoredServer.close();
    activeServer = null;

    if ((await sha256File(dbPath)) !== sourceBeforeRestore) {
      throw new Error('isolated restore modified the source database');
    }
    restore.databaseSha256 = await sha256File(extracted.dbPath);
    restore.historicalTableCount = REHEARSAL_TABLES.length;
    restore.currentTableCount = CURRENT_REHEARSAL_TABLES.length;
    restore.snapshotAgeAtRestoreMs = Math.max(
      0,
      now().getTime() - Date.parse(extracted.manifest.generatedAt)
    );
    timings.restoreMs = roundMilliseconds(performance.now() - restoreStarted);
    checks.push({
      id: 'isolated-cross-key-restore',
      outcome: 'passed',
      detail: 'source unchanged',
    });
    checks.push({
      id: 'restored-data-preserved',
      outcome: 'passed',
      detail: `${REHEARSAL_TABLES.length + CURRENT_REHEARSAL_TABLES.length} fingerprints`,
    });
  } catch (error) {
    if (process.env.REHEARSAL_DEBUG === '1') {
      process.stderr.write(
        `recovery rehearsal debug: ${error instanceof Error ? error.stack : String(error)}\n`
      );
    }
    failureCode = currentFailureCode;
    checks.push({
      id: 'rehearsal-completion',
      outcome: 'failed',
      detail: error instanceof Error ? error.name : 'unknown failure',
    });
  } finally {
    if (activeServer !== null) {
      await activeServer.close().catch(() => undefined);
    }
    timings.totalMs = roundMilliseconds(performance.now() - totalStarted);
    await rm(scratch, { recursive: true, force: true });
  }

  const report: RecoveryRehearsalReport = {
    reportVersion: 2,
    runId,
    outcome: failureCode === null ? 'passed' : 'failed',
    sourceVersion,
    targetVersion,
    startedAt: startedAt.toISOString(),
    completedAt: now().toISOString(),
    sourceMigrationCount,
    targetMigrationCount,
    databaseSha256,
    encryptionEnabled: true,
    environment: { platform: process.platform, arch: process.arch, nodeVersion: process.version },
    timings,
    backup,
    restore,
    checks,
    failureCode,
  };
  const reportPath = await writeRecoveryReport(options.outputDirectory, report);
  return { report, reportPath };
}
