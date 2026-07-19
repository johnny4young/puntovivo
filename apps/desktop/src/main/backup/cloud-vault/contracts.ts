import type { PutObjectCommandInput } from '@aws-sdk/client-s3';

export type BackupCloudVaultErrorCode =
  | 'configuration_invalid'
  | 'configuration_missing'
  | 'secure_storage_unavailable'
  | 'cloud_vault_unavailable'
  | 'connection_failed'
  | 'upload_failed'
  | 'operation_in_progress';

export type BackupCloudVaultLastError = 'connection_failed' | 'upload_failed' | null;

export interface BackupCloudVaultConfigInput {
  endpoint: string;
  region: string;
  bucket: string;
  prefix?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Validated internal config. It never crosses the preload boundary. */
export interface BackupCloudVaultSecretConfig {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface BackupCloudVaultRecord {
  tenantId: string;
  sealedConfig: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyHint: string;
  configuredAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastObjectKey: string | null;
  lastError: BackupCloudVaultLastError;
}

export interface BackupCloudVaultStatus {
  configured: boolean;
  secureStorageAvailable: boolean;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  prefix: string | null;
  forcePathStyle: boolean;
  accessKeyHint: string | null;
  configuredAt: string | null;
  updatedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastObjectKey: string | null;
  lastError: BackupCloudVaultLastError;
  inProgress: boolean;
}

export interface BackupCloudVaultOperationResult {
  success: boolean;
  skipped?: boolean;
  status: BackupCloudVaultStatus;
  objectKey?: string;
  error?: BackupCloudVaultErrorCode;
}

export interface BackupCloudVaultLog {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

export interface BackupCloudUploadRequest {
  config: BackupCloudVaultSecretConfig;
  objectKey: string;
  body: Exclude<PutObjectCommandInput['Body'], undefined>;
  contentLength: number;
  contentType: string;
}

export interface BackupCloudVault {
  getStatus(tenantId: string): Promise<BackupCloudVaultStatus>;
  configure(tenantId: string, input: BackupCloudVaultConfigInput): Promise<BackupCloudVaultStatus>;
  disconnect(tenantId: string): Promise<BackupCloudVaultStatus>;
  testConnection(tenantId: string): Promise<BackupCloudVaultOperationResult>;
  replicateSnapshot(input: {
    tenantId: string;
    zipPath: string;
  }): Promise<BackupCloudVaultOperationResult>;
}

export class BackupCloudVaultError extends Error {
  readonly code: BackupCloudVaultErrorCode;

  constructor(code: BackupCloudVaultErrorCode) {
    super(code);
    this.name = 'BackupCloudVaultError';
    this.code = code;
  }
}
