/**
 * ENG-136c — device-local, per-tenant S3-compatible backup replication.
 *
 * Credentials are sealed with Electron safeStorage and never enter the
 * operational database or renderer. Focused helpers own validation, atomic
 * state persistence, and the provider transport; this module owns lifecycle
 * and the invariant that cloud failure never invalidates a local snapshot.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, posix } from 'node:path';
import type { SafeStorageLike } from '../db-key-store.ts';
import { backupTenantPathSegment } from './scheduler.ts';
import {
  backupCloudAccessKeyHint,
  isBackupCloudSecureStorageAvailable,
  normalizeBackupCloudVaultConfig,
} from './cloud-vault/config.ts';
import {
  BackupCloudVaultError,
  type BackupCloudUploadRequest,
  type BackupCloudVault,
  type BackupCloudVaultConfigInput,
  type BackupCloudVaultErrorCode,
  type BackupCloudVaultLog,
  type BackupCloudVaultOperationResult,
  type BackupCloudVaultRecord,
  type BackupCloudVaultSecretConfig,
  type BackupCloudVaultStatus,
} from './cloud-vault/contracts.ts';
import { createBackupCloudVaultStore } from './cloud-vault/store.ts';
import { uploadBackupCloudObject } from './cloud-vault/uploader.ts';

const CONNECTION_TEST_FILE = '.puntovivo-connection-test';

interface BackupCloudVaultDeps {
  getStatePath: () => string;
  safeStorage: SafeStorageLike;
  log: BackupCloudVaultLog;
  platform?: NodeJS.Platform;
  allowInsecureLoopback?: boolean;
  now?: () => Date;
  uploadObject?: (request: BackupCloudUploadRequest) => Promise<void>;
}

function statusFor(
  record: BackupCloudVaultRecord | undefined,
  secureStorageAvailable: boolean,
  inProgress: boolean
): BackupCloudVaultStatus {
  return {
    configured: Boolean(record),
    secureStorageAvailable,
    endpoint: record?.endpoint ?? null,
    region: record?.region ?? null,
    bucket: record?.bucket ?? null,
    prefix: record?.prefix ?? null,
    forcePathStyle: record?.forcePathStyle ?? false,
    accessKeyHint: record?.accessKeyHint ?? null,
    configuredAt: record?.configuredAt ?? null,
    updatedAt: record?.updatedAt ?? null,
    lastAttemptAt: record?.lastAttemptAt ?? null,
    lastSuccessAt: record?.lastSuccessAt ?? null,
    lastObjectKey: record?.lastObjectKey ?? null,
    lastError: record?.lastError ?? null,
    inProgress,
  };
}

function safeCode(error: unknown, fallback: BackupCloudVaultErrorCode): BackupCloudVaultErrorCode {
  return error instanceof BackupCloudVaultError ? error.code : fallback;
}

export function createBackupCloudVault(deps: BackupCloudVaultDeps): BackupCloudVault {
  const now = deps.now ?? (() => new Date());
  const platform = deps.platform ?? process.platform;
  const allowInsecureLoopback = deps.allowInsecureLoopback ?? false;
  const uploadObject = deps.uploadObject ?? uploadBackupCloudObject;
  const store = createBackupCloudVaultStore(deps.getStatePath);
  const inProgressTenants = new Set<string>();

  function secureStorageAvailable(): boolean {
    return isBackupCloudSecureStorageAvailable(deps.safeStorage, platform);
  }

  function requireSecureStorage(): void {
    if (!secureStorageAvailable()) {
      throw new BackupCloudVaultError('secure_storage_unavailable');
    }
  }

  function requireTenant(tenantId: string): void {
    if (tenantId.length === 0 || tenantId.length > 256) {
      throw new BackupCloudVaultError('configuration_invalid');
    }
  }

  async function getStatus(tenantId: string): Promise<BackupCloudVaultStatus> {
    requireTenant(tenantId);
    return statusFor(
      await store.readRecord(tenantId),
      secureStorageAvailable(),
      inProgressTenants.has(tenantId)
    );
  }

  async function configure(
    tenantId: string,
    input: BackupCloudVaultConfigInput
  ): Promise<BackupCloudVaultStatus> {
    requireTenant(tenantId);
    if (inProgressTenants.has(tenantId)) {
      throw new BackupCloudVaultError('operation_in_progress');
    }
    inProgressTenants.add(tenantId);
    try {
      requireSecureStorage();
      const config = normalizeBackupCloudVaultConfig(input, { allowInsecureLoopback });
      let sealedConfig: string;
      try {
        sealedConfig = deps.safeStorage.encryptString(JSON.stringify(config)).toString('base64');
      } catch {
        throw new BackupCloudVaultError('secure_storage_unavailable');
      }

      const updatedAt = now().toISOString();
      const record: BackupCloudVaultRecord = {
        tenantId,
        sealedConfig,
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        prefix: config.prefix,
        forcePathStyle: config.forcePathStyle,
        accessKeyHint: backupCloudAccessKeyHint(config.accessKeyId),
        configuredAt: updatedAt,
        updatedAt,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastObjectKey: null,
        lastError: null,
      };
      await store.mutate(vaults => {
        vaults[tenantId] = record;
      });
      deps.log.info({ tenantId }, 'backup cloud vault configured');
      return statusFor(record, true, false);
    } finally {
      inProgressTenants.delete(tenantId);
    }
  }

  async function disconnect(tenantId: string): Promise<BackupCloudVaultStatus> {
    requireTenant(tenantId);
    if (inProgressTenants.has(tenantId)) {
      throw new BackupCloudVaultError('operation_in_progress');
    }
    inProgressTenants.add(tenantId);
    try {
      await store.mutate(vaults => {
        delete vaults[tenantId];
      });
      deps.log.info({ tenantId }, 'backup cloud vault disconnected');
      return statusFor(undefined, secureStorageAvailable(), false);
    } finally {
      inProgressTenants.delete(tenantId);
    }
  }

  function decryptConfig(record: BackupCloudVaultRecord): BackupCloudVaultSecretConfig {
    requireSecureStorage();
    try {
      const plain = deps.safeStorage.decryptString(Buffer.from(record.sealedConfig, 'base64'));
      const parsed = JSON.parse(plain) as BackupCloudVaultConfigInput;
      return normalizeBackupCloudVaultConfig(parsed, { allowInsecureLoopback });
    } catch (error) {
      if (error instanceof BackupCloudVaultError) throw error;
      throw new BackupCloudVaultError('secure_storage_unavailable');
    }
  }

  async function runUpload(
    tenantId: string,
    errorCode: 'connection_failed' | 'upload_failed',
    makeRequest: (
      config: BackupCloudVaultSecretConfig
    ) => Promise<Omit<BackupCloudUploadRequest, 'config'>>
  ): Promise<BackupCloudVaultOperationResult> {
    requireTenant(tenantId);
    if (inProgressTenants.has(tenantId)) {
      return {
        success: false,
        status: await getStatus(tenantId),
        error: 'operation_in_progress',
      };
    }

    // Claim the tenant before the first await. Otherwise two writes started in
    // the same event-loop turn can both pass the guard while state is loading.
    inProgressTenants.add(tenantId);
    const attemptedAt = now().toISOString();
    let initial: BackupCloudVaultRecord | undefined;
    try {
      initial = await store.readRecord(tenantId);
      if (!initial) {
        return {
          success: false,
          skipped: true,
          status: statusFor(undefined, secureStorageAvailable(), false),
          error: 'configuration_missing',
        };
      }

      const config = decryptConfig(initial);
      const request = await makeRequest(config);
      await store.mutate(vaults => {
        const current = vaults[tenantId];
        if (!current) throw new BackupCloudVaultError('configuration_missing');
        current.lastAttemptAt = attemptedAt;
        current.lastError = null;
        current.updatedAt = attemptedAt;
      });
      await uploadObject({ ...request, config });
      const completedAt = now().toISOString();
      const record = await store.mutate(vaults => {
        const current = vaults[tenantId];
        if (!current) throw new BackupCloudVaultError('configuration_missing');
        current.lastSuccessAt = completedAt;
        current.lastObjectKey = request.objectKey;
        current.lastError = null;
        current.updatedAt = completedAt;
        return { ...current };
      });
      deps.log.info({ tenantId, objectKey: request.objectKey }, 'backup cloud write succeeded');
      return {
        success: true,
        status: statusFor(record, true, false),
        objectKey: request.objectKey,
      };
    } catch (error) {
      const code = safeCode(error, errorCode);
      let record = await store.readRecord(tenantId).catch(() => initial);
      if (code === errorCode && record) {
        record = await store
          .mutate(vaults => {
            const current = vaults[tenantId];
            if (!current) return initial;
            current.lastAttemptAt = attemptedAt;
            current.lastError = errorCode;
            current.updatedAt = now().toISOString();
            return { ...current };
          })
          .catch(() => record);
      }
      deps.log.warn({ tenantId, errorCode: code }, 'backup cloud write failed');
      return {
        success: false,
        status: statusFor(record, secureStorageAvailable(), false),
        error: code,
      };
    } finally {
      inProgressTenants.delete(tenantId);
    }
  }

  async function testConnection(tenantId: string): Promise<BackupCloudVaultOperationResult> {
    return runUpload(tenantId, 'connection_failed', async config => {
      const body = Buffer.from('Puntovivo cloud backup connection test\n', 'utf8');
      return {
        objectKey: posix.join(
          config.prefix,
          backupTenantPathSegment(tenantId),
          CONNECTION_TEST_FILE
        ),
        body,
        contentLength: body.byteLength,
        contentType: 'text/plain; charset=utf-8',
      };
    });
  }

  async function replicateSnapshot(input: {
    tenantId: string;
    zipPath: string;
  }): Promise<BackupCloudVaultOperationResult> {
    return runUpload(input.tenantId, 'upload_failed', async config => {
      const file = await stat(input.zipPath);
      if (!file.isFile()) throw new BackupCloudVaultError('upload_failed');
      return {
        objectKey: posix.join(
          config.prefix,
          backupTenantPathSegment(input.tenantId),
          basename(input.zipPath)
        ),
        body: createReadStream(input.zipPath),
        contentLength: file.size,
        contentType: 'application/zip',
      };
    });
  }

  return { getStatus, configure, disconnect, testConnection, replicateSnapshot };
}

export { normalizeBackupCloudVaultConfig } from './cloud-vault/config.ts';
export { BackupCloudVaultError } from './cloud-vault/contracts.ts';
export type {
  BackupCloudUploadRequest,
  BackupCloudVault,
  BackupCloudVaultConfigInput,
  BackupCloudVaultErrorCode,
  BackupCloudVaultLastError,
  BackupCloudVaultLog,
  BackupCloudVaultOperationResult,
  BackupCloudVaultStatus,
} from './cloud-vault/contracts.ts';
