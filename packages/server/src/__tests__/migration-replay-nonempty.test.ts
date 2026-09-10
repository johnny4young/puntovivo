/**
 * Replay the migration chain against a NON-EMPTY database.
 *
 * Every existing migration gate runs the chain on an empty file, which proves
 * the SQL parses and the final shape matches the schema — and proves nothing
 * about the only run that matters, the one on a customer's data. A tightening
 * (NOT NULL, a CHECK, a UNIQUE index) is invisible on an empty table and
 * fails on the first upgrade that meets a row an earlier migration wrote.
 *
 * That is not hypothetical: `0090` tightened
 * `sale_return_items.product_name_snapshot` to NOT NULL, and `0052` writes
 * exactly that column as NULL on purpose — its own comment says "Unknown
 * provenance stays explicitly unknown", because inventing a name from the
 * current catalog would fabricate sale-time evidence on a legally binding
 * credit note.
 *
 * Each fixture seeds the shape a REAL customer DB carries at a point in the
 * chain, then replays everything after it. The seeds are deliberately written
 * as pre-migration state rather than as the rows a later migration produces:
 * letting the migration itself derive the row is what keeps the fixture honest
 * when that migration changes.
 *
 * Adding a tightening means adding a fixture here. That is the point.
 *
 * @module __tests__/migration-replay-nonempty.test
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type DatabaseType from 'better-sqlite3';

import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

const MIGRATIONS = resolve(process.cwd(), 'src/db/migrations');

interface HistoricalFixture {
  /** What a customer DB carries here that an empty one does not. */
  name: string;
  /** Journal index the seed is written at; everything after it is replayed. */
  afterIdx: number;
  /** Why a real database has this shape. */
  because: string;
  seed: (sqlite: DatabaseType.Database) => void;
  /** Asserted on the fully migrated database. */
  survives: (sqlite: DatabaseType.Database) => void;
}

const FIXTURES: HistoricalFixture[] = [
  {
    name: 'a full-ticket return recorded before line snapshots existed',
    // Seeded just before 0052, so 0052's own backfill derives the return line
    // and decides for itself what the snapshots should be.
    afterIdx: 51,
    because:
      'sale_items.product_name_snapshot is nullable and stays NULL for sales written before the ' +
      'snapshot columns existed; 0052 copies it VERBATIM into sale_return_items rather than ' +
      'substituting the catalog name',
    seed: sqlite => {
      sqlite.exec(`
        INSERT INTO tenants (id, name, slug) VALUES ('tenant-legacy', 'Legacy', 'legacy');
        INSERT INTO companies (id, tenant_id, name) VALUES ('company-legacy', 'tenant-legacy', 'Legacy');
        INSERT INTO sites (id, tenant_id, company_id, name)
          VALUES ('site-legacy', 'tenant-legacy', 'company-legacy', 'Central');
        INSERT INTO users (id, tenant_id, name, email, password_hash, role)
          VALUES ('user-legacy', 'tenant-legacy', 'Cashier', 'legacy@example.test', 'unused', 'admin');
        INSERT INTO products (id, tenant_id, name, sku)
          VALUES ('product-legacy', 'tenant-legacy', 'Renamed since', 'SKU-LEGACY');
        -- A completed sale must name its cash session (chk_sales_cash_session_or_draft),
        -- and a returned sale is necessarily completed.
        INSERT INTO cash_sessions (id, tenant_id, site_id, cashier_id, register_name, opening_count_denominations)
          VALUES ('cash-legacy', 'tenant-legacy', 'site-legacy', 'user-legacy', 'Caja 1', '[]');
        INSERT INTO sales (id, tenant_id, sale_number, total, status, created_by, cash_session_id)
          VALUES ('sale-legacy', 'tenant-legacy', 'VTA-LEGACY-1', 10, 'completed', 'user-legacy', 'cash-legacy');
        -- The load-bearing part: both snapshots NULL, as a pre-snapshot sale has.
        INSERT INTO sale_items (id, sale_id, product_id, product_name_snapshot, product_sku_snapshot, quantity, unit_price, total)
          VALUES ('sale-item-legacy', 'sale-legacy', 'product-legacy', NULL, NULL, 1, 10, 10);
        INSERT INTO sale_returns (id, tenant_id, sale_id, refund_amount, created_by)
          VALUES ('sale-return-legacy', 'tenant-legacy', 'sale-legacy', 10, 'user-legacy');
      `);
    },
    survives: sqlite => {
      const row = sqlite
        .prepare(
          'SELECT product_name_snapshot AS name, product_sku_snapshot AS sku ' +
            'FROM sale_return_items WHERE sale_return_id = ?'
        )
        .get('sale-return-legacy') as { name: string | null; sku: string | null } | undefined;
      // The row must exist AND must still say "unknown". A migration that
      // backfilled it with the catalog's current name would pass the replay
      // and quietly fabricate evidence, so assert the value, not just survival.
      expect(row, 'the legacy return line was dropped by the replay').toBeDefined();
      expect(row?.name).toBeNull();
      expect(row?.sku).toBeNull();
    },
  },
];

let workdir: string | null = null;

afterEach(() => {
  closeDatabase();
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = null;
});

/** A migrations folder whose journal stops after `afterIdx`. */
function migrationsPrefix(afterIdx: number): string {
  const prefix = join(workdir!, 'migrations');
  cpSync(MIGRATIONS, prefix, { recursive: true });
  const journalPath = join(prefix, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number }>;
  };
  const kept = journal.entries.filter(entry => entry.idx <= afterIdx);
  // Guards the guard: an off-by-one that kept the whole chain would make the
  // replay a no-op and every assertion below vacuous.
  expect(kept.length, 'journal prefix is not shorter than the full chain').toBeLessThan(
    journal.entries.length
  );
  expect(kept).toHaveLength(afterIdx + 1);
  journal.entries = kept;
  writeFileSync(journalPath, JSON.stringify(journal));
  return prefix;
}

function rawClient(): DatabaseType.Database {
  return (getDatabase() as unknown as { $client: DatabaseType.Database }).$client;
}

describe('migration replay against a non-empty database', () => {
  for (const fixture of FIXTURES) {
    it(`survives ${fixture.name}`, async () => {
      workdir = mkdtempSync(join(tmpdir(), 'puntovivo-replay-'));
      const dbPath = join(workdir, 'history.db');

      await initDatabase({
        dbPath,
        seedData: false,
        migrationsFolder: migrationsPrefix(fixture.afterIdx),
      });
      fixture.seed(rawClient());
      closeDatabase();

      // The rest of the chain, exactly as a customer's upgrade runs it.
      await initDatabase({ dbPath, seedData: false, migrationsFolder: MIGRATIONS });
      fixture.survives(rawClient());
    }, 180_000);
  }

  it('declares a fixture for every point the chain is seeded at', () => {
    // A fixture pinned past the end of the journal would silently replay
    // nothing at all.
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const lastIdx = Math.max(...journal.entries.map(entry => entry.idx));
    expect(FIXTURES.length).toBeGreaterThan(0);
    for (const fixture of FIXTURES) {
      expect(fixture.afterIdx, fixture.name).toBeLessThan(lastIdx);
      expect(fixture.because.length, `${fixture.name} needs a reason`).toBeGreaterThan(40);
    }
  });
});
