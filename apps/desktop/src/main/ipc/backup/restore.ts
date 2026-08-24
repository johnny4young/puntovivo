/**
 * validated restore, cross-device rekey, and pending-staging IPC flows.
 *
 * @module main/ipc/backup/restore
 */

import { app, dialog, type OpenDialogOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDeviceIdToDir } from '../../device-id-store.js';
import {
  assertSqliteIntegrity,
  clearAuditHeadAnchors,
  extractBackupBundle,
  isCleartextSqliteFile,
  rekeySqliteDatabase,
  unwrapBackupKey,
  verifyExtractedBundleAuthenticity,
  type ExtractBackupBundleResult,
} from '../../backup/backup-bundle.js';
import { t } from '../../i18n';
// read authenticated identity from the main-process singleton,
// never from renderer-supplied arguments.
import * as desktopSession from '../../session/desktopSession.js';
import type { BackupIpcDeps, DesktopDatabaseActionResult } from './contracts.js';
import { backupLog, ensureParentDirectoryExists, removeSqliteSidecars } from './runtime.js';

export async function handleRestoreDatabaseBackup(
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

  // VALIDATE the bundle BEFORE the swap. The integrity
  // check + format detection happens against an extracted staging
  // copy, so a corrupted file never touches the live DB.
  const stagingDir = await mkdtemp(join(tmpdir(), 'puntovivo-restore-'));
  let keepStaging = false;
  try {
    await access(selectedBackupPath);

    const extracted = await extractBackupBundle(selectedBackupPath, stagingDir);
    const encryptionKey = await deps.resolveDatabaseEncryptionKey();

    let openedWithLocalKey = false;
    try {
      await assertSqliteIntegrity(extracted.dbPath, { encryptionKey });
      openedWithLocalKey = true;
    } catch {
      // the staged DB does not open with THIS device's
      // key. Two legitimate shapes before giving up:
      // 1. A legacy pre-encryption bundle (cleartext): verify it
      // keyless and restore as-is — the one-shot migration on
      // the next boot encrypts it under the local key.
      // 2. A bundle from a DIFFERENT device: hold the staging copy
      // and ask the renderer to prompt for the source device's
      // backup key (completed via provideRestoreKey).
      if (await isCleartextSqliteFile(extracted.dbPath)) {
        await assertSqliteIntegrity(extracted.dbPath, {});
        // Symmetry with the foreign-key path: a hand-exported
        // plaintext copy of an anchored DB would otherwise carry
        // foreign head MACs into this install and read as tampering.
        clearAuditHeadAnchors(extracted.dbPath);
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
    }

    // Authenticity runs OUTSIDE the wrong-key try: an unexpected
    // verifier error must fail the restore loudly, never masquerade
    // as a foreign-key bundle and prompt for a key that does not
    // exist.
    let unauthenticated = false;
    if (openedWithLocalKey && encryptionKey !== undefined) {
      const authenticity = await verifyExtractedBundleAuthenticity({
        manifest: extracted.manifest,
        dbPath: extracted.dbPath,
        deviceIdPath: extracted.deviceIdPath,
        keyWrapRaw: extracted.keyWrapRaw,
        encryptionKey,
      });
      if (authenticity.status === 'failed') {
        backupLog.error(
          { source: selectedBackupPath, reason: authenticity.reason },
          'restore rejected: bundle failed authenticity verification'
        );
        return {
          success: false,
          cancelled: false,
          error: t('backup.restoreBundleTampered'),
        };
      }
      if (authenticity.status === 'legacy-unsigned') {
        unauthenticated = true;
        // schemaVersion >= 2 with no MAC is never produced
        // legitimately for an encrypted DB — warn so a stripped MAC
        // is distinguishable from a genuinely old bundle.
        backupLog.warn(
          {
            source: selectedBackupPath,
            schemaVersion: extracted.manifest?.schemaVersion ?? null,
          },
          'restore: bundle carries no verifiable manifest MAC; accepted as unauthenticated'
        );
      }
    }

    await swapRestoredDatabase(deps, extracted);

    backupLog.info({ source: selectedBackupPath, format: extracted.format }, 'backup restored');

    return {
      success: true,
      cancelled: false,
      path: selectedBackupPath,
      ...(unauthenticated ? { unauthenticated: true } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : t('backup.restoreFailed');
    backupLog.error({ err: error, source: selectedBackupPath }, 'failed to restore backup');
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
 * promote a validated staging DB into the live
 * location under a server restart, preserving the bundled device
 * identity when present. Shared by the direct restore path and the
 * foreign-key completion path (provideRestoreKey).
 */
async function swapRestoredDatabase(
  deps: BackupIpcDeps,
  extracted: ExtractBackupBundleResult
): Promise<void> {
  await deps.runExclusiveBackupOperation(() =>
    deps.runWithServerRestart(
      async () => {
        await ensureParentDirectoryExists(deps.dbPath);
        await removeSqliteSidecars(deps.dbPath);
        await copyFile(extracted.dbPath, deps.dbPath);
        await removeSqliteSidecars(deps.dbPath);

        // preserve the bundled device identity when present;
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
    )
  );
}

/**
 * single pending cross-device restore slot. Holding ONE
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
 * complete a cross-device restore with the SOURCE
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
export async function handleProvideRestoreKey(
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
  // The operator either pastes the source install's 64-hex key OR —
  // when the bundle carries a key-wrap — types the backup passphrase.
  // Anything that is not a hex key is treated as a passphrase attempt.
  const rawInput = typeof keyHex === 'string' ? keyHex.trim() : '';
  const isHexShaped = /^[0-9a-f]{64}$/i.test(rawInput);
  let foreignKey: string;
  let keyFromWrap = false;
  if (isHexShaped) {
    foreignKey = rawInput.toLowerCase();
  } else if (rawInput.length > 0 && pending.extracted.keyWrap) {
    const unwrapped = unwrapBackupKey(pending.extracted.keyWrap, rawInput);
    if (unwrapped === null) {
      return {
        success: false,
        cancelled: false,
        needsKey: true,
        token: pending.token,
        error: t('backup.restorePassphraseMismatch'),
      };
    }
    foreignKey = unwrapped.toLowerCase();
    keyFromWrap = true;
  } else if (rawInput.length > 0) {
    // Passphrase-shaped input against a bundle that carries no wrap:
    // say so, instead of scolding about hex shape.
    return {
      success: false,
      cancelled: false,
      needsKey: true,
      token: pending.token,
      error: t('backup.restoreNoPassphraseWrap'),
    };
  } else {
    return {
      success: false,
      cancelled: false,
      needsKey: true,
      token: pending.token,
      error: t('backup.restoreKeyInvalidShape'),
    };
  }

  let keepPending = false;
  try {
    try {
      await assertSqliteIntegrity(pending.extracted.dbPath, {
        encryptionKey: foreignKey,
      });
    } catch {
      // A hex-shaped input that fails as a raw key may actually BE the
      // passphrase (hex-charset password generators exist): try the
      // wrap before declaring a mismatch.
      if (isHexShaped && !keyFromWrap && pending.extracted.keyWrap) {
        const unwrapped = unwrapBackupKey(pending.extracted.keyWrap, rawInput);
        if (unwrapped !== null) {
          foreignKey = unwrapped.toLowerCase();
          keyFromWrap = true;
        }
      }
      if (!keyFromWrap) {
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
      try {
        await assertSqliteIntegrity(pending.extracted.dbPath, {
          encryptionKey: foreignKey,
        });
      } catch {
        // The passphrase authenticated (GCM verified the wrap) yet the
        // unwrapped key does not open the DB: the payload was swapped
        // or the wrap was repacked. That is tampering, not user error.
        backupLog.error(
          { source: pending.sourcePath },
          'cross-device restore rejected: wrapped key does not open the bundle database'
        );
        return {
          success: false,
          cancelled: false,
          error: t('backup.restoreBundleTampered'),
        };
      }
    }

    // The key opens the bundle: now the manifest MAC must ALSO hold
    // under it. A failure here is not a wrong key — it is an altered
    // or repackaged bundle, and the staging is discarded.
    const authenticity = await verifyExtractedBundleAuthenticity({
      manifest: pending.extracted.manifest,
      dbPath: pending.extracted.dbPath,
      deviceIdPath: pending.extracted.deviceIdPath,
      keyWrapRaw: pending.extracted.keyWrapRaw,
      encryptionKey: foreignKey,
    });
    if (authenticity.status === 'failed') {
      backupLog.error(
        { source: pending.sourcePath, reason: authenticity.reason },
        'cross-device restore rejected: bundle failed authenticity verification'
      );
      return {
        success: false,
        cancelled: false,
        error: t('backup.restoreBundleTampered'),
      };
    }
    const unauthenticated = authenticity.status === 'legacy-unsigned';
    if (unauthenticated) {
      backupLog.warn(
        {
          source: pending.sourcePath,
          schemaVersion: pending.extracted.manifest?.schemaVersion ?? null,
        },
        'restore: bundle carries no verifiable manifest MAC; accepted as unauthenticated'
      );
    }

    const localKey = await deps.resolveDatabaseEncryptionKey();
    rekeySqliteDatabase(pending.extracted.dbPath, {
      fromKey: foreignKey,
      toKey: localKey,
    });
    // The source install's audit head MACs cannot verify under this
    // install's anchor secret; clear them so the restored chain is
    // tolerated as unanchored and re-stamps on the next audit write.
    clearAuditHeadAnchors(pending.extracted.dbPath, localKey);
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
      ...(unauthenticated ? { unauthenticated: true } : {}),
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
 * discard the pending cross-device restore staging the
 * moment the operator dismisses the key prompt, instead of leaving
 * the staged copy in the tmpdir until the next restore attempt, the
 * app quit, or the startup sweep collects it. Admin-gated BEFORE the
 * token is even looked at (same hardening order as the sibling
 * handlers); a stale or foreign token is a silent no-op so a
 * duplicated prompt cannot discard a newer staging.
 */
export async function handleCancelRestoreStaging(token: unknown): Promise<{ success: boolean }> {
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
