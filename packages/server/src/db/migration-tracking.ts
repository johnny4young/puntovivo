import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

interface MigrationJournal {
  entries: Array<{ idx: number; tag: string; when: number }>;
}

/**
 * Align Drizzle tracking timestamps with the bundled journal by SQL hash.
 *
 * This compatibility pass makes journal timestamp corrections safe for DBs
 * that already applied those migrations. Hashes are immutable migration
 * identities; unknown rows are left untouched and the downgrade guard still
 * owns the applied-count decision.
 */
export function alignMigrationTrackingTimestamps(
  sqlite: Database.Database,
  migrationsFolder: string
): number {
  const trackingTable = sqlite
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    )
    .get() as { present: number } | undefined;
  if (trackingTable === undefined) return 0;
  const rows = sqlite
    .prepare('SELECT id, hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY id')
    .all() as Array<{ id: number; hash: string; createdAt: number }>;
  if (rows.length === 0) return 0;

  const journal = JSON.parse(
    readFileSync(resolve(migrationsFolder, 'meta', '_journal.json'), 'utf8')
  ) as MigrationJournal;
  const timestampByHash = new Map<string, number>();
  for (const entry of journal.entries) {
    const sql = readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`));
    timestampByHash.set(createHash('sha256').update(sql).digest('hex'), entry.when);
  }

  const update = sqlite.prepare(
    'UPDATE __drizzle_migrations SET created_at = ? WHERE id = ? AND hash = ?'
  );
  return sqlite.transaction(() => {
    let aligned = 0;
    for (const row of rows) {
      const expected = timestampByHash.get(row.hash);
      if (expected !== undefined && Number(row.createdAt) !== expected) {
        update.run(expected, row.id, row.hash);
        aligned += 1;
      }
    }
    return aligned;
  })();
}
