/**
 * ENG-178 — shared main-process helpers for backup create and restore.
 *
 * @module main/ipc/backup/runtime
 */

import { app } from 'electron';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createModuleLogger } from '@puntovivo/server';
import { DEVICE_ID_FILENAME } from '../../device-id-store.js';

// ENG-006 — `backup` is one of the frequent-error surfaces split out of
// `electron-main` so operators can filter the stream by module=backup
// without additional tagging.
export const backupLog = createModuleLogger('backup');

const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

/**
 * Resolves to `${userData}/device-id.txt`. Backup bundles include
 * this file so device identity travels with the data: a full-disk
 * failure can restore the device on new hardware AS the same logical
 * device from the server's perspective (per ADR-0001 + ADR-0006).
 */
export function getDeviceIdPath(): string {
  return join(app.getPath('userData'), DEVICE_ID_FILENAME);
}

export async function ensureParentDirectoryExists(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function removeSqliteSidecars(dbPath: string): Promise<void> {
  await Promise.all(
    SQLITE_SIDECAR_SUFFIXES.map(async suffix => {
      try {
        await rm(`${dbPath}${suffix}`);
      } catch (error) {
        const maybeFsError = error as NodeJS.ErrnoException;
        if (maybeFsError.code !== 'ENOENT') {
          throw error;
        }
      }
    })
  );
}
