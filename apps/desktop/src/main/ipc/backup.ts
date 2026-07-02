/**
 * ENG-178 — desktop backup/restore IPC handlers, extracted verbatim from
 * the former monolithic `main/index.ts`.
 *
 * Owns the ENG-066 backup-bundle create/restore flows, the ENG-167b
 * cross-device restore completion (pending-restore staging slot + rekey)
 * and the admin backup-key reveal. Main-process state that must remain
 * owned by `main/index.ts` (the live DB path, the encryption-key cache,
 * the embedded-server restart choreography, the main window) is injected
 * through {@link BackupIpcDeps} so no import cycle points back at
 * index.ts.
 *
 * @module main/ipc/backup
 */

import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEVICE_ID_FILENAME, writeDeviceIdToDir } from '../device-id-store.js';
import {
  createBackupBundle,
  createBackupFileName as createBackupZipFileName,
  extractBackupBundle,
  assertSqliteIntegrity,
  // ENG-167b — cleartext detection + in-place rekey for the
  // cross-device restore completion path.
  isCleartextSqliteFile,
  rekeySqliteDatabase,
  type ExtractBackupBundleResult,
} from '../backup/backup-bundle.js';
import { createModuleLogger } from '@puntovivo/server';
import { t } from '../i18n';
// ENG-025 — the admin role-gate on every backup/restore surface reads the
// authenticated identity from the desktopSession singleton, never from a
// renderer-supplied argument.
import * as desktopSession from '../session/desktopSession.js';

// ENG-006 — `backup` is one of the frequent-error surfaces split out of
// `electron-main` so operators can filter the stream by module=backup
// without additional tagging.
const backupLog = createModuleLogger('backup');

export interface DesktopDatabaseActionResult {
  success: boolean;
  cancelled: boolean;
  path?: string;
  /**
   * ENG-066 — bytes of the produced backup ZIP. Existing renderer callers
   * can ignore it; future toasts/diagnostics may surface it.
   */
  sizeBytes?: number;
  error?: string;
  /**
   * ENG-167b — the selected bundle is encrypted with a DIFFERENT
   * device's key. The staging copy is held server-side under `token`;
   * the renderer prompts the operator for the source device's backup
   * key and completes the restore via `provideRestoreKey(token, key)`.
   */
  needsKey?: boolean;
  token?: string;
}

export interface BackupIpcDeps {
  /** Absolute path of the live encrypted SQLite database. */
  dbPath: string;
  /** Live main window (or null) — parents the native save/open dialogs. */
  getMainWindow: () => BrowserWindow | null;
  /**
   * ENG-167 — resolves (and caches) this install's SQLCipher key from the
   * safeStorage envelope; owned by index.ts because the embedded-server
   * boot shares the same cache.
   */
  resolveDatabaseEncryptionKey: () => Promise<string>;
  /**
   * Stops the embedded server, runs `operation`, then restarts the server
   * (optionally reloading the renderer). Owned by index.ts because it
   * drives the server lifecycle.
   */
  runWithServerRestart: <T>(
    operation: () => Promise<T>,
    options?: { reloadWindow?: boolean }
  ) => Promise<T>;
}

const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

/**
 * Resolves to `${userData}/device-id.txt`. Backup bundles include
 * this file so device identity travels with the data: a full-disk
 * failure can restore the device on new hardware AS the same logical
 * device from the server's perspective (per ADR-0001 + ADR-0006).
 */
function getDeviceIdPath(): string {
  return join(app.getPath('userData'), DEVICE_ID_FILENAME);
}

