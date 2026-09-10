/**
 * A table-rebuild migration must not drop a column another migration added.
 *
 * SQLite cannot alter a CHECK constraint in place, so drizzle expresses those
 * changes as a rebuild: create `__new_<table>`, copy the rows, drop the
 * original, rename. The rebuilt shape comes from the schema snapshot the
 * migration was GENERATED against — so a migration authored on a branch that
 * predates a sibling's `ALTER TABLE ... ADD COLUMN` silently recreates the
 * table without it, and the INSERT...SELECT quietly discards the data.
 *
 * That is exactly what happened here: the restaurant layer's sales rebuild was
 * generated before the return-state split existed, so applying both dropped
 * `sales.return_state`, its data, and its index. Nothing conflicts in git, and
 * the SQL is individually valid.
 *
 * This test reads the migrations as text and pins the rule structurally, so it
 * catches the next rebuild too rather than only the one that bit us.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(process.cwd(), 'src/db/migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter(name => name.endsWith('.sql'))
    .sort();
}

/** Columns a migration adds to `table` via ALTER TABLE ... ADD. */
function addedColumns(sql: string, table: string): string[] {
  const pattern = new RegExp(`ALTER TABLE \`${table}\`\\s+ADD\\s+\`([a-z_]+)\``, 'g');
  return [...sql.matchAll(pattern)].map(match => match[1]!);
}

/** The column list of a `__new_<table>` rebuild, or null when there is none. */
function rebuiltColumns(sql: string, table: string): string[] | null {
  const create = new RegExp(`CREATE TABLE \`__new_${table}\` \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  if (!create) return null;
  return [...create[1]!.matchAll(/^\t`([a-z_]+)`/gm)].map(match => match[1]!);
}

/** The two column lists of the rebuild's INSERT ... SELECT. */
function copiedColumns(sql: string, table: string): { inserted: string[]; selected: string[] } {
  const insert = new RegExp(
    `INSERT INTO \`__new_${table}\`\\(([^)]*)\\) SELECT ([\\s\\S]*?) FROM \`${table}\``
  ).exec(sql);
  if (!insert) return { inserted: [], selected: [] };
  const names = (chunk: string) => [...chunk.matchAll(/"([a-z_]+)"/g)].map(match => match[1]!);
  return { inserted: names(insert[1]!), selected: names(insert[2]!) };
}

