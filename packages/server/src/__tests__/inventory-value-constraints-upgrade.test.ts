import Database from 'better-sqlite3';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../db/index.js';
import { sites, users } from '../db/schema.js';

/** Rebuild qualification uses an actual prior journal, not a schema fabricated by the test. */
describe('inventory constraint migration preservation', () => {
  it('retains rowid gaps, child rows, FTS projections and live custody triggers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-value-constraints-'));
    const folder = resolve('src/db/migrations');
    const prefix = join(dir, 'migrations');
    const dbPath = join(dir, 'history.db');
    try {
      cpSync(folder, prefix, { recursive: true });
      const journalPath = join(prefix, 'meta/_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 89);
      expect(journal.entries).toHaveLength(89);
      writeFileSync(journalPath, JSON.stringify(journal));
      const old = await initDatabase({ dbPath, migrationsFolder: prefix, seedData: true });
      const owner = old.select().from(users).get()!;
      const site = old.select().from(sites).get()!;
      const sqlite = old.$client;
      for (const [rowid, id, lots] of [
        [701, 'alpha', 0],
        [703, 'deleted', 0],
        [709, 'batch', 1],
      ] as const) {
        sqlite
          .prepare(
            'INSERT INTO products(rowid,id,tenant_id,name,sku,tracks_lots) VALUES(?,?,?,?,?,?)'
          )
          .run(rowid, id, owner.tenantId, `Constraint${id}`, id, lots);
      }
      sqlite.prepare('DELETE FROM products WHERE id=?').run('deleted');
      sqlite
        .prepare(
          'INSERT INTO inventory_lots(id,tenant_id,site_id,product_id,lot_number,on_hand,unit_cost,carrying_value_cents,valuation_quantity) VALUES(?,?,?,?,?,1,1,100,1)'
        )
        .run('batch-layer', owner.tenantId, site.id, 'batch', 'CONSTRAINT-LOT');
      sqlite
        .prepare(
          'INSERT INTO inventory_balances(id,tenant_id,site_id,product_id,on_hand) VALUES(?,?,?,?,1)'
        )
        .run('batch-balance', owner.tenantId, site.id, 'batch');
      sqlite
        .prepare('INSERT INTO sales(id,tenant_id,created_by,sale_number,status) VALUES(?,?,?,?,?)')
        .run('constraint-sale', owner.tenantId, owner.id, 'CONSTRAINT-SALE', 'draft');
      sqlite
        .prepare('INSERT INTO sale_items(id,sale_id,product_id,quantity) VALUES(?,?,?,1)')
        .run('constraint-line', 'constraint-sale', 'alpha');
      const rowids = sqlite.prepare('SELECT rowid,id FROM products ORDER BY rowid').all();
      const counts = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'"
        )
        .all() as { name: string }[];
      const before = Object.fromEntries(
        counts.map(({ name }) => [
          name,
          sqlite.prepare(`SELECT count(*) AS n FROM "${name}"`).get(),
        ])
      );
      const originalTriggers = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
        .all();
      closeDatabase();

      const upgraded = await initDatabase({ dbPath, seedData: false });
      const current = upgraded.$client;
      expect(current.prepare('SELECT rowid,id FROM products ORDER BY rowid').all()).toEqual(rowids);
      for (const [name, count] of Object.entries(before))
        expect(current.prepare(`SELECT count(*) AS n FROM "${name}"`).get(), name).toEqual(count);
      expect(
        current.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all()
      ).toEqual(originalTriggers);
      expect(
        current.prepare('SELECT product_id FROM sale_items WHERE id=?').get('constraint-line')
      ).toEqual({ product_id: 'alpha' });
      expect(
        current
          .prepare(
            "SELECT product_id,rowid FROM product_search_fts WHERE product_search_fts MATCH 'Constraintalpha'"
          )
          .all()
      ).toEqual([{ product_id: 'alpha', rowid: 701 }]);
      current.prepare('UPDATE products SET name=? WHERE id=?').run('Renamedconstraint', 'alpha');
      expect(
        current
          .prepare(
            "SELECT product_id FROM product_search_fts WHERE product_search_fts MATCH 'Renamedconstraint'"
          )
          .all()
      ).toEqual([{ product_id: 'alpha' }]);
      expect(
        current
          .prepare(
            "SELECT product_id FROM product_search_fts WHERE product_search_fts MATCH 'Constraintalpha'"
          )
          .all()
      ).toEqual([]);
      current
        .prepare('INSERT INTO products(id,tenant_id,name,sku) VALUES(?,?,?,?)')
        .run('new-product', owner.tenantId, 'Newconstraint', 'NEW-CONSTRAINT');
      expect(
        current
          .prepare(
            "SELECT product_id FROM product_search_fts WHERE product_search_fts MATCH 'Newconstraint'"
          )
          .all()
      ).toEqual([{ product_id: 'new-product' }]);
      current.prepare('DELETE FROM products WHERE id=?').run('new-product');
      expect(
        current
          .prepare(
            "SELECT product_id FROM product_search_fts WHERE product_search_fts MATCH 'Newconstraint'"
          )
          .all()
      ).toEqual([]);
      const revisions = current
        .prepare('SELECT custody_version,valuation_version FROM inventory_lots WHERE id=?')
        .get('batch-layer') as { custody_version: number; valuation_version: number };
      current
        .prepare('UPDATE inventory_lots SET carrying_value_cents=99 WHERE id=?')
        .run('batch-layer');
      expect(
        current
          .prepare('SELECT custody_version,valuation_version FROM inventory_lots WHERE id=?')
          .get('batch-layer')
      ).toEqual({
        custody_version: revisions.custody_version + 1,
        valuation_version: revisions.valuation_version + 1,
      });
      expect(current.pragma('foreign_key_check')).toEqual([]);
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back the entire rebuild rather than guessing a partial historical basis', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-invalid-value-'));
    const prefix = join(dir, 'migrations');
    const file = join(dir, 'history.db');
    let sqlite: Database.Database | undefined;
    try {
      const folder = resolve('src/db/migrations');
      cpSync(folder, prefix, { recursive: true });
      const journalPath = join(prefix, 'meta/_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 89);
      writeFileSync(journalPath, JSON.stringify(journal));
      const old = await initDatabase({ dbPath: file, migrationsFolder: prefix, seedData: true });
      const owner = old.select().from(users).get()!;
      old.$client
        .prepare(
          'INSERT INTO products(id,tenant_id,name,sku,inventory_value_cents) VALUES(?,?,?,?,100)'
        )
        .run('incomplete', owner.tenantId, 'Incomplete', 'INCOMPLETE');
      closeDatabase();
      sqlite = new Database(file);
      // Mirror the migrator's connection-level FK envelope. This test targets
      // SQL rollback; the previous case qualifies normal boot through initDatabase.
      sqlite.pragma('foreign_keys=OFF');
      const schemaBefore = sqlite
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE type IN ('table','trigger','index') ORDER BY type,name"
        )
        .all();
      const statements = readFileSync(
        join(folder, '0090_inventory_value_constraints.sql'),
        'utf8'
      ).split('--> statement-breakpoint');
      const connection = sqlite;
      expect(() =>
        connection.transaction(() => {
          for (const statement of statements) connection.exec(statement);
        })()
      ).toThrowError(/valuation_basis/);
      expect(
        sqlite
          .prepare(
            "SELECT name,sql FROM sqlite_master WHERE type IN ('table','trigger','index') ORDER BY type,name"
          )
          .all()
      ).toEqual(schemaBefore);
      expect(
        sqlite
          .prepare(
            'SELECT inventory_value_cents,cogs_value_cents,valuation_quantity FROM products WHERE id=?'
          )
          .get('incomplete')
      ).toEqual({ inventory_value_cents: 100, cogs_value_cents: null, valuation_quantity: null });
      sqlite.pragma('foreign_keys=ON');
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      closeDatabase();
      sqlite?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
