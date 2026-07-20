// /  — backup-file format detection + cleartext-SQLite probe
// ( slice 31). Pure 16-byte header reads; no connection, no key.

import { open } from 'node:fs/promises';

/**
 * Detect whether the file at `path` is a backup ZIP, a raw SQLite
 * file, or unrecognized. Reads the first 4 bytes only.
 */
export async function detectBackupFormat(path: string): Promise<'zip' | 'sqlite' | 'unknown'> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    if (bytesRead < 4) return 'unknown';
    // ZIP local-file header: 50 4b 03 04
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      return 'zip';
    }
    // SQLite header magic: "SQLite format 3\0"
    if (buf[0] === 0x53 && buf[1] === 0x51 && buf[2] === 0x4c && buf[3] === 0x69) {
      return 'sqlite';
    }
    return 'unknown';
  } finally {
    if (handle) await handle.close();
  }
}

/**
 * is the file a readable-header (CLEARTEXT) SQLite DB?
 *
 * A pre-encryption database keeps the plain "SQLite format 3\0"
 * magic in its first bytes; a SQLCipher database encrypts page 1
 * including the header, so `detectBackupFormat` reports 'unknown'
 * for it. This makes cleartext detection a pure 16-byte read — no
 * connection, no key, fully deterministic. Returns false for
 * missing files (a fresh install has nothing to migrate).
 */
export async function isCleartextSqliteFile(path: string): Promise<boolean> {
  try {
    return (await detectBackupFormat(path)) === 'sqlite';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
