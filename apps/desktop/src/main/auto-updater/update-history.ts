/** persist the last observed desktop version transition. */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface UpdateHistoryRecord {
  schemaVersion: 1;
  version: string;
  updatedAt: string | null;
}

export interface UpdateHistoryResult extends UpdateHistoryRecord {
  changed: boolean;
  recovered: boolean;
}

function parseRecord(value: unknown): UpdateHistoryRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.version !== 'string') return null;
  if (record.updatedAt !== null && typeof record.updatedAt !== 'string') return null;
  if (typeof record.updatedAt === 'string' && !Number.isFinite(Date.parse(record.updatedAt))) {
    return null;
  }
  return {
    schemaVersion: 1,
    version: record.version,
    updatedAt: record.updatedAt as string | null,
  };
}

function readRecord(filePath: string): { record: UpdateHistoryRecord | null; recovered: boolean } {
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
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

/**
 * First boot establishes a baseline without inventing an install timestamp.
 * A later version change records the transition exactly once and retains it on
 * subsequent launches of the same build.
 */
export function recordVersionTransition(
  filePath: string,
  currentVersion: string,
  now: () => Date = () => new Date()
): UpdateHistoryResult {
  const { record, recovered } = readRecord(filePath);
  if (!record) {
    const baseline: UpdateHistoryRecord = {
      schemaVersion: 1,
      version: currentVersion,
      updatedAt: null,
    };
    writeRecord(filePath, baseline);
    return { ...baseline, changed: false, recovered };
  }

  if (record.version === currentVersion) {
    return { ...record, changed: false, recovered: false };
  }

  const updated: UpdateHistoryRecord = {
    schemaVersion: 1,
    version: currentVersion,
    updatedAt: now().toISOString(),
  };
  writeRecord(filePath, updated);
  return { ...updated, changed: true, recovered: false };
}
