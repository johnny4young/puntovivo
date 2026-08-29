/** Persist installed-version history and downloaded update metadata. */

import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { compareUpdateVersions } from './update-policy.ts';

export interface DownloadedUpdateRecord {
  version: string;
  artifactSha512: string;
  downloadedAt: string;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  updateUrl: string | null;
}

interface UpdateHistoryRecordV1 {
  schemaVersion: 1;
  version: string;
  updatedAt: string | null;
}

interface UpdateHistoryRecord {
  schemaVersion: 2;
  version: string;
  updatedAt: string | null;
  downloaded: DownloadedUpdateRecord | null;
}

export interface UpdateHistoryResult extends UpdateHistoryRecord {
  changed: boolean;
  recovered: boolean;
  migrated: boolean;
}

function isArtifactSha512(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(value);
}

/**
 * A same-version artifact must keep the exact persisted identity; a later
 * release may supersede it, but an older event cannot replace newer metadata.
 */
export function canAcceptDownloadedArtifact(
  persisted: DownloadedUpdateRecord | null,
  candidate: Pick<DownloadedUpdateRecord, 'version' | 'artifactSha512'>
): boolean {
  if (!isArtifactSha512(candidate.artifactSha512)) return false;
  if (!persisted) return true;
  const precedence = compareUpdateVersions(candidate.version, persisted.version);
  if (precedence < 0) return false;
  return precedence > 0 || candidate.artifactSha512 === persisted.artifactSha512;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isBoundedNullableString(value: unknown, maxLength: number): value is string | null {
  return isNullableString(value) && (value === null || value.length <= maxLength);
}

function isSafeUpdateUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 2_048) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseDownloaded(value: unknown): DownloadedUpdateRecord | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.join(',') !==
      'artifactSha512,downloadedAt,releaseDate,releaseName,releaseNotes,updateUrl,version' ||
    typeof record.version !== 'string' ||
    !isArtifactSha512(record.artifactSha512) ||
    !isTimestamp(record.downloadedAt) ||
    !isBoundedNullableString(record.releaseName, 256) ||
    !isBoundedNullableString(record.releaseNotes, 32_768) ||
    !isNullableString(record.releaseDate) ||
    !isSafeUpdateUrl(record.updateUrl)
  ) {
    return undefined;
  }
  try {
    compareUpdateVersions(record.version, record.version);
  } catch {
    return undefined;
  }
  if (record.releaseDate !== null && !isTimestamp(record.releaseDate)) return undefined;
  return {
    version: record.version,
    artifactSha512: record.artifactSha512,
    downloadedAt: record.downloadedAt,
    releaseName: record.releaseName,
    releaseNotes: record.releaseNotes,
    releaseDate: record.releaseDate,
    updateUrl: record.updateUrl,
  };
}

function parseRecord(value: unknown): UpdateHistoryRecord | UpdateHistoryRecordV1 | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== 'string') return null;
  if (record.updatedAt !== null && !isTimestamp(record.updatedAt)) return null;
  try {
    compareUpdateVersions(record.version, record.version);
  } catch {
    return null;
  }
  if (record.schemaVersion === 1) {
    if (Object.keys(record).sort().join(',') !== 'schemaVersion,updatedAt,version') return null;
    return {
      schemaVersion: 1,
      version: record.version,
      updatedAt: record.updatedAt as string | null,
    };
  }
  if (record.schemaVersion !== 2) return null;
  if (Object.keys(record).sort().join(',') !== 'downloaded,schemaVersion,updatedAt,version') {
    return null;
  }
  const downloaded = parseDownloaded(record.downloaded);
  if (downloaded === undefined) return null;
  return {
    schemaVersion: 2,
    version: record.version,
    updatedAt: record.updatedAt as string | null,
    downloaded,
  };
}

function readRecord(filePath: string): {
  record: UpdateHistoryRecord | UpdateHistoryRecordV1 | null;
  recovered: boolean;
} {
  try {
    const parsed = parseRecord(JSON.parse(readFileSync(filePath, 'utf8')));
    return { record: parsed, recovered: parsed === null };
  } catch (error) {
    const missing =
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
    return { record: null, recovered: !missing };
  }
}

function writeRecord(filePath: string, record: UpdateHistoryRecord): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const persisted: UpdateHistoryRecord = {
    schemaVersion: 2,
    version: record.version,
    updatedAt: record.updatedAt,
    downloaded: record.downloaded,
  };
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 });
    try {
      chmodSync(temporaryPath, 0o600);
    } catch {
      // Windows ACLs own access control.
    }
    const file = openSync(temporaryPath, 'r');
    try {
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(temporaryPath, filePath);
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(filePath), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function normalizeRecord(
  record: UpdateHistoryRecord | UpdateHistoryRecordV1 | null,
  currentVersion: string,
  recovered: boolean,
  now: () => Date
): UpdateHistoryResult {
  if (!record) {
    const baseline: UpdateHistoryRecord = {
      schemaVersion: 2,
      version: currentVersion,
      updatedAt: null,
      downloaded: null,
    };
    return { ...baseline, changed: false, recovered, migrated: false };
  }
  const migrated = record.schemaVersion === 1;
  const downloaded = record.schemaVersion === 2 ? record.downloaded : null;
  if (record.version === currentVersion) {
    return {
      schemaVersion: 2,
      version: record.version,
      updatedAt: record.updatedAt,
      downloaded:
        downloaded && compareUpdateVersions(downloaded.version, currentVersion) > 0
          ? downloaded
          : null,
      changed: false,
      recovered: false,
      migrated,
    };
  }
  return {
    schemaVersion: 2,
    version: currentVersion,
    updatedAt: now().toISOString(),
    downloaded: null,
    changed: true,
    recovered: false,
    migrated,
  };
}

/**
 * First boot establishes a baseline without inventing an install timestamp.
 * A later version change records the transition and clears stale downloads.
 */
export function recordVersionTransition(
  filePath: string,
  currentVersion: string,
  now: () => Date = () => new Date()
): UpdateHistoryResult {
  compareUpdateVersions(currentVersion, currentVersion);
  const { record, recovered } = readRecord(filePath);
  const result = normalizeRecord(record, currentVersion, recovered, now);
  if (!record || result.changed || result.recovered || result.migrated) {
    writeRecord(filePath, result);
  } else if (record.schemaVersion === 2 && record.downloaded !== result.downloaded) {
    writeRecord(filePath, result);
  }
  return result;
}

/** Persist metadata only after electron-updater confirms the full artifact. */
export function recordDownloadedUpdate(
  filePath: string,
  currentVersion: string,
  downloaded: Omit<DownloadedUpdateRecord, 'downloadedAt'>,
  now: () => Date = () => new Date()
): UpdateHistoryResult {
  if (!isArtifactSha512(downloaded.artifactSha512)) {
    throw new Error('downloaded update SHA-512 identity is invalid');
  }
  if (compareUpdateVersions(downloaded.version, currentVersion) <= 0) {
    throw new Error('downloaded update must be newer than the installed version');
  }
  const validatedDownload = parseDownloaded({ ...downloaded, downloadedAt: now().toISOString() });
  if (!validatedDownload) throw new Error('downloaded update metadata is invalid');
  const baseline = recordVersionTransition(filePath, currentVersion, now);
  const next: UpdateHistoryRecord = {
    schemaVersion: 2,
    version: baseline.version,
    updatedAt: baseline.updatedAt,
    downloaded: validatedDownload,
  };
  writeRecord(filePath, next);
  return {
    ...next,
    changed: baseline.changed,
    recovered: baseline.recovered,
    migrated: baseline.migrated,
  };
}
