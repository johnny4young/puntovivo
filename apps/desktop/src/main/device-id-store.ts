/**
 * ENG-052b — Atomic file-backed device id store for the desktop
 * runtime.
 *
 * The renderer caches the server-issued device id in localStorage,
 * but localStorage is wiped by browser cache resets. The Electron
 * main process mirrors the id in the user's data folder so a
 * localStorage clear does not invalidate the device registration.
 *
 * Atomic write: a tmp file is created next to the target, populated
 * with the id, then atomically renamed over the target. This means a
 * crash mid-write never leaves a truncated `device-id.txt` on disk;
 * the next read either gets the previous id or `null`.
 *
 * The functions here are pure I/O — they take an explicit `dir` so
 * tests can point them at a tmp directory without spinning up
 * Electron.
 *
 * @module main/device-id-store
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEVICE_ID_FILENAME = 'device-id.txt';

export function deviceIdPathIn(dir: string): string {
  return join(dir, DEVICE_ID_FILENAME);
}

/**
 * Read the persisted device id from `dir`. Returns `null` when the
 * file is missing or empty so the caller can trigger
 * `auth.registerDevice` cleanly. Other I/O errors propagate so the
 * operator can investigate.
 */
export async function readDeviceIdFromDir(dir: string): Promise<string | null> {
  const target = deviceIdPathIn(dir);
  try {
    const raw = await readFile(target, 'utf8');
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Atomically write `deviceId` to `dir/device-id.txt`. Throws when
 * `deviceId` is empty so callers cannot accidentally erase a valid
 * registration with a falsy value.
 */
export async function writeDeviceIdToDir(
  dir: string,
  deviceId: string
): Promise<void> {
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw new Error('DEVICE_SET_ID_REJECTED');
  }
  const target = deviceIdPathIn(dir);
  const tmp = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(tmp, deviceId, 'utf8');
  await rename(tmp, target);
}
