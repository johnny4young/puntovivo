import type { SafeStorageLike } from '../../db-key-store.ts';
import {
  BackupCloudVaultError,
  type BackupCloudVaultConfigInput,
  type BackupCloudVaultSecretConfig,
} from './contracts.ts';

const DEFAULT_PREFIX = 'puntovivo-backups';
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_PREFIX_LENGTH = 256;
const MAX_CREDENTIAL_LENGTH = 1_024;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function normalizeEndpoint(value: string, allowInsecureLoopback: boolean): string {
  if (value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) {
    throw new BackupCloudVaultError('configuration_invalid');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new BackupCloudVaultError('configuration_invalid');
  }

  const insecureLoopback =
    endpoint.protocol === 'http:' && allowInsecureLoopback && isLoopbackHostname(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !insecureLoopback) {
    throw new BackupCloudVaultError('configuration_invalid');
  }
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !endpoint.hostname
  ) {
    throw new BackupCloudVaultError('configuration_invalid');
  }

  return endpoint.toString().replace(/\/$/, '');
}

function normalizePrefix(value: string | undefined): string {
  const candidate = (value ?? DEFAULT_PREFIX).trim().replace(/^\/+|\/+$/g, '');
  if (
    candidate.length === 0 ||
    candidate.length > MAX_PREFIX_LENGTH ||
    candidate.includes('\\') ||
    hasControlCharacters(candidate) ||
    candidate.split('/').some(segment => segment === '.' || segment === '..' || !segment)
  ) {
    throw new BackupCloudVaultError('configuration_invalid');
  }
  return candidate;
}

export function normalizeBackupCloudVaultConfig(
  input: BackupCloudVaultConfigInput,
  { allowInsecureLoopback = false }: { allowInsecureLoopback?: boolean } = {}
): BackupCloudVaultSecretConfig {
  const region = input.region.trim();
  const bucket = input.bucket.trim();
  const accessKeyId = input.accessKeyId.trim();
  const secretAccessKey = input.secretAccessKey;

  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(region)) {
    throw new BackupCloudVaultError('configuration_invalid');
  }
  if (
    bucket.length < 3 ||
    bucket.length > 255 ||
    !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i.test(bucket) ||
    hasControlCharacters(bucket)
  ) {
    throw new BackupCloudVaultError('configuration_invalid');
  }
  if (
    accessKeyId.length < 3 ||
    accessKeyId.length > MAX_CREDENTIAL_LENGTH ||
    /\s/.test(accessKeyId) ||
    hasControlCharacters(accessKeyId) ||
    secretAccessKey.length < 8 ||
    secretAccessKey.length > MAX_CREDENTIAL_LENGTH ||
    hasControlCharacters(secretAccessKey)
  ) {
    throw new BackupCloudVaultError('configuration_invalid');
  }

  return {
    endpoint: normalizeEndpoint(input.endpoint.trim(), allowInsecureLoopback),
    region,
    bucket,
    prefix: normalizePrefix(input.prefix),
    forcePathStyle: input.forcePathStyle,
    accessKeyId,
    secretAccessKey,
  };
}

export function backupCloudAccessKeyHint(accessKeyId: string): string {
  // Never reveal the whole identifier when an S3-compatible provider accepts
  // a short access key. Long identifiers retain the familiar last-four hint.
  const visibleLength = Math.min(4, Math.max(1, accessKeyId.length - 1));
  return `••••${accessKeyId.slice(-visibleLength)}`;
}

export function isBackupCloudSecureStorageAvailable(
  safeStorage: SafeStorageLike,
  platform: NodeJS.Platform
): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return !(platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text');
  } catch {
    return false;
  }
}
