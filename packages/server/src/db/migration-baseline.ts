/**
 * ENG-002 — versioned-migration adoption shim.
 *
 * Seeds the squashed-baseline `__drizzle_migrations` marker for DBs that
 * predate versioned migrations so the first real `drizzleMigrate()` call
 * skips baseline DDL that would collide with pre-existing objects. Owns
 * the `_journal.json` shape (`DrizzleJournal*`) shared with `connection.ts`.
 *
 * @module db/migration-baseline
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

export interface DrizzleJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
}

/**
 * ENG-002 — adoption shim for DBs that predate versioned migrations.
 *
 * If the DB already carries application data (probed via any user
 * table) but has no `__drizzle_migrations` row, this function seeds the
 * squashed baseline entry with the exact (hash, created_at) tuple that
 * drizzle-orm's migrator would have written itself. That way the first
 * real `drizzleMigrate()` call skips the baseline DDL that would collide
 * with the existing objects, then applies every newer migration that is
 * relevant to the adopted schema.
 *
 * No-op on fresh DBs (let migrate() run everything from scratch) and
 * on already-adopted DBs (tracking row exists).
 *
 * Rationale for seeding the baseline: legacy installs reached the
 * baseline schema shape via a now-retired raw-DDL bootstrap. Replaying
 * that baseline would collide with the existing tables, but pinning the
 * whole journal would also skip newer constraints/data fixes (for
 * example ENG-177c's sales CHECK). Operators who skipped the
 * transitional release that ran the raw-DDL path must adopt a bridge
 * build once before upgrading — the post-migration `seedCatalogs()`
 * hook logs an actionable warning when the expected tables are absent.
 * Partial test/legacy DBs may omit a post-baseline target table entirely;
 * those specific migrations can be marked applied because there is
 * nothing for them to rewrite.
 */
export function ensureMigrationBaseline(sqlite: Database.Database, migrationsFolder: string): void {
  const journalPath = resolve(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    // No migrations folder yet. Defer to drizzleMigrate which will throw
    // a loud, actionable error pointing at the missing metadata.
    return;
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as DrizzleJournal;
  if (journal.entries.length === 0) {
    return;
  }

  // Probe: this DB has pre-existing application tables iff sqlite_master
  // lists anything beyond internals (`sqlite_*`) and drizzle's own tracking
  // table. A fresh sqlite file returns no rows at all; a legacy install
  // may have any subset of the schema (some tests seed only a couple of
  // tables to exercise migration fast-paths — `tenants` is not guaranteed).
  const preExistingUserTable = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' " +
        "AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' LIMIT 1"
    )
    .get();
  if (!preExistingUserTable) {
    return;
  }

  // Pre-create the tracking table so we can seed rows. The drizzle-orm
  // migrator CREATE IF NOT EXISTS below will find it and reuse it.
  sqlite
    .prepare(
      'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)'
    )
    .run();

  const existingRow = sqlite.prepare('SELECT id FROM __drizzle_migrations LIMIT 1').get();
  if (existingRow) {
    // Either this DB already adopted the shim, or drizzleMigrate already
    // ran on a fresh boot. Either way, hands off.
    return;
  }

  // Adoption guard — pinning the baseline marks the whole squashed
  // pre-production history as applied, so an install whose tables predate
  // that history (the operator skipped the transitional release) would
  // silently adopt and then break on the first write that touches a column
  // it never received. Probe a small set of sentinel columns from the
  // structural money / catalog migrations: when the table exists but the
  // column is missing, refuse the adoption with an actionable upgrade path
  // instead. Absent sentinel tables stay out of this guard so bootstrap
  // tests can still exercise minimal DB shapes, but real legacy upgrades
  // are expected to carry the full baseline schema before post-baseline
  // migrations run.
  const ADOPTION_SENTINELS: ReadonlyArray<{
    table: string;
    column: string;
    migration: string;
  }> = [
    { table: 'cash_sessions', column: 'expected_balance', migration: '0000_baseline (ENG-176a)' },
    { table: 'sales', column: 'currency_code', migration: '0000_baseline (ENG-176b)' },
    { table: 'products', column: 'version', migration: '0000_baseline (ENG-177a)' },
  ];
  for (const sentinel of ADOPTION_SENTINELS) {
    const tableRow = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
      .get(sentinel.table);
    if (!tableRow) {
      continue;
    }
    const columns = sqlite.prepare(`PRAGMA table_info(${sentinel.table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some(column => column.name === sentinel.column)) {
      throw new Error(
        `Cannot adopt this database: table '${sentinel.table}' is missing column '${sentinel.column}' (added by migration ${sentinel.migration}). ` +
          'This install predates the versioned-migration baseline, so adopting it would silently skip schema changes it never received. ' +
          'Upgrade through a transitional release that still runs the legacy bootstrap, or start from a fresh database and restore your data.'
      );
    }
  }

  const orderedEntries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const tableExists = (name: string): boolean =>
    Boolean(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
        .get(name)
    );

  const baselineEntries = orderedEntries.filter(entry => entry.tag.endsWith('_baseline'));
  if (baselineEntries.length === 0) {
    throw new Error(
      'Cannot adopt this database: the migrations journal does not include a baseline entry. ' +
        'Fresh databases can run the full journal, but existing pre-migration databases need a squashed baseline marker to avoid replaying CREATE TABLE statements.'
    );
  }
  const shouldSeedPostBaselineMigration = (entry: DrizzleJournalEntry): boolean => {
    // ENG-177c — if a partial adopted DB does not even have `sales`,
    // the table-rebuild CHECK migration has no target. Mark it applied
    // so minimal legacy/test DBs keep booting; when `sales` exists, the
    // migration remains pending and applies the DB-level invariant.
    if (entry.tag === '0001_eng177c_sales_cash_session_check') {
      return !tableExists('sales');
    }
    return false;
  };
  const adoptionEntries = orderedEntries.filter(
    entry => entry.tag.endsWith('_baseline') || shouldSeedPostBaselineMigration(entry)
  );
  const insert = sqlite.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
  );

  // Compute each migration hash exactly like drizzle-orm's
  // `readMigrationFiles` does: sha256 of the raw `.sql` contents, no
  // normalisation. Seed only the baseline marker(s) plus explicitly
  // absent-target no-ops; applicable newer journal entries must remain
  // pending so drizzleMigrate applies them.
  for (const entry of adoptionEntries) {
    const sqlPath = resolve(migrationsFolder, `${entry.tag}.sql`);
    const sqlContents = readFileSync(sqlPath, 'utf8');
    const hash = createHash('sha256').update(sqlContents).digest('hex');
    insert.run(hash, entry.when);
  }
}
