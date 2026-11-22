/**
 * Projects every tenant's scheduled-snapshot outcome into one app setting so
 * the server can tell the owner's phone whether last night's backup ran. Paths
 * and sizes stay in the device-local state file.
 */

import type { BackupScheduleRecord } from './scheduler.ts';

/** Must match BACKUP_STATUS_SETTING_KEY in the server's backup-status service. */
export const BACKUP_STATUS_SETTING_KEY = 'backup_snapshot_status';

export type PublishedBackupStatus = Pick<
  BackupScheduleRecord,
  'frequency' | 'lastAttemptAt' | 'lastSuccessAt' | 'lastError'
>;

export function projectBackupStatus(
  schedules: Record<string, BackupScheduleRecord>
): Record<string, PublishedBackupStatus> {
  return Object.fromEntries(
    Object.values(schedules).map(record => [
      record.tenantId,
      {
        frequency: record.frequency,
        lastAttemptAt: record.lastAttemptAt,
        lastSuccessAt: record.lastSuccessAt,
        lastError: record.lastError,
      },
    ])
  );
}
