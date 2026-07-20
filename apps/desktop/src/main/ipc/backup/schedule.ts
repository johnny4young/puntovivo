/** admin-gated snapshot schedule IPC boundary. */

import { createModuleLogger } from '@puntovivo/server';
import * as desktopSession from '../../session/desktopSession.ts';
import type { BackupScheduleFrequency, BackupScheduleStatus } from '../../backup/scheduler.ts';
import type { BackupIpcDeps } from './contracts.ts';

const backupScheduleLog = createModuleLogger('backup');

export interface BackupScheduleStatusResult {
  success: boolean;
  status?: BackupScheduleStatus;
  cancelled?: boolean;
  error?: 'schedule_unavailable' | 'snapshot_failed';
}

function requireAdminTenant(): string {
  desktopSession.requireOneOfRoles(['admin']);
  return desktopSession.requireTenantId();
}

function parseScheduleUpdate(input: unknown): {
  frequency: BackupScheduleFrequency;
  destinationMode?: 'managed';
} {
  if (!input || typeof input !== 'object') throw new Error('INVALID_BACKUP_SCHEDULE');
  const candidate = input as Record<string, unknown>;
  if (
    candidate.frequency !== 'off' &&
    candidate.frequency !== 'daily' &&
    candidate.frequency !== 'weekly'
  ) {
    throw new Error('INVALID_BACKUP_SCHEDULE');
  }
  if (candidate.destinationMode !== undefined && candidate.destinationMode !== 'managed') {
    throw new Error('INVALID_BACKUP_SCHEDULE');
  }
  return candidate.destinationMode === undefined
    ? { frequency: candidate.frequency }
    : { frequency: candidate.frequency, destinationMode: candidate.destinationMode };
}

export async function handleGetBackupScheduleStatus(
  deps: BackupIpcDeps
): Promise<BackupScheduleStatusResult> {
  const tenantId = requireAdminTenant();
  try {
    return { success: true, status: await deps.backupScheduler.getStatus(tenantId) };
  } catch (error) {
    backupScheduleLog.warn({ err: error, tenantId }, 'failed to read backup schedule status');
    return { success: false, error: 'schedule_unavailable' };
  }
}

export async function handleUpdateBackupSchedule(
  deps: BackupIpcDeps,
  input: unknown
): Promise<BackupScheduleStatusResult> {
  const tenantId = requireAdminTenant();
  try {
    const update = parseScheduleUpdate(input);
    return {
      success: true,
      status: await deps.backupScheduler.updateSchedule(tenantId, update),
    };
  } catch (error) {
    backupScheduleLog.warn({ err: error, tenantId }, 'failed to update backup schedule');
    return { success: false, error: 'schedule_unavailable' };
  }
}

export async function handleChooseBackupScheduleDestination(
  deps: BackupIpcDeps
): Promise<BackupScheduleStatusResult> {
  const tenantId = requireAdminTenant();
  try {
    const directory = await deps.chooseBackupScheduleDirectory();
    if (!directory) return { success: false, cancelled: true };
    return {
      success: true,
      status: await deps.backupScheduler.setCustomDestination(tenantId, directory),
    };
  } catch (error) {
    backupScheduleLog.warn(
      { err: error, tenantId },
      'failed to choose backup schedule destination'
    );
    return { success: false, error: 'schedule_unavailable' };
  }
}

export async function handleRunBackupSnapshotNow(
  deps: BackupIpcDeps
): Promise<BackupScheduleStatusResult> {
  const tenantId = requireAdminTenant();
  const result = await deps.backupScheduler.runNow(tenantId);
  return result.success
    ? { success: true, status: result.status }
    : { success: false, status: result.status, error: 'snapshot_failed' };
}
