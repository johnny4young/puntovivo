/**
 * Step 3 — Schema parity regression pin.
 *
 * Locks the invariant that after retirement of the legacy
 * `runSchemaSync()` raw-DDL bootstrap, booting through
 * `initDatabase({ seedData: false })` still produces:
 *
 * - Every tenant-scoped and global user table the app needs.
 * - Every named index the Drizzle schema declares.
 * - Non-empty catalog tables (country, currency, DIAN identification
 * types) via the post-migration `seedCatalogs` hook.
 *
 * The assertions are deliberately generous on table/index counts — the
 * test does NOT freeze the exact list, only confirms that the full
 * surface materialises from the migrations + seed-catalog path, with
 * spot-checks on the tables that the retirement is most likely to
 * regress (the catalog tables and the  fiscal tables).
 *
 * If a future diff breaks parity — e.g. a migration stops creating
 * `fiscal_identification_types` or `seedCatalogs` is accidentally
 * disconnected — this test fires with a concrete row-count assertion.
 *
 * @module __tests__/migrations-parity
 */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../db/index.js';

interface TableInfoRow {
  name: string;
}

interface CountRow {
  count: number;
}

function listUserTables(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' " +
          "AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' " +
          'ORDER BY name'
      )
      .all() as TableInfoRow[]
  ).map(row => row.name);
}

function listIndices(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' " +
          "AND name NOT LIKE 'sqlite_%' " +
          'ORDER BY name'
      )
      .all() as TableInfoRow[]
  ).map(row => row.name);
}

function countRows(sqlite: Database.Database, tableName: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    CountRow | undefined;
  return row?.count ?? 0;
}

describe('schema parity ( Step 3)', () => {
  const createdPaths: string[] = [];

  afterEach(() => {
    closeDatabase();
    for (const path of createdPaths.splice(0)) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; not fatal.
      }
    }
  });

  it('boots a fresh :memory: DB with every expected table + index present', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const live = getDatabase() as unknown as { $client: Database.Database };
    const tables = listUserTables(live.$client);
    const indices = listIndices(live.$client);

    // Sanity: the schema is wide (30+ tables in the baseline alone).
    // A regression that knocks the count below 40 tables almost certainly
    // means drizzleMigrate skipped or that seedCatalogs is running before
    // the tables exist.
    expect(tables.length).toBeGreaterThanOrEqual(40);
    expect(indices.length).toBeGreaterThanOrEqual(40);

    // Spot-check: the catalog tables ( / ) that
    // `seedCatalogs` targets must exist. If retirement disconnects the
    // migration path for these, the hook would otherwise crash on every
    // boot.
    for (const required of [
      'country_catalog',
      'currency_catalog',
      'fiscal_identification_types',
      'tenants',
      'users',
      'sites',
      'products',
      'sales',
      'fiscal_documents',
      'fiscal_document_items',
      'fiscal_numbering_resolutions',
      'fiscal_certificates',
    ]) {
      expect(tables, `expected table ${required} in parity set`).toContain(required);
    }
  });

  it('populates every catalog table via the seedCatalogs hook', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const live = getDatabase() as unknown as { $client: Database.Database };

    // Row counts match the seed matrices in `db/index.ts`
    // (`seedLocaleCatalogs` + `seedFiscalIdentificationTypes`).
    expect(countRows(live.$client, 'currency_catalog')).toBeGreaterThanOrEqual(18);
    expect(countRows(live.$client, 'country_catalog')).toBeGreaterThanOrEqual(21);
    expect(countRows(live.$client, 'fiscal_identification_types')).toBe(23);
  });

  it('produces identical row counts across two independent fresh boots (determinism)', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const firstLive = getDatabase() as unknown as {
      $client: Database.Database;
    };
    const firstCurrencies = countRows(firstLive.$client, 'currency_catalog');
    const firstCountries = countRows(firstLive.$client, 'country_catalog');
    const firstDian = countRows(firstLive.$client, 'fiscal_identification_types');

    // `:memory:` handles reset when `closeDatabase()` fires, so the
    // second boot is effectively a separate DB — this case proves the
    // seed step produces the same counts deterministically across
    // runs starting from an empty DB.
    closeDatabase();
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const secondLive = getDatabase() as unknown as {
      $client: Database.Database;
    };
    expect(countRows(secondLive.$client, 'currency_catalog')).toBe(firstCurrencies);
    expect(countRows(secondLive.$client, 'country_catalog')).toBe(firstCountries);
    expect(countRows(secondLive.$client, 'fiscal_identification_types')).toBe(firstDian);
  });

  it('is idempotent on a persistent DB: re-booting the same file does not mutate catalog rows', async () => {
    // Step 3 regression pin: the `INSERT OR IGNORE` clauses
    // inside `seedLocaleCatalogs` + `seedFiscalIdentificationTypes` are
    // the only guard against double-insert on every boot. A future
    // diff that accidentally swapped either seeder to
    // `INSERT OR REPLACE` would silently overwrite existing rows and
    // bump `last_rowid` sequences. This test writes a sentinel tweak
    // into one seeded row, reboots against the SAME file, and asserts
    // the tweak survives — proving the second-boot seed path did not
    // overwrite it.
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-parity-reboot-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'parity.db');

    // First boot — seeds catalog tables from scratch.
    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const firstLive = getDatabase() as unknown as {
      $client: Database.Database;
    };
    const firstCountries = countRows(firstLive.$client, 'country_catalog');
    const firstDian = countRows(firstLive.$client, 'fiscal_identification_types');

    // Tweak a sentinel field that the seed would overwrite if it used
    // `INSERT OR REPLACE`. Currency `decimals` is a numeric column the
    // seed sets to `2` for USD — flip it to a garbage value and prove
    // the second boot preserves the garbage.
    firstLive.$client
      .prepare('UPDATE currency_catalog SET decimals = 99 WHERE code = ?')
      .run('USD');

    closeDatabase();

    // Second boot — same file, same migrations, same seed path.
    await initDatabase({ dbPath, seedData: false });
    const secondLive = getDatabase() as unknown as {
      $client: Database.Database;
    };

    // Row counts unchanged — no double-insert.
    expect(countRows(secondLive.$client, 'country_catalog')).toBe(firstCountries);
    expect(countRows(secondLive.$client, 'fiscal_identification_types')).toBe(firstDian);

    // Sentinel survived — the seed used `INSERT OR IGNORE`, not
    // `INSERT OR REPLACE`. If this assertion fails, someone swapped
    // the conflict policy and is now silently overwriting operator
    // data on every boot.
    const usdDecimals = (
      secondLive.$client
        .prepare('SELECT decimals FROM currency_catalog WHERE code = ?')
        .get('USD') as { decimals: number } | undefined
    )?.decimals;
    expect(usdDecimals).toBe(99);
  });
});
