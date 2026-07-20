// SQLite integrity check for backup/restore ( slice 31).

import Database from 'better-sqlite3';
import { applySqlCipherKey } from './encryption.ts';

/**
 * Open `dbPath` read-only and run `PRAGMA integrity_check`. Throws
 * with a stable error message when the DB is corrupted, truncated,
 * or otherwise unreadable. Returns `void` on success.
 *
 * The error message is kept generic so callers can wrap it in a
 * translated user-facing string without coupling to SQLite internals.
 */
// explicit `| undefined` on optional fields.
export async function assertSqliteIntegrity(
  dbPath: string,
  options: { encryptionKey?: string | undefined } = {}
): Promise<void> {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    applySqlCipherKey(db, options.encryptionKey);
    const rows = db.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check?: string;
    }>;
    const ok = rows.length === 1 && rows[0]?.integrity_check === 'ok';
    if (!ok) {
      const messages = rows
        .map(r => r.integrity_check ?? '')
        .filter(Boolean)
        .join('; ');
      throw new Error(`Backup integrity check failed${messages ? `: ${messages}` : ''}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Backup integrity check failed')) {
      throw err;
    }
    // Wrap any open / read error in the same shape so callers don't
    // have to distinguish between "the file isn't SQLite" and "the
    // file is SQLite but corrupted".
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Backup integrity check failed: ${reason}`, { cause: err });
  } finally {
    if (db) db.close();
  }
}
