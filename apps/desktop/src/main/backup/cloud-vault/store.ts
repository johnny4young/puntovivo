import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  BackupCloudVaultError,
  type BackupCloudVaultLastError,
  type BackupCloudVaultRecord,
} from './contracts.ts';

const STATE_SCHEMA_VERSION = 1;

interface BackupCloudVaultStateFile {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  vaults: Record<string, BackupCloudVaultRecord>;
}

export interface BackupCloudVaultStore {
  readRecord(tenantId: string): Promise<BackupCloudVaultRecord | undefined>;
  mutate<T>(change: (state: Record<string, BackupCloudVaultRecord>) => T | Promise<T>): Promise<T>;
}

function optionalIso(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function optionalObjectKey(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 1_024 ? value : null;
}

function emptyState(): BackupCloudVaultStateFile {
  return { schemaVersion: STATE_SCHEMA_VERSION, vaults: {} };
}

function isLastError(value: unknown): value is BackupCloudVaultLastError {
  return value === null || value === 'connection_failed' || value === 'upload_failed';
}

function normalizeRecord(value: unknown): BackupCloudVaultRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BackupCloudVaultRecord>;
  const configuredAt = optionalIso(candidate.configuredAt);
  const updatedAt = optionalIso(candidate.updatedAt);
  if (
    typeof candidate.tenantId !== 'string' ||
    candidate.tenantId.length === 0 ||
    typeof candidate.sealedConfig !== 'string' ||
    candidate.sealedConfig.length === 0 ||
    typeof candidate.endpoint !== 'string' ||
    typeof candidate.region !== 'string' ||
    typeof candidate.bucket !== 'string' ||
    typeof candidate.prefix !== 'string' ||
    typeof candidate.forcePathStyle !== 'boolean' ||
    typeof candidate.accessKeyHint !== 'string' ||
    !configuredAt ||
    !updatedAt ||
    !isLastError(candidate.lastError)
  ) {
    return null;
  }

  return {
    tenantId: candidate.tenantId,
    sealedConfig: candidate.sealedConfig,
    endpoint: candidate.endpoint,
    region: candidate.region,
    bucket: candidate.bucket,
    prefix: candidate.prefix,
    forcePathStyle: candidate.forcePathStyle,
    accessKeyHint: candidate.accessKeyHint,
    configuredAt,
    updatedAt,
    lastAttemptAt: optionalIso(candidate.lastAttemptAt),
    lastSuccessAt: optionalIso(candidate.lastSuccessAt),
    lastObjectKey: optionalObjectKey(candidate.lastObjectKey),
    lastError: candidate.lastError,
  };
}

async function loadState(path: string): Promise<BackupCloudVaultStateFile> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw new BackupCloudVaultError('cloud_vault_unavailable');
  }

  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new BackupCloudVaultError('cloud_vault_unavailable');
    }
    const candidate = parsed as Partial<BackupCloudVaultStateFile>;
    if (candidate.schemaVersion !== STATE_SCHEMA_VERSION || !candidate.vaults) {
      throw new BackupCloudVaultError('cloud_vault_unavailable');
    }

    const vaults: Record<string, BackupCloudVaultRecord> = {};
    for (const value of Object.values(candidate.vaults)) {
      const record = normalizeRecord(value);
      if (!record) throw new BackupCloudVaultError('cloud_vault_unavailable');
      vaults[record.tenantId] = record;
    }
    return { schemaVersion: STATE_SCHEMA_VERSION, vaults };
  } catch (error) {
    if (error instanceof BackupCloudVaultError) throw error;
    throw new BackupCloudVaultError('cloud_vault_unavailable');
  }
}

async function saveState(path: string, state: BackupCloudVaultStateFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch {
    throw new BackupCloudVaultError('cloud_vault_unavailable');
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function createBackupCloudVaultStore(getStatePath: () => string): BackupCloudVaultStore {
  let stateTail: Promise<void> = Promise.resolve();

  async function readRecord(tenantId: string): Promise<BackupCloudVaultRecord | undefined> {
    await stateTail;
    return (await loadState(getStatePath())).vaults[tenantId];
  }

  async function mutate<T>(
    change: (state: Record<string, BackupCloudVaultRecord>) => T | Promise<T>
  ): Promise<T> {
    const operation = stateTail.then(async () => {
      const state = await loadState(getStatePath());
      const result = await change(state.vaults);
      await saveState(getStatePath(), state);
      return result;
    });
    stateTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  return { readRecord, mutate };
}
