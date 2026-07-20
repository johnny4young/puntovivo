/**
 * admin-gated desktop backup creation IPC flow.
 *
 * @module main/ipc/backup/create
 */

import { app, dialog, type SaveDialogOptions } from 'electron';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createBackupBundle,
  createBackupFileName as createBackupZipFileName,
} from '../../backup/backup-bundle.js';
import { t } from '../../i18n';
// read authenticated identity from the main-process singleton,
// never from renderer-supplied arguments.
import * as desktopSession from '../../session/desktopSession.js';
import type { BackupIpcDeps, DesktopDatabaseActionResult } from './contracts.js';
import { backupLog, ensureParentDirectoryExists, getDeviceIdPath } from './runtime.js';

export async function handleCreateDatabaseBackup(
  deps: BackupIpcDeps
): Promise<DesktopDatabaseActionResult> {
  desktopSession.requireOneOfRoles(['admin']);
  const mainWindow = deps.getMainWindow();
  const saveDialogOptions: SaveDialogOptions = {
    title: t('backup.createDialogTitle'),
    defaultPath: join(app.getPath('documents'), createBackupZipFileName()),
    filters: [
      {
        name: t('backup.fileFilterName'),
        extensions: ['zip'],
      },
    ],
  };
  const { canceled, filePath } = mainWindow
    ? await dialog.showSaveDialog(mainWindow, saveDialogOptions)
    : await dialog.showSaveDialog(saveDialogOptions);

  if (canceled || !filePath) {
    return {
      success: false,
      cancelled: true,
    };
  }

  try {
    // atomic backup via SQLite online backup API. The
    // server is stopped first so the backup bundle is consistent
    // with operator expectations even though `db.backup()` is safe
    // under concurrent writes.
    const result = await deps.runExclusiveBackupOperation(() =>
      deps.runWithServerRestart(async () => {
        await access(deps.dbPath);
        await ensureParentDirectoryExists(filePath);
        const deviceIdPath = getDeviceIdPath();
        const encryptionKey = await deps.resolveDatabaseEncryptionKey();
        return createBackupBundle({
          dbPath: deps.dbPath,
          deviceIdPath,
          outZipPath: filePath,
          encryptionKey,
          manifest: { appVersion: app.getVersion() },
        });
      })
    );

    backupLog.info({ zipPath: result.zipPath, zipBytes: result.zipBytes }, 'backup created');

    return {
      success: true,
      cancelled: false,
      path: result.zipPath,
      sizeBytes: result.zipBytes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : t('backup.createFailed');
    backupLog.error({ err: error }, 'failed to create backup');
    return {
      success: false,
      cancelled: false,
      error: message,
    };
  }
}
