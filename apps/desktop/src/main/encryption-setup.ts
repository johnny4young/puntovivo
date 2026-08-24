/**
 * Electron database-path and SQLCipher bootstrap.
 *
 * Keeps every key-source and first-boot migration invariant together while
 * delaying path resolution until after index.ts pins the application name.
 */

import type { App, SafeStorage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PuntovivoLogger } from '@puntovivo/server';
import {
  resolveBackupProtectionStatus,
  type BackupProtectionStatus,
  type SafeStorageBackend,
} from './backup-protection.ts';
import { statSync } from 'node:fs';
import {
  AUDIT_ANCHOR_KEY_FILE,
  getDbKeyDir,
  getDbKeyEnvelopePath,
  getOrCreateDbKey,
} from './db-key-store.ts';
import {
  getDbKeyRotationStagingPath,
  resolvePendingDbKeyRotation,
  rotateDbKeyNow,
} from './db-key-rotation.ts';
import { migrateCleartextDatabase } from './db-migrate-encryption.ts';

export interface DbKeyRotationStatus {
  /** False for env-key installs (dev shared DB, E2E) that cannot rotate an envelope. */
  supported: boolean;
  /** A staged rotation is waiting for boot-time resolution. */
  pending: boolean;
  /** Last write of the canonical envelope (first boot OR last rotation). */
  envelopeUpdatedAt: string | null;
}

export interface EncryptionSetup {
  dbPath: string;
  devSharedDbPath: string | undefined;
  migrationsPath: string;
  resolveDatabaseEncryptionKey: () => Promise<string>;
  prepareDatabaseEncryption: () => Promise<string>;
  /**
   * Per-install audit-chain anchor secret. Deliberately NOT the
   * SQLCipher key: the DB key rotates, the anchor secret does not,
   * so rotating never invalidates stored audit head MACs.
   */
  resolveAuditAnchorKey: () => Promise<string>;
  getBackupProtectionStatus: () => BackupProtectionStatus;
  /** Offline key rotation; the caller stops the embedded server around it. */
  rotateDatabaseKey: () => Promise<void>;
  getKeyRotationStatus: () => DbKeyRotationStatus;
}

interface EncryptionSetupDeps {
  app: Pick<App, 'isPackaged' | 'getPath' | 'getAppPath'>;
  safeStorage: SafeStorage;
  log: PuntovivoLogger;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  resourcesPath?: string;
  platform?: NodeJS.Platform;
}

function resolveDevMigrationsPath(app: EncryptionSetupDeps['app'], cwd: string): string {
  const candidates = [
    join(app.getAppPath(), 'migrations'),
    join(
      app.getAppPath(),
      '..',
      '..',
      '..',
      '..',
      'packages',
      'server',
      'dist',
      'db',
      'migrations'
    ),
    join(app.getAppPath(), '..', '..', 'packages', 'server', 'dist', 'db', 'migrations'),
    join(cwd, 'packages', 'server', 'dist', 'db', 'migrations'),
  ];

  return (
    candidates.find(candidate => existsSync(join(candidate, 'meta', '_journal.json'))) ??
    candidates[0]!
  );
}

