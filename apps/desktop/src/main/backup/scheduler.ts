/**
 * ENG-136a — device-local scheduler for encrypted database snapshots.
 *
 * Schedule metadata is intentionally stored outside the operational DB. A
 * restored database must not silently re-enable a custom path from another
 * machine, while each tenant used on this workstation still gets an isolated
 * configuration record. Snapshot contents remain SQLCipher-encrypted through
 * the existing createBackupBundle contract.
 */

import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import {
  createBackupBundle,
  createBackupFileName,
  type CreateBackupBundleResult,
} from './backup-bundle.ts';

export const BACKUP_SCHEDULE_FREQUENCIES = ['off', 'daily', 'weekly'] as const;
export type BackupScheduleFrequency = (typeof BACKUP_SCHEDULE_FREQUENCIES)[number];
export type BackupDestinationMode = 'managed' | 'custom';

const STATE_SCHEMA_VERSION = 1;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const WEEKLY_INTERVAL_MS = 7 * DAILY_INTERVAL_MS;
const DEFAULT_TICK_INTERVAL_MS = 60_000;

export interface BackupScheduleRecord {
  tenantId: string;
  frequency: BackupScheduleFrequency;
  destinationMode: BackupDestinationMode;
  destinationDirectory: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastPath: string | null;
  lastSizeBytes: number | null;
  lastError: 'snapshot_failed' | null;
}

interface BackupScheduleStateFile {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  schedules: Record<string, BackupScheduleRecord>;
}

export interface BackupScheduleStatus extends BackupScheduleRecord {
  inProgress: boolean;
}

export interface BackupScheduleUpdate {
  frequency: BackupScheduleFrequency;
  destinationMode?: BackupDestinationMode;
}

export interface BackupScheduleRunResult {
  success: boolean;
  status: BackupScheduleStatus;
  error?: 'snapshot_failed';
}

