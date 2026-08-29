/** safeStorage-sealed monotonic floor for automatic desktop updates. */

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { assertSafeStorageUsable, type SafeStorageLike } from '../db-key-store.ts';
import { compareUpdateVersions } from './update-policy.ts';

export const AUTO_UPDATE_FLOOR_FILE = '.auto-update-floor.enc';
const FLOOR_SCHEMA_VERSION = 1 as const;

interface UpdateFloorEnvelope {
  schemaVersion: typeof FLOOR_SCHEMA_VERSION;
  floorVersion: string;
  sealedAt: string;
}

export interface UpdateFloorResult extends UpdateFloorEnvelope {
  advanced: boolean;
  established: boolean;
}

function parseEnvelope(value: unknown): UpdateFloorEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('AUTO_UPDATE_FLOOR_INVALID');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const sealedAtMs = typeof record.sealedAt === 'string' ? Date.parse(record.sealedAt) : Number.NaN;
  if (
    keys.join(',') !== 'floorVersion,schemaVersion,sealedAt' ||
    record.schemaVersion !== FLOOR_SCHEMA_VERSION ||
    typeof record.floorVersion !== 'string' ||
    typeof record.sealedAt !== 'string' ||
    !Number.isFinite(sealedAtMs) ||
    new Date(sealedAtMs).toISOString() !== record.sealedAt
  ) {
    throw new Error('AUTO_UPDATE_FLOOR_INVALID');
  }
  // Validate the floor now rather than turning malformed persisted state into
  // an implicit downgrade allowance later.
  compareUpdateVersions(record.floorVersion, record.floorVersion);
  return {
    schemaVersion: FLOOR_SCHEMA_VERSION,
    floorVersion: record.floorVersion,
    sealedAt: record.sealedAt,
  };
}

function writeEnvelope(
  statePath: string,
  envelope: UpdateFloorEnvelope,
  safeStorage: SafeStorageLike,
  platform: NodeJS.Platform
): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  try {
    unlinkSync(temporaryPath);
  } catch {
    // absent
  }
  const sealed = safeStorage.encryptString(JSON.stringify(envelope));
  writeFileSync(temporaryPath, sealed, { flag: 'wx', mode: 0o600 });
  try {
    chmodSync(temporaryPath, 0o600);
  } catch {
    // Windows ACLs plus DPAPI own access control.
  }
  const file = openSync(temporaryPath, 'r');
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  try {
    renameSync(temporaryPath, statePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // preserve the rename failure
    }
    throw error;
  }
  if (platform !== 'win32') {
    const directory = openSync(dirname(statePath), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
}

/**
 * Establish the first trusted floor at the installed version, advance it after
 * a newer manual/automatic install, and never lower it when an older binary is
 * launched intentionally for recovery.
 */
export function loadOrAdvanceUpdateFloor(options: {
  dataDir: string;
  currentVersion: string;
  safeStorage: SafeStorageLike;
  now?: () => Date;
  platform?: NodeJS.Platform;
}): UpdateFloorResult {
  const {
    dataDir,
    currentVersion,
    safeStorage,
    now = () => new Date(),
    platform = process.platform,
  } = options;
  assertSafeStorageUsable(safeStorage, platform);
  compareUpdateVersions(currentVersion, currentVersion);
  const statePath = join(dataDir, AUTO_UPDATE_FLOOR_FILE);

  let existing: UpdateFloorEnvelope | null = null;
  if (existsSync(statePath)) {
    try {
      existing = parseEnvelope(JSON.parse(safeStorage.decryptString(readFileSync(statePath))));
    } catch (error) {
      throw new Error('AUTO_UPDATE_FLOOR_DECRYPT_FAILED', { cause: error });
    }
  }

  if (existing && compareUpdateVersions(currentVersion, existing.floorVersion) <= 0) {
    return { ...existing, advanced: false, established: false };
  }

  const next: UpdateFloorEnvelope = {
    schemaVersion: FLOOR_SCHEMA_VERSION,
    floorVersion: currentVersion,
    sealedAt: now().toISOString(),
  };
  writeEnvelope(statePath, next, safeStorage, platform);
  return {
    ...next,
    advanced: existing !== null,
    established: existing === null,
  };
}
