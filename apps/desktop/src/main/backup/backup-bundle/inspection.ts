/** ENG-136b — read-only, tenant-scoped backup inspection helpers. */

import Database from 'better-sqlite3';
import { applySqlCipherKey } from './encryption.ts';

export const BACKUP_RESTORE_DRILL_TABLES = [
  'products',
  'customers',
  'sales',
  'inventory_movements',
  'audit_logs',
] as const;

export type BackupRestoreDrillTable = (typeof BACKUP_RESTORE_DRILL_TABLES)[number];
export type BackupRestoreDrillCounts = Record<BackupRestoreDrillTable, number>;

/**
 * Count a fixed allowlist of operational rows for one tenant. Table names are
 * constants owned by this module, never renderer or archive input.
 */
export function readTenantRestoreDrillCounts(
  db: Pick<Database.Database, 'prepare'>,
  tenantId: string
): BackupRestoreDrillCounts {
  return Object.fromEntries(
    BACKUP_RESTORE_DRILL_TABLES.map(table => {
      const row = db
        .prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE tenant_id = ?`)
        .get(tenantId) as { count?: unknown } | undefined;
      if (!row || typeof row.count !== 'number' || !Number.isSafeInteger(row.count)) {
        throw new Error(`Unable to count restore-drill table ${table}`);
      }
      return [table, row.count];
    })
  ) as BackupRestoreDrillCounts;
}

/** Open an extracted snapshot read-only, apply SQLCipher, and close it. */
export function inspectBackupTenantCounts(
  dbPath: string,
  tenantId: string,
  encryptionKey: string
): BackupRestoreDrillCounts {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    applySqlCipherKey(db, encryptionKey);
    return readTenantRestoreDrillCounts(db, tenantId);
  } finally {
    db.close();
  }
}
