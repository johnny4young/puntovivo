/**
 * ENG-201 — Electron database-path and SQLCipher bootstrap.
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
import { getDbKeyDir, getOrCreateDbKey } from './db-key-store.ts';
import { migrateCleartextDatabase } from './db-migrate-encryption.ts';

export interface EncryptionSetup {
  dbPath: string;
  devSharedDbPath: string | undefined;
  migrationsPath: string;
  resolveDatabaseEncryptionKey: () => Promise<string>;
  prepareDatabaseEncryption: () => Promise<string>;
  getBackupProtectionStatus: () => BackupProtectionStatus;
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
  // ENG-167 — development may opt into the shared encrypted DB; packaged builds always
  // resolve under userData regardless of inherited shell variables.
  const devSharedDbPath = !app.isPackaged && env.DATABASE_URL ? env.DATABASE_URL : undefined;
  const dbPath = devSharedDbPath ?? join(app.getPath('userData'), 'data', 'local.db');
  // ENG-002 / ENG-026 — packaged Drizzle resources vs Rolldown dev-bundle path.
  const migrationsPath = app.isPackaged
    ? join(resourcesPath, 'migrations')
    : resolveDevMigrationsPath(app, cwd);
  let cachedEncryptionKey: string | null = null;
  let keySource: 'environment' | 'safe_storage' | null = null;
  let prepared = false;

  function resolveDevDatabaseEncryptionKey(): string | undefined {
    if (app.isPackaged) return undefined;

    const isE2e = env.PUNTOVIVO_E2E === '1';
    if (!isE2e && !devSharedDbPath) return undefined;

    const key = env.PUNTOVIVO_DB_KEY;
    if (key === undefined) {
      if (devSharedDbPath) {
        throw new Error(
          'Shared dev DB (DATABASE_URL) requires PUNTOVIVO_DB_KEY (64-character hex). ' +
            'pnpm dev:desktop injects both via the dev-launcher; set them together when ' +
            'launching electron-forge directly.'
        );
      }
      return undefined;
    }
    if (!/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error('PUNTOVIVO_DB_KEY must be a 64-character hex string in Electron dev');
    }
    return key;
  }

  async function resolveDatabaseEncryptionKey(): Promise<string> {
    if (cachedEncryptionKey) return cachedEncryptionKey;
    const devKey = resolveDevDatabaseEncryptionKey();
    if (devKey) {
      cachedEncryptionKey = devKey;
      keySource = 'environment';
    } else {
      cachedEncryptionKey = await getOrCreateDbKey(getDbKeyDir(dbPath), safeStorage, {
        platform,
      });
      keySource = 'safe_storage';
    }
    return cachedEncryptionKey;
  }

  async function prepareDatabaseEncryption(): Promise<string> {
    const encryptionKey = await resolveDatabaseEncryptionKey();
    // ENG-167b — one-shot cleartext migration before createServer opens the DB.
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
    getBackupProtectionStatus,
  };
}
