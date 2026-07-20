import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type Database from 'better-sqlite3';

export type HistoricalColumnMap = Record<string, string[]>;
export type TableFingerprintMap = Record<string, string>;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function captureHistoricalColumns(
  sqlite: Database.Database,
  tables: readonly string[]
): HistoricalColumnMap {
  return Object.fromEntries(
    tables.map(table => {
      const columns = sqlite.pragma(`table_info(${quoteIdentifier(table)})`) as Array<{
        cid: number;
        name: string;
      }>;
      if (columns.length === 0) throw new Error(`historical table ${table} is missing`);
      return [
        table,
        columns.sort((left, right) => left.cid - right.cid).map(column => column.name),
      ];
    })
  );
}

export function fingerprintSentinels(
  sqlite: Database.Database,
  historicalColumns: HistoricalColumnMap
): TableFingerprintMap {
  return Object.fromEntries(
    Object.entries(historicalColumns).map(([table, columns]) => {
      const selectedColumns = columns.map(quoteIdentifier).join(', ');
      const rows = sqlite
        .prepare(
          `SELECT ${selectedColumns} FROM ${quoteIdentifier(table)} ` +
            `WHERE id LIKE 'rehearsal-%' ORDER BY id`
        )
        .all();
      if (rows.length !== 2) {
        throw new Error(`expected two historical sentinels in ${table}, found ${rows.length}`);
      }
      return [table, hashJson(rows)];
    })
  );
}

export function assertFingerprintsEqual(
  expected: TableFingerprintMap,
  actual: TableFingerprintMap
): void {
  for (const [table, expectedHash] of Object.entries(expected)) {
    if (actual[table] !== expectedHash) {
      throw new Error(`historical rows changed during recovery rehearsal in ${table}`);
    }
  }
}

export function countAppliedMigrations(sqlite: Database.Database): number {
  const row = sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as {
    count: number;
  };
  return row.count;
}

export function assertCurrentSchemaReady(sqlite: Database.Database): void {
  const requiredTables = [
    'employee_shifts',
    'manager_approval_requests',
    'day_close_signoffs',
    'day_close_artifacts',
    'scheduled_shifts',
    'employee_shift_breaks',
    'employee_shift_corrections',
    'loss_prevention_settings',
    'product_serials',
    'sale_item_serials',
    'product_serial_transfers',
  ];
  const existing = new Set(
    (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map(row => row.name)
  );
  const missing = requiredTables.filter(table => !existing.has(table));
  if (missing.length > 0) throw new Error(`current schema tables missing: ${missing.join(', ')}`);

  const defaults = sqlite
    .prepare(
      `SELECT c.privacy_status AS privacyStatus,
              p.catalog_type AS catalogType,
              p.tracks_serials AS tracksSerials
         FROM customers c
         JOIN products p ON p.tenant_id = c.tenant_id
        WHERE c.id LIKE 'rehearsal-customer-%'
        ORDER BY c.id`
    )
    .all() as Array<{ privacyStatus: string; catalogType: string; tracksSerials: number }>;
  if (
    defaults.length !== 2 ||
    defaults.some(
      row =>
        row.privacyStatus !== 'active' || row.catalogType !== 'standard' || row.tracksSerials !== 0
    )
  ) {
    throw new Error('new-column defaults are not safe for historical rows');
  }

  const violations = sqlite.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`foreign-key check found ${violations.length} violation(s)`);
  }
}

export async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