async function ensureParentDirectoryExists(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function removeSqliteSidecars(dbPath: string): Promise<void> {
  await Promise.all(
    SQLITE_SIDECAR_SUFFIXES.map(async suffix => {
      try {
        await rm(`${dbPath}${suffix}`);
      } catch (error) {
        const maybeFsError = error as NodeJS.ErrnoException;
        if (maybeFsError.code !== 'ENOENT') {
          throw error;
        }
      }
    })
  );
}

async function handleCreateDatabaseBackup(
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
    // ENG-066 — atomic backup via SQLite online backup API. The
    // server is stopped first so the backup bundle is consistent
    // with operator expectations even though `db.backup()` is safe
    // under concurrent writes.
    const result = await deps.runWithServerRestart(async () => {
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
    });

    backupLog.info(
      { zipPath: result.zipPath, zipBytes: result.zipBytes },
      'backup created'
    );

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

async function handleRestoreDatabaseBackup(
  deps: BackupIpcDeps
): Promise<DesktopDatabaseActionResult> {
  desktopSession.requireOneOfRoles(['admin']);
  const mainWindow = deps.getMainWindow();
  const openDialogOptions: OpenDialogOptions = {
    title: t('backup.restoreDialogTitle'),
    properties: ['openFile'],
    filters: [
      {
        name: t('backup.fileFilterName'),
        // Accept legacy raw `.db` AND the new ZIP bundle.
        extensions: ['zip', 'db', 'sqlite', 'sqlite3'],
      },
    ],
  };
  const { canceled, filePaths } = mainWindow
    ? await dialog.showOpenDialog(mainWindow, openDialogOptions)
    : await dialog.showOpenDialog(openDialogOptions);

  const selectedBackupPath = filePaths[0];
  if (canceled || !selectedBackupPath) {
    return {
      success: false,
      cancelled: true,
    };
  }

  // ENG-066 — VALIDATE the bundle BEFORE the swap. The integrity
  // check + format detection happens against an extracted staging
  // copy, so a corrupted file never touches the live DB.
  const stagingDir = await mkdtemp(join(tmpdir(), 'puntovivo-restore-'));
  let keepStaging = false;
  try {
    await access(selectedBackupPath);

    const extracted = await extractBackupBundle(selectedBackupPath, stagingDir);
    const encryptionKey = await deps.resolveDatabaseEncryptionKey();

    try {
      await assertSqliteIntegrity(extracted.dbPath, { encryptionKey });
    } catch (localKeyError) {
      // ENG-167b — the staged DB does not open with THIS device's
      // key. Two legitimate shapes before giving up:
      //   1. A legacy pre-encryption bundle (cleartext): verify it
      //      keyless and restore as-is — the one-shot migration on
      //      the next boot encrypts it under the local key.
      //   2. A bundle from a DIFFERENT device: hold the staging copy
      //      and ask the renderer to prompt for the source device's
      //      backup key (completed via provideRestoreKey).
      if (await isCleartextSqliteFile(extracted.dbPath)) {
        await assertSqliteIntegrity(extracted.dbPath, {});
        backupLog.info(
          { source: selectedBackupPath },
          'restore: legacy cleartext bundle accepted; next boot will encrypt it'
        );
      } else {
        keepStaging = true;
        const token = await stashPendingRestore(stagingDir, extracted, selectedBackupPath);
        backupLog.info(
          { source: selectedBackupPath },
          'restore: bundle is encrypted with a foreign key; prompting for it'
        );
        return {
          success: false,
          cancelled: false,
          needsKey: true,
          token,
        };
      }
      void localKeyError;
    }

    await swapRestoredDatabase(deps, extracted);

    backupLog.info(
      { source: selectedBackupPath, format: extracted.format },
      'backup restored'
    );

    return {
      success: true,
      cancelled: false,
      path: selectedBackupPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : t('backup.restoreFailed');
    backupLog.error(
      { err: error, source: selectedBackupPath },
      'failed to restore backup'
    );
    return {
      success: false,
      cancelled: false,
      error: message,
    };
  } finally {
    if (!keepStaging) {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }
}

/**
 * ENG-066/167b — promote a validated staging DB into the live
 * location under a server restart, preserving the bundled device
 * identity when present. Shared by the direct restore path and the
 * foreign-key completion path (provideRestoreKey).
 */
async function swapRestoredDatabase(
  deps: BackupIpcDeps,
  extracted: ExtractBackupBundleResult
): Promise<void> {
  await deps.runWithServerRestart(
    async () => {
      await ensureParentDirectoryExists(deps.dbPath);
      await removeSqliteSidecars(deps.dbPath);
      await copyFile(extracted.dbPath, deps.dbPath);
      await removeSqliteSidecars(deps.dbPath);

      // ENG-066 — preserve the bundled device identity when present;
      // legacy raw `.db` restores keep the destination identity
      // since the bundle didn't carry one.
      if (extracted.deviceIdPath) {
        try {
          const deviceId = (await readFile(extracted.deviceIdPath, 'utf8')).trim();
          if (deviceId) {
            await writeDeviceIdToDir(app.getPath('userData'), deviceId);
          }
        } catch (err) {
          backupLog.warn(
            { err },
            'restore: failed to preserve device-id from bundle; keeping destination identity'
          );
        }
      }
    },
    { reloadWindow: true }
  );
}

/**
 * ENG-167b — single pending cross-device restore slot. Holding ONE
 * staging at a time is deliberate: the restore flow is operator-
 * driven and modal; a new restore invocation discards any previous
 * pending staging. The token is an opaque random id the renderer
 * must echo back so a stale/duplicated prompt cannot complete
 * someone else's staging.
 */
interface PendingRestore {
  token: string;
  stagingDir: string;
  extracted: ExtractBackupBundleResult;
  sourcePath: string;
}

let pendingRestore: PendingRestore | null = null;

async function stashPendingRestore(
  stagingDir: string,
  extracted: ExtractBackupBundleResult,
  sourcePath: string
): Promise<string> {
  await clearPendingRestore();
  const token = randomUUID();
  pendingRestore = { token, stagingDir, extracted, sourcePath };
  return token;
}

export async function clearPendingRestore(): Promise<void> {
  if (!pendingRestore) return;
  const stale = pendingRestore;
  pendingRestore = null;
  await rm(stale.stagingDir, { recursive: true, force: true });
}

/**
 * ENG-167b — complete a cross-device restore with the SOURCE
 * device's backup key. Validates the staged DB with the foreign key,
 * rekeys it IN STAGING to this device's key (every install keeps
 * exactly one key envelope — the threat model does not change), and
 * promotes it through the same swap path as a direct restore.
 *
 * A wrong key returns a retryable error WITHOUT discarding the
 * staging; an invalid token or key shape discards nothing either —
 * only a successful completion (or a new restore invocation) clears
 * the slot.
 */
async function handleProvideRestoreKey(
  deps: BackupIpcDeps,
  token: unknown,
  keyHex: unknown
): Promise<DesktopDatabaseActionResult> {
  desktopSession.requireOneOfRoles(['admin']);

  // Snapshot the slot ONCE so every later read (shape-error token,
  // integrity check, finally guard) sees the same pending restore
  // even if the module slot is concurrently replaced.
  const pending = pendingRestore;
  if (!pending || typeof token !== 'string' || token !== pending.token) {
    return {
      success: false,
      cancelled: false,
      error: t('backup.restoreKeyNoPending'),
    };
  }
  if (typeof keyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(keyHex.trim())) {
    return {
      success: false,
      cancelled: false,
      needsKey: true,
      token: pending.token,
      error: t('backup.restoreKeyInvalidShape'),
    };
  }

  const foreignKey = keyHex.trim().toLowerCase();
  let keepPending = false;
  try {
    try {
      await assertSqliteIntegrity(pending.extracted.dbPath, {
        encryptionKey: foreignKey,
      });
    } catch {
      // Wrong key for this bundle — keep the staging, let the
      // operator retry with a corrected key.
      keepPending = true;
      return {
        success: false,
        cancelled: false,
        needsKey: true,
        token: pending.token,
        error: t('backup.restoreKeyMismatch'),
      };
    }

    const localKey = await deps.resolveDatabaseEncryptionKey();
    rekeySqliteDatabase(pending.extracted.dbPath, {
      fromKey: foreignKey,
      toKey: localKey,
    });
    await assertSqliteIntegrity(pending.extracted.dbPath, {
      encryptionKey: localKey,
    });

    await swapRestoredDatabase(deps, pending.extracted);
    backupLog.info(
      { source: pending.sourcePath },
      'cross-device backup restored and rekeyed to the local key'
    );
    return {
      success: true,
      cancelled: false,
      path: pending.sourcePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : t('backup.restoreFailed');
    backupLog.error(
      { err: error, source: pending.sourcePath },
      'failed to complete cross-device restore'
    );
    return { success: false, cancelled: false, error: message };
  } finally {
    // Success or hard failure drops the staging; the wrong-key retry
    // path (keepPending) and the pre-try bad-shape return keep it.
    if (!keepPending && pendingRestore === pending) {
      await clearPendingRestore();
    }
  }
}

/**
 * ENG-167b — discard the pending cross-device restore staging the
 * moment the operator dismisses the key prompt, instead of leaving
 * the staged copy in the tmpdir until the next restore attempt, the
 * app quit, or the startup sweep collects it. Admin-gated BEFORE the
 * token is even looked at (same hardening order as the sibling
 * handlers); a stale or foreign token is a silent no-op so a
 * duplicated prompt cannot discard a newer staging.
 */
async function handleCancelRestoreStaging(token: unknown): Promise<{ success: boolean }> {
  desktopSession.requireOneOfRoles(['admin']);
  const pending = pendingRestore;
  if (!pending || typeof token !== 'string' || token !== pending.token) {
    return { success: false };
  }
  await clearPendingRestore();
  backupLog.info(
    { source: pending.sourcePath },
    'pending cross-device restore discarded by the operator'
  );
  return { success: true };
}

/**
 * ENG-167b — reveal this install's backup encryption key so the
 * operator can restore its bundles on ANOTHER device. Admin-only;
 * the renderer gates the reveal behind an explicit confirmation with
 * a strong warning (docs/SECURITY.md documents the trade-off: the
 * key is the at-rest secret — whoever holds it can read the
 * backups). The key never leaves the machine through any other
 * channel.
 */
async function handleGetBackupEncryptionKey(deps: BackupIpcDeps): Promise<{
  success: boolean;
  key?: string;
  error?: string;
}> {
  desktopSession.requireOneOfRoles(['admin']);
  try {
    const key = await deps.resolveDatabaseEncryptionKey();
    backupLog.info({}, 'backup encryption key revealed to admin');
    return { success: true, key };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerBackupIpc(deps: BackupIpcDeps): void {
  ipcMain.handle('create-database-backup', () => handleCreateDatabaseBackup(deps));
  ipcMain.handle('restore-database-backup', () => handleRestoreDatabaseBackup(deps));
  // ENG-167b — cross-device restore completion + admin key reveal.
  ipcMain.handle('provide-restore-key', (_event, token: unknown, keyHex: unknown) =>
    handleProvideRestoreKey(deps, token, keyHex)
  );
  ipcMain.handle('cancel-restore-staging', (_event, token: unknown) =>
    handleCancelRestoreStaging(token)
  );
  ipcMain.handle('get-backup-encryption-key', () => handleGetBackupEncryptionKey(deps));
}
