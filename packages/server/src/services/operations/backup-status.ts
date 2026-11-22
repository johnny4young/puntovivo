/**
 * Scheduled snapshots run in the desktop main process, which publishes each
 * tenant's latest outcome into one app setting. This reads it for the owner.
 *
 * @module services/operations/backup-status
 */
import { eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { appSettings } from '../../db/schema.js';

/** Must match the key the desktop main process writes. */
export const BACKUP_STATUS_SETTING_KEY = 'backup_snapshot_status';

const INTERVAL_MS = { daily: 24 * 3_600_000, weekly: 7 * 24 * 3_600_000 } as const;

export interface OwnerBackupStatus {
  state: 'ok' | 'failed' | 'late';
  /** The last success, or the failed attempt. */
  at: string;
}

function iso(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * Null when this installation does not schedule snapshots for the tenant.
 * Late means more than two intervals since the last success, so a computer
 * switched off for a night is not reported until it misses a second run.
 */
export function readBackupStatus(
  db: DatabaseInstance,
  tenantId: string,
  now: Date
): OwnerBackupStatus | null {
  const value = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, BACKUP_STATUS_SETTING_KEY))
    .get()?.value;
  if (!value || typeof value !== 'object') return null;
  const record = (value as Record<string, unknown>)[tenantId];
  if (!record || typeof record !== 'object') return null;
  const { frequency, lastError, lastAttemptAt, lastSuccessAt } = record as Record<string, unknown>;
  if (frequency !== 'daily' && frequency !== 'weekly') return null;

  const attempt = iso(lastAttemptAt);
  if (lastError === 'snapshot_failed' && attempt) return { state: 'failed', at: attempt };
  const success = iso(lastSuccessAt);
  if (!success) return null;
  const late = now.getTime() - Date.parse(success) > 2 * INTERVAL_MS[frequency];
  return { state: late ? 'late' : 'ok', at: success };
}
