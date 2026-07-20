/** admin-only, non-secret backup protection attestation. */

import { createModuleLogger } from '@puntovivo/server';
import type { BackupProtectionStatus } from '../../backup-protection.ts';
import * as desktopSession from '../../session/desktopSession.ts';
import type { BackupIpcDeps } from './contracts.ts';

const backupStatusLog = createModuleLogger('desktop-backup-protection');
const BACKUP_PROTECTION_STATUS_UNAVAILABLE = 'Backup protection status unavailable';

export type BackupProtectionStatusResult =
  { success: true; status: BackupProtectionStatus } | { success: false; error: string };

export function handleGetBackupProtectionStatus(deps: BackupIpcDeps): BackupProtectionStatusResult {
  desktopSession.requireOneOfRoles(['admin']);
  try {
    const status = deps.getBackupProtectionStatus();
    backupStatusLog.info(
      {
        protected: status.protected,
        provider: status.provider,
        databaseEncrypted: status.databaseEncrypted,
      },
      'backup protection status inspected by admin'
    );
    return { success: true, status };
  } catch (error) {
    backupStatusLog.warn({ err: error }, 'backup protection status inspection failed');
    return {
      success: false,
      error: BACKUP_PROTECTION_STATUS_UNAVAILABLE,
    };
  }
}
