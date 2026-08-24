// /  — SQLCipher key handling for backup bundles: key-shape
// validation, applying a key to a connection, and in-place rekey (
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
 * re-encrypt a SQLite database IN PLACE to `toKey`.
 *
 * Two callers, one contract:
 * - First-boot migration: `fromKey` undefined (cleartext source)
 * → the file ends up SQLCipher-v4-encrypted under the install key.
 * - Cross-device restore: `fromKey` = the SOURCE device's key →
 * the staged file is rekeyed to THIS device's key so every
 * install keeps exactly one key envelope.
 *
 * `PRAGMA rekey` rewrites every page under the new key (verified
 * empirically against better-sqlite3-multiple-ciphers 13.0.3: the
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

/**
 * Null the audit-chain head MACs inside a staged database that is
 * crossing an install boundary (cross-device restore, packaged
 * recovery, rehearsal bundles). The MACs were stamped under the
 * SOURCE install's anchor secret and can never verify under the
 * destination's; clearing them converts the heads to the tolerated
 * pre-anchor state, and the destination's next chained audit write
 * re-stamps them under its own secret. Local key ROTATION must NOT
 * call this — the anchor secret survives a rotation by design.
 * Tolerant of pre-chain databases that lack the table entirely.
 */
export function clearAuditHeadAnchors(dbPath: string, encryptionKey?: string): void {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    applySqlCipherKey(db, encryptionKey);
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_chain_heads'")
      .get();
    if (table) {
      db.prepare('UPDATE audit_chain_heads SET head_mac = NULL').run();
    }
  } finally {
    db.close();
  }
}
