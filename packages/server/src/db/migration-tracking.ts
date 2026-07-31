import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

interface MigrationJournal {
  entries: Array<{ idx: number; tag: string; when: number }>;
}

interface MigrationIdentity {
  tag: string;
  when: number;
  hash: string;
}

function readMigrationEntries(migrationsFolder: string): MigrationJournal['entries'] {
  const journal = JSON.parse(
    readFileSync(resolve(migrationsFolder, 'meta', '_journal.json'), 'utf8')
  ) as MigrationJournal;
  return [...journal.entries].sort((left, right) => left.idx - right.idx);
}

function readMigrationIdentity(
  migrationsFolder: string,
  entry: MigrationJournal['entries'][number]
): MigrationIdentity {
  const sql = readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`));
  return {
    tag: entry.tag,
    when: entry.when,
    hash: createHash('sha256').update(sql).digest('hex'),
  };
}

function readMigrationIdentities(migrationsFolder: string): MigrationIdentity[] {
  return readMigrationEntries(migrationsFolder).map(entry =>
    readMigrationIdentity(migrationsFolder, entry)
  );
}

function tableColumns(sqlite: Database.Database, tableName: string): Set<string> {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  return new Set(columns.map(column => column.name));
}

/**
 * Recover the known 0011 checkout-timing tracking gap.
 *
 * A short-lived development build could materialise all three columns while
 * leaving a v1.7.0 journal prefix (through 0010) behind. Drizzle then replays
 * the first ALTER and refuses to boot on a duplicate column. Adopt 0011 only
 * when immutable hashes prove the tracking rows are the exact prefix
 * immediately before it and the complete schema shape is already present.
 *
 * The compatibility transaction fills only missing derived pace values and
 * records the immutable migration identity. Existing checkout timestamps,
 * non-null pace values, and all unrelated application rows remain untouched.
 */
export function recoverMaterializedCheckoutTimingMigration(
  sqlite: Database.Database,
  migrationsFolder: string
): number {
  const trackingTable = sqlite
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    )
    .get() as { present: number } | undefined;
  if (trackingTable === undefined) return 0;

  const entries = readMigrationEntries(migrationsFolder);
  const targetIndex = entries.findIndex(entry => entry.tag === '0011_eng209_checkout_timing');
  if (targetIndex <= 0) return 0;
  const target = readMigrationIdentity(migrationsFolder, entries[targetIndex]!);
  const rows = sqlite
    .prepare('SELECT hash FROM __drizzle_migrations ORDER BY rowid')
    .all() as Array<{ hash: string }>;

  // Steady-state databases return after hashing only the target migration.
  if (rows.some(row => row.hash === target.hash)) return 0;
  if (rows.length !== targetIndex) return 0;
  const expectedPrefix = entries
    .slice(0, targetIndex)
    .map(entry => readMigrationIdentity(migrationsFolder, entry));
  if (rows.some((row, index) => row.hash !== expectedPrefix[index]?.hash)) return 0;

  const requiredColumns = [
    ['cash_sessions', 'pace_items_per_minute'],
    ['sales', 'checkout_started_at'],
    ['sales', 'checkout_completed_at'],
  ] as const;
  const columnsByTable = new Map<string, Set<string>>();
  const present = requiredColumns.map(([table, column]) => {
    let columns = columnsByTable.get(table);
    if (columns === undefined) {
      columns = tableColumns(sqlite, table);
      columnsByTable.set(table, columns);
    }
    return columns.has(column);
  });
  if (present.every(isPresent => !isPresent)) return 0;
  if (!present.every(Boolean)) {
    const missing = requiredColumns
      .filter((_, index) => !present[index])
      .map(([table, column]) => `${table}.${column}`)
      .join(', ');
    throw new Error(
      `Cannot recover migration 0011_eng209_checkout_timing: its schema is only partially materialised (missing ${missing}). ` +
        'The migration journal was not changed; restore a consistent backup or complete the schema through a supported upgrade.'
    );
  }

  return sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE cash_sessions
         SET pace_items_per_minute = round(
           coalesce(
             (
               SELECT sum(sale_items.quantity)
               FROM sales
               LEFT JOIN sale_items ON sale_items.sale_id = sales.id
               WHERE sales.tenant_id = cash_sessions.tenant_id
                 AND sales.cash_session_id = cash_sessions.id
                 AND sales.status = 'completed'
             ),
             0
           ) / max(
             (julianday(cash_sessions.closed_at) - julianday(cash_sessions.opened_at)) * 1440.0,
             1.0
           ),
           2
         )
         WHERE cash_sessions.status = 'closed'
           AND cash_sessions.closed_at IS NOT NULL
           AND cash_sessions.pace_items_per_minute IS NULL`
      )
      .run();
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(target.hash, target.when);
    return 1;
  })();
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
    .prepare(
      'SELECT rowid AS rowId, hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY rowid'
    )
    .all() as Array<{ rowId: number; hash: string; createdAt: number }>;
  if (rows.length === 0) return 0;

  const timestampByHash = new Map<string, number>();
  for (const identity of readMigrationIdentities(migrationsFolder)) {
    timestampByHash.set(identity.hash, identity.when);
  }

  const update = sqlite.prepare(
    'UPDATE __drizzle_migrations SET created_at = ? WHERE rowid = ? AND hash = ?'
  );
  return sqlite.transaction(() => {
    let aligned = 0;
    for (const row of rows) {
      const expected = timestampByHash.get(row.hash);
      if (expected !== undefined && Number(row.createdAt) !== expected) {
        update.run(expected, row.rowId, row.hash);
        aligned += 1;
      }
    }
    return aligned;
  })();
}
