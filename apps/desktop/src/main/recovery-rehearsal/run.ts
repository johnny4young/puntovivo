import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
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
  const scratch = await mkdtemp(join(tmpdir(), 'puntovivo-recovery-rehearsal-'));
  const dbPath = join(scratch, 'historical.db');
  const checks: RecoveryCheck[] = [];
  const timings = {
    fixtureBuildMs: 0,
    upgradeMs: 0,
    downgradeRefusalMs: 0,
    idempotentBootMs: 0,
    totalMs: 0,
  };
  let sourceVersion = 'unknown';
  let sourceMigrationCount = 0;
  let targetMigrationCount = 0;
  let databaseSha256: string | null = null;
  const targetVersion = await readTargetVersion(repositoryRoot);
  let failureCode: string | null = null;
  let currentFailureCode = 'HISTORICAL_FIXTURE_FAILED';
  let activeServer: PuntovivoServer | null = null;

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
    const historicalColumns = captureHistoricalColumns(historicalSqlite, REHEARSAL_TABLES);
    const fingerprintsBefore = fingerprintSentinels(historicalSqlite, historicalColumns);
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
      fingerprintsBefore,
      fingerprintSentinels(currentSqlite, historicalColumns)
    );
    assertCurrentSchemaReady(currentSqlite);
    await currentServer.close();
    activeServer = null;
    timings.upgradeMs = roundMilliseconds(performance.now() - upgradeStarted);
    checks.push({ id: 'upgrade-preserves-data', outcome: 'passed', detail: '17 tables' });
    checks.push({
      id: 'current-schema-ready',
      outcome: 'passed',
      detail: 'defaults and FKs valid',
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
      fingerprintsBefore,
      fingerprintSentinels(secondSqlite, historicalColumns)
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
    reportVersion: 1,
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
    checks,
    failureCode,
  };
  const reportPath = await writeRecoveryReport(options.outputDirectory, report);
  return { report, reportPath };
}