/** Named CHECK constraints declared in a `CREATE TABLE <name>` block. */
function declaredConstraints(sql: string, name: string): string[] | null {
  const create = new RegExp(`CREATE TABLE \`${name}\` \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  if (!create) return null;
  return [...create[1]!.matchAll(/CONSTRAINT "([a-z0-9_]+)"/g)].map(match => match[1]!);
}

/**
 * The column set the migration SQL implies for `table`, replaying every
 * `ALTER TABLE ... ADD` and every `__new_<table>` rebuild in journal order.
 */
function columnsImpliedBySql(files: readonly string[], table: string): Set<string> {
  const columns = new Set<string>();
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    const rebuilt = rebuiltColumns(sql, table);
    if (rebuilt) {
      columns.clear();
      for (const column of rebuilt) columns.add(column);
    }
    const created = declaredColumns(sql, table);
    if (created) {
      columns.clear();
      for (const column of created) columns.add(column);
    }
    for (const column of addedColumns(sql, table)) columns.add(column);
  }
  return columns;
}

/** The column list of a plain `CREATE TABLE <table>`, or null when absent. */
function declaredColumns(sql: string, table: string): string[] | null {
  const create = new RegExp(`CREATE TABLE \`${table}\` \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  if (!create) return null;
  return [...create[1]!.matchAll(/^\t\`([a-z_]+)\`/gm)].map(match => match[1]!);
}

/** Columns the newest drizzle snapshot believes `table` has. */
function columnsInLatestSnapshot(table: string): string[] | null {
  const journal = JSON.parse(readFileSync(resolve(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number }>;
  };
  const newest = Math.max(...journal.entries.map(entry => entry.idx));
  const snapshotPath = resolve(MIGRATIONS, `meta/${String(newest).padStart(4, '0')}_snapshot.json`);
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
    tables: Record<string, { columns: Record<string, unknown> }>;
  };
  const entry = snapshot.tables[table];
  return entry ? Object.keys(entry.columns) : null;
}

describe('table rebuilds preserve every column added before them', () => {
  // Tables whose rebuilds have actually bitten, plus the ones most likely to:
  // long-lived aggregates that several verticals extend independently.
  const WATCHED_TABLES = ['sales', 'sale_items', 'products', 'inventory_balances'];

  it.each(WATCHED_TABLES)('a %s rebuild carries every earlier ADD COLUMN', table => {
    const files = migrationFiles();
    const addedSoFar = new Set<string>();

    for (const file of files) {
      const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
      const rebuilt = rebuiltColumns(sql, table);

      if (rebuilt) {
        const { inserted, selected } = copiedColumns(sql, table);
        for (const column of addedSoFar) {
          expect(
            rebuilt,
            `${file} rebuilds ${table} without \`${column}\`, which an earlier migration added. The rebuild would drop the column.`
          ).toContain(column);
          expect(
            inserted,
            `${file} rebuilds ${table} but does not carry \`${column}\` into __new_${table}. The data would be discarded.`
          ).toContain(column);
          expect(
            selected,
            `${file} rebuilds ${table} but does not select \`${column}\` from the old table.`
          ).toContain(column);
        }
        // After a rebuild the new table IS the baseline for what follows.
        for (const column of rebuilt) addedSoFar.add(column);
      }

      for (const column of addedColumns(sql, table)) addedSoFar.add(column);
    }
  });

  it.each([...WATCHED_TABLES, 'cash_sessions', 'customer_ledger_entries'])(
    'a %s rebuild carries every CHECK constraint it already had',
    table => {
      // Constraints are the other half of the same hazard, and a worse one to
      // lose: a dropped column fails loudly the next time something reads it,
      // while a dropped CHECK just stops rejecting bad rows. The baseline
      // declares these in raw SQL, so drizzle-kit does not know they exist and
      // will not re-emit them in a rebuild it generates.
      const files = migrationFiles();
      let held = new Set<string>();

      for (const file of files) {
        const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
        const rebuilt = declaredConstraints(sql, `__new_${table}`);
        if (rebuilt) {
          for (const constraint of held) {
            expect(
              rebuilt,
              `${file} rebuilds ${table} without CHECK ${constraint}, which the table already had. The rebuild would silently stop enforcing it.`
            ).toContain(constraint);
          }
          held = new Set(rebuilt);
          continue;
        }
        const declared = declaredConstraints(sql, table);
        if (declared) held = new Set(declared);
      }
    }
  );

  it('actually sees a CHECK constraint on a watched table', () => {
    // Same self-check as above: a regex matching nothing makes it vacuous.
    const withChecks = migrationFiles().find(file => {
      const found = declaredConstraints(
        readFileSync(resolve(MIGRATIONS, file), 'utf8'),
        'cash_sessions'
      );
      return found !== null && found.length > 0;
    });
    expect(withChecks).toBeDefined();
  });

  it.each(WATCHED_TABLES)('the newest snapshot agrees with the SQL about %s', table => {
    // The other half of the same hazard, and the half that actually bit.
    //
    // drizzle-kit diffs schema.ts against the NEWEST snapshot, so a snapshot
    // that has fallen behind the SQL makes the next `generate` emit an ADD for
    // a column the database already has - which aborts on every existing
    // install - and makes any rebuild it generates drop that column again.
    //
    // sales.return_state was lost exactly this way: 0057 was generated from a
    // branch cut before the return-state split landed, its snapshot recorded a
    // sales table without the column even though its SQL never touched sales,
    // and all 33 snapshots after it inherited the omission. The guard above
    // reads migration SQL, which was correct, so nothing caught it.
    const implied = columnsImpliedBySql(migrationFiles(), table);
    const snapshot = columnsInLatestSnapshot(table);
    expect(snapshot, `no snapshot entry for ${table}`).not.toBeNull();
    for (const column of implied) {
      expect(
        snapshot,
        `the newest snapshot has no \`${column}\` on ${table}, but the migrations add it. The next drizzle-kit generate would emit a duplicate ADD, and a generated rebuild would drop it.`
      ).toContain(column);
    }
  });

  it('actually sees the sales rebuild and the return-state column', () => {
    // Guards the test itself: a regex that silently matches nothing would make
    // every assertion above vacuous.
    const rebuild = migrationFiles().find(file =>
      rebuiltColumns(readFileSync(resolve(MIGRATIONS, file), 'utf8'), 'sales')
    );
    expect(rebuild).toBeDefined();
    const adder = migrationFiles().find(file =>
      addedColumns(readFileSync(resolve(MIGRATIONS, file), 'utf8'), 'sales').includes(
        'return_state'
      )
    );
    expect(adder).toBeDefined();
  });
});
