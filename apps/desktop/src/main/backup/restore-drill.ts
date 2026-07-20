/**
 * non-destructive recovery-readiness drill.
 *
 * The drill reads the latest scheduler-owned snapshot into an ephemeral
 * directory, verifies SQLite integrity, and compares tenant-scoped row counts
 * against the live connection. It never stops the server or swaps database
 * files, and cleanup runs on every outcome.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  assertSqliteIntegrity,
  BACKUP_BUNDLE_SCHEMA_VERSION,
  BACKUP_RESTORE_DRILL_TABLES,
  extractBackupBundle,
  inspectBackupTenantCounts,
  readTenantRestoreDrillCounts,
  type BackupRestoreDrillTable,
} from './backup-bundle.ts';
import type { BackupScheduler } from './scheduler.ts';

export type BackupRestoreDrillErrorCode = 'snapshot_unavailable' | 'drill_failed';

export interface BackupRestoreDrillTableResult {
  table: BackupRestoreDrillTable;
  currentCount: number;
  snapshotCount: number;
  delta: number;
}

export interface BackupRestoreDrillReport {
  outcome: 'passed';
  checkedAt: string;
  snapshotGeneratedAt: string;
  snapshotSchemaVersion: number;
  snapshotSizeBytes: number;
  currentTotal: number;
  snapshotTotal: number;
  tables: BackupRestoreDrillTableResult[];
}

export class BackupRestoreDrillError extends Error {
  readonly code: BackupRestoreDrillErrorCode;

  constructor(code: BackupRestoreDrillErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = 'BackupRestoreDrillError';
    this.code = code;
  }
}

interface BackupRestoreDrillDeps {
  backupScheduler: Pick<BackupScheduler, 'getStatus'>;
  getCurrentDatabase: () => Pick<Database.Database, 'prepare' | 'transaction'>;
  resolveDatabaseEncryptionKey: () => Promise<string>;
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  getTemporaryRoot?: () => string;
  now?: () => Date;
}

export interface BackupRestoreDrill {
  run(tenantId: string): Promise<BackupRestoreDrillReport>;
}

function isValidManifest(
  value: unknown,
  tenantId: string
): value is { tenantSlug: string; generatedAt: string; schemaVersion: number; dbBytes: number } {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  return (
    manifest.tenantSlug === tenantId &&
    typeof manifest.generatedAt === 'string' &&
    Number.isFinite(Date.parse(manifest.generatedAt)) &&
    typeof manifest.schemaVersion === 'number' &&
    manifest.schemaVersion === BACKUP_BUNDLE_SCHEMA_VERSION &&
    typeof manifest.dbBytes === 'number' &&
    Number.isSafeInteger(manifest.dbBytes) &&
    manifest.dbBytes >= 0
  );
}

export function createBackupRestoreDrill(deps: BackupRestoreDrillDeps): BackupRestoreDrill {
  const now = deps.now ?? (() => new Date());
  const getTemporaryRoot = deps.getTemporaryRoot ?? tmpdir;

  return {
    async run(tenantId: string): Promise<BackupRestoreDrillReport> {
      return deps.runExclusive(async () => {
        const status = await deps.backupScheduler.getStatus(tenantId);
        if (!status.lastPath) {
          throw new BackupRestoreDrillError('snapshot_unavailable');
        }

        const stagingDirectory = await mkdtemp(
          join(getTemporaryRoot(), 'puntovivo-restore-drill-')
        );
        try {
          const extracted = await extractBackupBundle(status.lastPath, stagingDirectory);
          if (extracted.format !== 'zip' || !isValidManifest(extracted.manifest, tenantId)) {
            throw new BackupRestoreDrillError('drill_failed');
          }

          const encryptionKey = await deps.resolveDatabaseEncryptionKey();
          await assertSqliteIntegrity(extracted.dbPath, { encryptionKey });

          const snapshotCounts = inspectBackupTenantCounts(
            extracted.dbPath,
            tenantId,
            encryptionKey
          );
          const currentDb = deps.getCurrentDatabase();
          const currentCounts = currentDb.transaction(() =>
            readTenantRestoreDrillCounts(currentDb, tenantId)
          )();
          const tables = BACKUP_RESTORE_DRILL_TABLES.map(table => {
            const currentCount = currentCounts[table];
            const snapshotCount = snapshotCounts[table];
            return {
              table,
              currentCount,
              snapshotCount,
              delta: currentCount - snapshotCount,
            };
          });

          return {
            outcome: 'passed',
            checkedAt: now().toISOString(),
            snapshotGeneratedAt: extracted.manifest.generatedAt,
            snapshotSchemaVersion: extracted.manifest.schemaVersion,
            snapshotSizeBytes: status.lastSizeBytes ?? extracted.manifest.dbBytes,
            currentTotal: tables.reduce((sum, row) => sum + row.currentCount, 0),
            snapshotTotal: tables.reduce((sum, row) => sum + row.snapshotCount, 0),
            tables,
          };
        } catch (error) {
          if (error instanceof BackupRestoreDrillError) throw error;
          throw new BackupRestoreDrillError('drill_failed', { cause: error });
        } finally {
          await rm(stagingDirectory, { recursive: true, force: true });
        }
      });
    },
  };
}
