/** admin-gated S3-compatible backup vault IPC boundary. */

import { createModuleLogger } from '@puntovivo/server';
import {
  BackupCloudVaultError,
  type BackupCloudVaultConfigInput,
  type BackupCloudVaultErrorCode,
  type BackupCloudVaultStatus,
} from '../../backup/cloud-vault.ts';
import * as desktopSession from '../../session/desktopSession.ts';
import type { BackupIpcDeps } from './contracts.ts';

const backupCloudVaultLog = createModuleLogger('backup');

const CONFIG_KEYS = new Set([
  'endpoint',
  'region',
  'bucket',
  'prefix',
  'forcePathStyle',
  'accessKeyId',
  'secretAccessKey',
]);

export interface BackupCloudVaultResult {
  success: boolean;
  status?: BackupCloudVaultStatus;
  error?: BackupCloudVaultErrorCode;
}

function requireAdminTenant(): string {
  desktopSession.requireOneOfRoles(['admin']);
  return desktopSession.requireTenantId();
}

function parseConfig(input: unknown): BackupCloudVaultConfigInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BackupCloudVaultError('configuration_invalid');
  }
  const candidate = input as Record<string, unknown>;
  if (
    Object.keys(candidate).some(key => !CONFIG_KEYS.has(key)) ||
    typeof candidate.endpoint !== 'string' ||
    typeof candidate.region !== 'string' ||
    typeof candidate.bucket !== 'string' ||
    (candidate.prefix !== undefined && typeof candidate.prefix !== 'string') ||
    typeof candidate.forcePathStyle !== 'boolean' ||
    typeof candidate.accessKeyId !== 'string' ||
    typeof candidate.secretAccessKey !== 'string'
  ) {
    throw new BackupCloudVaultError('configuration_invalid');
  }

  return {
    endpoint: candidate.endpoint,
    region: candidate.region,
    bucket: candidate.bucket,
    ...(candidate.prefix === undefined ? {} : { prefix: candidate.prefix }),
    forcePathStyle: candidate.forcePathStyle,
    accessKeyId: candidate.accessKeyId,
    secretAccessKey: candidate.secretAccessKey,
  };
}

function errorCode(error: unknown): BackupCloudVaultErrorCode {
  return error instanceof BackupCloudVaultError ? error.code : 'cloud_vault_unavailable';
}

export async function handleGetBackupCloudVaultStatus(
  deps: BackupIpcDeps
): Promise<BackupCloudVaultResult> {
  const tenantId = requireAdminTenant();
  try {
    return { success: true, status: await deps.backupCloudVault.getStatus(tenantId) };
  } catch (error) {
    const code = errorCode(error);
    backupCloudVaultLog.warn({ tenantId, errorCode: code }, 'failed to read backup cloud vault');
    return { success: false, error: code };
  }
}

export async function handleConfigureBackupCloudVault(
  deps: BackupIpcDeps,
  input: unknown
): Promise<BackupCloudVaultResult> {
  const tenantId = requireAdminTenant();
  try {
    const config = parseConfig(input);
    return {
      success: true,
      status: await deps.backupCloudVault.configure(tenantId, config),
    };
  } catch (error) {
    const code = errorCode(error);
    backupCloudVaultLog.warn(
      { tenantId, errorCode: code },
      'failed to configure backup cloud vault'
    );
    return { success: false, error: code };
  }
}

export async function handleDisconnectBackupCloudVault(
  deps: BackupIpcDeps
): Promise<BackupCloudVaultResult> {
  const tenantId = requireAdminTenant();
  try {
    return {
      success: true,
      status: await deps.backupCloudVault.disconnect(tenantId),
    };
  } catch (error) {
    const code = errorCode(error);
    backupCloudVaultLog.warn(
      { tenantId, errorCode: code },
      'failed to disconnect backup cloud vault'
    );
    return { success: false, error: code };
  }
}

export async function handleTestBackupCloudVault(
  deps: BackupIpcDeps
): Promise<BackupCloudVaultResult> {
  const tenantId = requireAdminTenant();
  try {
    const result = await deps.backupCloudVault.testConnection(tenantId);
    return result.success
      ? { success: true, status: result.status }
      : {
          success: false,
          status: result.status,
          error: result.error ?? 'cloud_vault_unavailable',
        };
  } catch (error) {
    const code = errorCode(error);
    backupCloudVaultLog.warn({ tenantId, errorCode: code }, 'failed to test backup cloud vault');
    return { success: false, error: code };
  }
}