export function createEncryptionSetup({
  app,
  safeStorage,
  log,
  env = process.env,
  cwd = process.cwd(),
  resourcesPath = process.resourcesPath,
  platform = process.platform,
}: EncryptionSetupDeps): EncryptionSetup {
  // development may opt into the shared encrypted DB; packaged builds always
  // resolve under userData regardless of inherited shell variables.
  const devSharedDbPath = !app.isPackaged && env.DATABASE_URL ? env.DATABASE_URL : undefined;
  const dbPath = devSharedDbPath ?? join(app.getPath('userData'), 'data', 'local.db');
  // Packaged Drizzle resources versus the Rolldown development-bundle path.
  const migrationsPath = app.isPackaged
    ? join(resourcesPath, 'migrations')
    : resolveDevMigrationsPath(app, cwd);
  let cachedEncryptionKey: string | null = null;
  let keySource: 'environment' | 'safe_storage' | null = null;
  let prepared = false;

  function resolveTestOrDevDatabaseEncryptionKey(): string | undefined {
    const isE2e = env.PUNTOVIVO_E2E === '1';
    if (app.isPackaged && !isE2e) return undefined;
    if (!app.isPackaged && !isE2e && !devSharedDbPath) return undefined;

    const key = env.PUNTOVIVO_DB_KEY;
    if (key === undefined) {
      if (devSharedDbPath) {
        throw new Error(
          'Shared dev DB (DATABASE_URL) requires PUNTOVIVO_DB_KEY (64-character hex). ' +
            'pnpm dev:desktop injects both via the dev-launcher; set them together when ' +
            'launching electron-forge directly.'
        );
      }
      if (app.isPackaged && isE2e) {
        throw new Error('Packaged Electron E2E requires an ephemeral PUNTOVIVO_DB_KEY');
      }
      return undefined;
    }
    if (!/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error('PUNTOVIVO_DB_KEY must be a 64-character hex string in Electron test/dev');
    }
    return key;
  }

  async function resolveDatabaseEncryptionKey(): Promise<string> {
    if (cachedEncryptionKey) return cachedEncryptionKey;
    const testOrDevKey = resolveTestOrDevDatabaseEncryptionKey();
    if (testOrDevKey) {
      cachedEncryptionKey = testOrDevKey;
      keySource = 'environment';
    } else {
      // A crash-interrupted key rotation must converge BEFORE the
      // canonical envelope is read, or the recovered key could open
      // nothing.
      await resolvePendingDbKeyRotation({ dbPath, safeStorage, log });
      cachedEncryptionKey = await getOrCreateDbKey(getDbKeyDir(dbPath), safeStorage, {
        platform,
      });
      keySource = 'safe_storage';
    }
    return cachedEncryptionKey;
  }

  let cachedAnchorKey: string | null = null;

  async function resolveAuditAnchorKey(): Promise<string> {
    if (cachedAnchorKey) return cachedAnchorKey;
    // Ensure keySource is resolved first so env-key installs (dev
    // shared DB, E2E) reuse the stable env key instead of minting an
    // envelope next to a database they do not own.
    const encryptionKey = await resolveDatabaseEncryptionKey();
    if (keySource === 'environment') {
      cachedAnchorKey = encryptionKey;
    } else {
      cachedAnchorKey = await getOrCreateDbKey(getDbKeyDir(dbPath), safeStorage, {
        platform,
        fileName: AUDIT_ANCHOR_KEY_FILE,
      });
    }
    return cachedAnchorKey;
  }

  async function rotateDatabaseKey(): Promise<void> {
    const currentKey = await resolveDatabaseEncryptionKey();
    if (keySource !== 'safe_storage') {
      // Env-key installs (dev shared DB, E2E) have no envelope to
      // rotate; the closed code keeps diagnostics out of the renderer.
      throw new Error('DB_KEY_ROTATION_UNSUPPORTED');
    }
    const newKey = await rotateDbKeyNow({
      dbPath,
      safeStorage,
      currentKey,
      log,
      platform,
    });
    cachedEncryptionKey = newKey;
  }

  function getKeyRotationStatus(): DbKeyRotationStatus {
    const supported = keySource === 'safe_storage';
    let envelopeUpdatedAt: string | null = null;
    if (supported) {
      try {
        envelopeUpdatedAt = statSync(getDbKeyEnvelopePath(getDbKeyDir(dbPath))).mtime.toISOString();
      } catch {
        envelopeUpdatedAt = null;
      }
    }
    return {
      supported,
      pending: existsSync(getDbKeyRotationStagingPath(getDbKeyDir(dbPath))),
      envelopeUpdatedAt,
    };
  }

  async function prepareDatabaseEncryption(): Promise<string> {
    const encryptionKey = await resolveDatabaseEncryptionKey();
    // one-shot cleartext migration before createServer opens the DB.
    await migrateCleartextDatabase({
      dbPath,
      encryptionKey,
      skipReason: devSharedDbPath
        ? 'dev-shared DATABASE_URL database (already encrypted with the dev key)'
        : undefined,
      log,
    });
    prepared = true;
    return encryptionKey;
  }

  function getBackupProtectionStatus(): BackupProtectionStatus {
    let safeStorageBackend: SafeStorageBackend | undefined;
    if (platform === 'linux' && keySource === 'safe_storage') {
      try {
        safeStorageBackend = safeStorage.getSelectedStorageBackend();
      } catch {
        safeStorageBackend = 'unknown';
      }
    }

    return resolveBackupProtectionStatus({
      prepared,
      keySource,
      platform,
      safeStorageBackend,
    });
  }

  return {
    dbPath,
    devSharedDbPath,
    migrationsPath,
    resolveDatabaseEncryptionKey,
    prepareDatabaseEncryption,
    resolveAuditAnchorKey,
    getBackupProtectionStatus,
    rotateDatabaseKey,
    getKeyRotationStatus,
  };
}