export interface BackupSchedulerLog {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

interface BackupSchedulerDeps {
  dbPath: string;
  getStatePath: () => string;
  getManagedDirectory: (tenantId: string) => string;
  getDeviceIdPath: () => string | undefined;
  getAppVersion: () => string;
  resolveDatabaseEncryptionKey: () => Promise<string>;
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  /** ENG-136c — optional post-snapshot cloud replication. Local success wins. */
  replicateSnapshot?: (input: {
    tenantId: string;
    zipPath: string;
  }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
  createBundle?: typeof createBackupBundle;
  now?: () => Date;
  tickIntervalMs?: number;
  log: BackupSchedulerLog;
}

export interface BackupScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
  tick(): Promise<void>;
  getStatus(tenantId: string): Promise<BackupScheduleStatus>;
  updateSchedule(tenantId: string, update: BackupScheduleUpdate): Promise<BackupScheduleStatus>;
  setCustomDestination(tenantId: string, directory: string): Promise<BackupScheduleStatus>;
  runNow(tenantId: string): Promise<BackupScheduleRunResult>;
}

/** Keep a signed tenant id inside one cross-platform directory segment. */
export function backupTenantPathSegment(tenantId: string): string {
  const sanitized = tenantId
    .replace(/[^a-z0-9_-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return sanitized || 'tenant';
}

function isFrequency(value: unknown): value is BackupScheduleFrequency {
  return BACKUP_SCHEDULE_FREQUENCIES.includes(value as BackupScheduleFrequency);
}

function isDestinationMode(value: unknown): value is BackupDestinationMode {
  return value === 'managed' || value === 'custom';
}

function optionalIso(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function optionalNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeRecord(value: unknown): BackupScheduleRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BackupScheduleRecord>;
  if (
    typeof candidate.tenantId !== 'string' ||
    candidate.tenantId.length === 0 ||
    !isFrequency(candidate.frequency) ||
    !isDestinationMode(candidate.destinationMode) ||
    typeof candidate.destinationDirectory !== 'string' ||
    !isAbsolute(candidate.destinationDirectory)
  ) {
    return null;
  }

  return {
    tenantId: candidate.tenantId,
    frequency: candidate.frequency,
    destinationMode: candidate.destinationMode,
    destinationDirectory: candidate.destinationDirectory,
    updatedAt: optionalIso(candidate.updatedAt) ?? new Date(0).toISOString(),
    nextRunAt: optionalIso(candidate.nextRunAt),
    lastAttemptAt: optionalIso(candidate.lastAttemptAt),
    lastSuccessAt: optionalIso(candidate.lastSuccessAt),
    lastPath:
      typeof candidate.lastPath === 'string' && isAbsolute(candidate.lastPath)
        ? candidate.lastPath
        : null,
    lastSizeBytes: optionalNonNegativeNumber(candidate.lastSizeBytes),
    lastError: candidate.lastError === 'snapshot_failed' ? candidate.lastError : null,
  };
}

function emptyState(): BackupScheduleStateFile {
  return { schemaVersion: STATE_SCHEMA_VERSION, schedules: {} };
}

async function loadState(path: string): Promise<BackupScheduleStateFile> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return emptyState();
    const candidate = parsed as Partial<BackupScheduleStateFile>;
    if (candidate.schemaVersion !== STATE_SCHEMA_VERSION || !candidate.schedules) {
      return emptyState();
    }

    const schedules: Record<string, BackupScheduleRecord> = {};
    for (const value of Object.values(candidate.schedules)) {
      const record = normalizeRecord(value);
      if (record) schedules[record.tenantId] = record;
    }
    return { schemaVersion: STATE_SCHEMA_VERSION, schedules };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    return emptyState();
  }
}

async function saveState(path: string, state: BackupScheduleStateFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function intervalFor(frequency: BackupScheduleFrequency): number | null {
  if (frequency === 'daily') return DAILY_INTERVAL_MS;
  if (frequency === 'weekly') return WEEKLY_INTERVAL_MS;
  return null;
}

export function computeNextBackupRunAt(
  frequency: BackupScheduleFrequency,
  anchor: Date
): string | null {
  const interval = intervalFor(frequency);
  return interval === null ? null : new Date(anchor.getTime() + interval).toISOString();
}

function defaultRecord(
  tenantId: string,
  managedDirectory: string,
  now: Date
): BackupScheduleRecord {
  return {
    tenantId,
    frequency: 'off',
    destinationMode: 'managed',
    destinationDirectory: managedDirectory,
    updatedAt: now.toISOString(),
    nextRunAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastPath: null,
    lastSizeBytes: null,
    lastError: null,
  };
}

export function createBackupScheduler(deps: BackupSchedulerDeps): BackupScheduler {
  const createBundle = deps.createBundle ?? createBackupBundle;
  const now = deps.now ?? (() => new Date());
  const inProgressTenants = new Set<string>();
  const inFlight = new Set<Promise<unknown>>();
  let stateTail: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | null = null;
  let stopped = true;

  async function readRecord(tenantId: string): Promise<BackupScheduleRecord> {
    await stateTail;
    const state = await loadState(deps.getStatePath());
    return (
      state.schedules[tenantId] ??
      defaultRecord(tenantId, deps.getManagedDirectory(tenantId), now())
    );
  }

  async function writeRecord(record: BackupScheduleRecord): Promise<void> {
    const statePath = deps.getStatePath();
    const write = stateTail.then(async () => {
      const state = await loadState(statePath);
      state.schedules[record.tenantId] = record;
      await saveState(statePath, state);
    });
    stateTail = write.catch(() => undefined);
    await write;
  }

  function withProgress(record: BackupScheduleRecord): BackupScheduleStatus {
    return { ...record, inProgress: inProgressTenants.has(record.tenantId) };
  }

  async function createSnapshot(record: BackupScheduleRecord): Promise<BackupScheduleRunResult> {
    if (inProgressTenants.has(record.tenantId)) {
      return { success: false, status: withProgress(record), error: 'snapshot_failed' };
    }

    inProgressTenants.add(record.tenantId);
    const attemptedAt = now();
    let next: BackupScheduleRecord = {
      ...record,
      lastAttemptAt: attemptedAt.toISOString(),
      lastError: null,
    };

    try {
      await writeRecord(next);
      await mkdir(next.destinationDirectory, { recursive: true });
      await access(next.destinationDirectory);
      const outputPath = join(
        next.destinationDirectory,
        createBackupFileName({ tenantSlug: next.tenantId, now: attemptedAt })
      );
      const result: CreateBackupBundleResult = await deps.runExclusive(async () => {
        const encryptionKey = await deps.resolveDatabaseEncryptionKey();
        const deviceIdPath = deps.getDeviceIdPath();
        return createBundle({
          dbPath: deps.dbPath,
          ...(deviceIdPath ? { deviceIdPath } : {}),
          outZipPath: outputPath,
          encryptionKey,
          manifest: {
            appVersion: deps.getAppVersion(),
            tenantSlug: next.tenantId,
          },
        });
      });

      const completedAt = now();
      next = {
        ...next,
        lastSuccessAt: completedAt.toISOString(),
        lastPath: result.zipPath,
        lastSizeBytes: result.zipBytes,
        lastError: null,
        nextRunAt: computeNextBackupRunAt(next.frequency, completedAt),
      };
      await writeRecord(next);
      deps.log.info(
        { tenantId: next.tenantId, zipBytes: result.zipBytes },
        'scheduled database snapshot created'
      );
      if (deps.replicateSnapshot) {
        try {
          const replication = await deps.replicateSnapshot({
            tenantId: next.tenantId,
            zipPath: result.zipPath,
          });
          if (!replication.success && !replication.skipped) {
            deps.log.warn(
              { tenantId: next.tenantId, errorCode: replication.error ?? 'upload_failed' },
              'scheduled snapshot cloud replication failed; local snapshot remains valid'
            );
          }
        } catch {
          // ENG-136c — cloud is an optional second copy. A provider or
          // credential failure must never invalidate a completed local backup.
          deps.log.warn(
            { tenantId: next.tenantId, errorCode: 'upload_failed' },
            'scheduled snapshot cloud replication failed; local snapshot remains valid'
          );
        }
      }
      return { success: true, status: { ...next, inProgress: false } };
    } catch (error) {
      const failedAt = now();
      next = {
        ...next,
        lastError: 'snapshot_failed',
        nextRunAt: computeNextBackupRunAt(next.frequency, failedAt),
      };
      try {
        await writeRecord(next);
      } catch (persistenceError) {
        deps.log.error(
          { err: persistenceError, tenantId: next.tenantId },
          'failed to persist scheduled snapshot failure status'
        );
      }
      deps.log.error({ err: error, tenantId: next.tenantId }, 'scheduled database snapshot failed');
      return {
        success: false,
        status: { ...next, inProgress: false },
        error: 'snapshot_failed',
      };
    } finally {
      inProgressTenants.delete(record.tenantId);
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    await stateTail;
    const state = await loadState(deps.getStatePath());
    const currentTime = now().getTime();
    for (const record of Object.values(state.schedules)) {
      if (record.frequency === 'off' || !record.nextRunAt) continue;
      if (Date.parse(record.nextRunAt) > currentTime || inProgressTenants.has(record.tenantId)) {
        continue;
      }
      const promise = createSnapshot(record);
      inFlight.add(promise);
      void promise.then(
        () => inFlight.delete(promise),
        () => inFlight.delete(promise)
      );
    }
  }

  return {
    async start(): Promise<void> {
      if (!stopped) return;
      stopped = false;
      await tick();
      timer = setInterval(() => {
        void tick().catch(error => {
          deps.log.warn({ err: error }, 'backup scheduler tick failed');
        });
      }, deps.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS);
      timer.unref?.();
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await Promise.allSettled([...inFlight]);
    },
    tick,
    async getStatus(tenantId: string): Promise<BackupScheduleStatus> {
      return withProgress(await readRecord(tenantId));
    },
    async updateSchedule(
      tenantId: string,
      update: BackupScheduleUpdate
    ): Promise<BackupScheduleStatus> {
      if (!isFrequency(update.frequency)) {
        throw new Error('INVALID_BACKUP_FREQUENCY');
      }
      const existing = await readRecord(tenantId);
      const currentTime = now();
      const destinationMode = update.destinationMode ?? existing.destinationMode;
      if (!isDestinationMode(destinationMode)) {
        throw new Error('INVALID_BACKUP_DESTINATION_MODE');
      }
      const destinationDirectory =
        destinationMode === 'managed'
          ? deps.getManagedDirectory(tenantId)
          : existing.destinationDirectory;
      if (!isAbsolute(destinationDirectory)) {
        throw new Error('INVALID_BACKUP_DESTINATION');
      }
      const next: BackupScheduleRecord = {
        ...existing,
        frequency: update.frequency,
        destinationMode,
        destinationDirectory,
        updatedAt: currentTime.toISOString(),
        nextRunAt: computeNextBackupRunAt(update.frequency, currentTime),
      };
      await writeRecord(next);
      deps.log.info(
        { tenantId, frequency: next.frequency, destinationMode: next.destinationMode },
        'backup schedule updated'
      );
      return withProgress(next);
    },
    async setCustomDestination(tenantId: string, directory: string): Promise<BackupScheduleStatus> {
      if (!isAbsolute(directory)) throw new Error('INVALID_BACKUP_DESTINATION');
      const existing = await readRecord(tenantId);
      const next = {
        ...existing,
        destinationMode: 'custom' as const,
        destinationDirectory: directory,
        updatedAt: now().toISOString(),
      };
      await writeRecord(next);
      deps.log.info({ tenantId }, 'custom backup destination updated');
      return withProgress(next);
    },
    async runNow(tenantId: string): Promise<BackupScheduleRunResult> {
      return createSnapshot(await readRecord(tenantId));
    },
  };
}
