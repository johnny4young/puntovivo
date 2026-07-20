/**
 * stable IPC registration surface for desktop backup and restore.
 *
 * Main-process state that must remain owned by `main/index.ts` is injected
 * through BackupIpcDeps. Focused modules own backup creation and validated
 * restore/rekey state without creating a cycle back to the desktop bootstrap.
 *
 * @module main/ipc/backup
 */

import { ipcMain } from 'electron';
import type { BackupIpcDeps } from './backup/contracts.js';
import { handleCreateDatabaseBackup } from './backup/create.js';
import {
  handleCancelRestoreStaging,
  handleGetBackupEncryptionKey,
  handleProvideRestoreKey,
  handleRestoreDatabaseBackup,
} from './backup/restore.js';
import { handleGetBackupProtectionStatus } from './backup/status.js';
import { handleRunBackupRestoreDrill } from './backup/drill.js';
import {
  handleConfigureBackupCloudVault,
  handleDisconnectBackupCloudVault,
  handleGetBackupCloudVaultStatus,
  handleTestBackupCloudVault,
} from './backup/cloud-vault.js';
import {
  handleChooseBackupScheduleDestination,
  handleGetBackupScheduleStatus,
  handleRunBackupSnapshotNow,
  handleUpdateBackupSchedule,
} from './backup/schedule.js';

export type { BackupIpcDeps, DesktopDatabaseActionResult } from './backup/contracts.js';
export { clearPendingRestore } from './backup/restore.js';

export function registerBackupIpc(deps: BackupIpcDeps): void {
  ipcMain.handle('create-database-backup', () => handleCreateDatabaseBackup(deps));
  ipcMain.handle('restore-database-backup', () => handleRestoreDatabaseBackup(deps));
  // cross-device restore completion + admin key reveal.
  ipcMain.handle('provide-restore-key', (_event, token: unknown, keyHex: unknown) =>
    handleProvideRestoreKey(deps, token, keyHex)
  );
  ipcMain.handle('cancel-restore-staging', (_event, token: unknown) =>
    handleCancelRestoreStaging(token)
  );
  ipcMain.handle('get-backup-encryption-key', () => handleGetBackupEncryptionKey(deps));
  ipcMain.handle('get-backup-protection-status', () => handleGetBackupProtectionStatus(deps));
  ipcMain.handle('get-backup-schedule-status', () => handleGetBackupScheduleStatus(deps));
  ipcMain.handle('update-backup-schedule', (_event, input: unknown) =>
    handleUpdateBackupSchedule(deps, input)
  );
  ipcMain.handle('choose-backup-schedule-destination', () =>
    handleChooseBackupScheduleDestination(deps)
  );
  ipcMain.handle('run-backup-snapshot-now', () => handleRunBackupSnapshotNow(deps));
  ipcMain.handle('run-backup-restore-drill', () => handleRunBackupRestoreDrill(deps));
  ipcMain.handle('get-backup-cloud-vault-status', () => handleGetBackupCloudVaultStatus(deps));
  ipcMain.handle('configure-backup-cloud-vault', (_event, input: unknown) =>
    handleConfigureBackupCloudVault(deps, input)
  );
  ipcMain.handle('disconnect-backup-cloud-vault', () => handleDisconnectBackupCloudVault(deps));
  ipcMain.handle('test-backup-cloud-vault', () => handleTestBackupCloudVault(deps));
}
