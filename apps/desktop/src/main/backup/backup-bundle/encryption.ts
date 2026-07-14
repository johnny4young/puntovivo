// ENG-167 / ENG-167b — SQLCipher key handling for backup bundles: key-shape
// validation, applying a key to a connection, and in-place rekey (ENG-178
// slice 31). assertEncryptionKeyShape + applySqlCipherKey are internal and
// shared with create.ts / integrity.ts; rekeySqliteDatabase is public.

import Database from 'better-sqlite3';

export function assertEncryptionKeyShape(key: string): void {
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error('encryptionKey must be a 64-character hex string');
  }
}

export function applySqlCipherKey(db: Database.Database, encryptionKey?: string): void {
  if (encryptionKey === undefined) {
    return;
  }
  assertEncryptionKeyShape(encryptionKey);
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${encryptionKey}'"`);
}

/**
 * ENG-167b — re-encrypt a SQLite database IN PLACE to `toKey`.
 *
 * Two callers, one contract:
 *   - First-boot migration: `fromKey` undefined (cleartext source)
 *     → the file ends up SQLCipher-v4-encrypted under the install key.
 *   - Cross-device restore: `fromKey` = the SOURCE device's key →
 *     the staged file is rekeyed to THIS device's key so every
 *     install keeps exactly one key envelope.
 *
 * `PRAGMA rekey` rewrites every page under the new key (verified
 * empirically against better-sqlite3-multiple-ciphers 12.11.1: the
 * header becomes unreadable and keyless opens fail SQLITE_NOTADB).
 * The caller is responsible for crash-safety around the in-place
 * rewrite (the migration keeps a .bak; the restore works on a
 * staging copy), and MUST run `assertSqliteIntegrity` with `toKey`
 * afterwards before trusting the file.
 */
export function rekeySqliteDatabase(
  dbPath: string,
  options: { fromKey?: string | undefined; toKey: string }
): void {
  assertEncryptionKeyShape(options.toKey);
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('legacy = 4');
    if (options.fromKey !== undefined) {
      assertEncryptionKeyShape(options.fromKey);
      db.pragma(`key = "x'${options.fromKey}'"`);
    }
    db.pragma(`rekey = "x'${options.toKey}'"`);
  } finally {
    db.close();
  }
}
