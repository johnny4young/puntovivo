/** ENG-136b — admin-gated restore-drill IPC and audit boundary. */

import { createModuleLogger } from '@puntovivo/server';
import {
  BackupRestoreDrillError,
  type BackupRestoreDrillReport,
} from '../../backup/restore-drill.ts';
import * as desktopSession from '../../session/desktopSession.ts';
import type { BackupIpcDeps } from './contracts.ts';

const restoreDrillLog = createModuleLogger('backup');

export type BackupRestoreDrillResult =
  | { success: true; report: BackupRestoreDrillReport }
  | { success: false; error: 'snapshot_unavailable' | 'drill_failed' };

function safeErrorCode(error: unknown): 'snapshot_unavailable' | 'drill_failed' {
  return error instanceof BackupRestoreDrillError ? error.code : 'drill_failed';
}

export async function handleRunBackupRestoreDrill(
  deps: BackupIpcDeps
): Promise<BackupRestoreDrillResult> {
  desktopSession.requireOneOfRoles(['admin']);
  const tenantId = desktopSession.requireTenantId();
  const actorId = desktopSession.requireUserId();

  try {
    const report = await deps.runBackupRestoreDrill(tenantId);
    try {
      deps.recordBackupRestoreDrillAudit({
        tenantId,
        actorId,
        resourceId: report.snapshotGeneratedAt,
        outcome: 'passed',
        report,
      });
    } catch {
      restoreDrillLog.error(
        { tenantId, errorCode: 'drill_failed' },
        'restore drill passed but audit evidence could not be recorded'
      );
      return { success: false, error: 'drill_failed' };
    }
    restoreDrillLog.info(
      { tenantId, snapshotGeneratedAt: report.snapshotGeneratedAt },
      'backup restore drill passed'
    );
    return { success: true, report };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    try {
      deps.recordBackupRestoreDrillAudit({
        tenantId,
        actorId,
        resourceId: 'latest',
        outcome: 'failed',
        errorCode,
      });
    } catch {
      restoreDrillLog.error(
        { tenantId, errorCode: 'drill_failed' },
        'failed restore drill audit evidence could not be recorded'
      );
    }
    // The underlying exception can contain a filesystem path or a SQLCipher
    // diagnostic. Keep it out of structured logs just as we keep it out of the
    // renderer and immutable audit metadata.
    restoreDrillLog.warn({ tenantId, errorCode }, 'backup restore drill failed');
    return { success: false, error: errorCode };
  }
}
