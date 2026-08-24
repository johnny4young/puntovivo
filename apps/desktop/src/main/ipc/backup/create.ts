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
  MIN_BACKUP_PASSPHRASE_LENGTH,
} from '../../backup/backup-bundle.js';
import { t } from '../../i18n';
// read authenticated identity from the main-process singleton,
// never from renderer-supplied arguments.
import * as desktopSession from '../../session/desktopSession.js';
import type { BackupIpcDeps, DesktopDatabaseActionResult } from './contracts.js';
import { backupLog, ensureParentDirectoryExists, getDeviceIdPath } from './runtime.js';

export async function handleCreateDatabaseBackup(
  deps: BackupIpcDeps,
  rawPassphrase?: unknown
): Promise<DesktopDatabaseActionResult> {
  desktopSession.requireOneOfRoles(['admin']);
  // Optional operator passphrase: when present the bundle carries a
  // key-wrap so another device can restore it from the phrase instead
  // of the raw 64-hex key. Boundary revalidates the renderer's rule.
  let passphrase: string | undefined;
  if (rawPassphrase !== undefined && rawPassphrase !== null && rawPassphrase !== '') {
    if (typeof rawPassphrase !== 'string' || rawPassphrase.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
      return {
        success: false,
        cancelled: false,
        error: t('backup.passphraseTooShort'),
      };
    }
    passphrase = rawPassphrase;
  }
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
    // Atomic snapshot through the shared backup helper. The server is
    // stopped first so the manual bundle is consistent with operator
    // expectations; the helper chooses the online backup API for cleartext
    // databases and keyed VACUUM INTO for encrypted databases.
    const result = await deps.runExclusiveBackupOperation(() =>
      deps.runWithServerRestart(async () => {
        await access(deps.dbPath);
        await ensureParentDirectoryExists(filePath);
        const deviceIdPath = getDeviceIdPath();
        const encryptionKey = await deps.resolveDatabaseEncryptionKey();
        if (passphrase !== undefined && encryptionKey === undefined) {
          // Silently dropping the phrase would let the operator
          // believe a cleartext backup is protected.
          throw new Error(t('backup.passphraseUnsupported'));
        }
        return createBackupBundle({
          dbPath: deps.dbPath,
          deviceIdPath,
          outZipPath: filePath,
          encryptionKey,
          ...(passphrase !== undefined && encryptionKey !== undefined ? { passphrase } : {}),
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
