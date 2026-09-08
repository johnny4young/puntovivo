import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../db/index.js';

/** Storage-only coverage copies the actual migrated DDL, isolating CHECKs from unrelated FKs. */
describe('inventory value storage boundary', () => {
  let source: Database.Database;
  beforeAll(async () => {
    source = (await initDatabase({ dbPath: ':memory:', seedData: false })).$client;
  });
  afterAll(() => closeDatabase());

  function fixture(table: string) {
    const target = new Database(':memory:');
    target.pragma('foreign_keys = OFF');
    const ddl = source
      .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', table) as { sql: string };
    target.exec(ddl.sql);
    const columns = target.pragma(`table_info("${table}")`) as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
    }>;
    const required = columns.filter(column => column.notnull && column.dflt_value === null);
    const values = required.map(column =>
      column.name === 'kind' && table === 'inventory_count_identities'
        ? 'lots'
        : column.type === 'TEXT'
          ? 'fixture'
          : 1
    );
    target
      .prepare(
        `INSERT INTO "${table}" (${required.map(c => `"${c.name}"`).join(',')}) VALUES (${required.map(() => '?').join(',')})`
      )
      .run(...values);
    return target;
  }

  it('rejects non-integer and unsafe cents in every migrated value column', () => {
    const tables = source
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    let exercised = 0;
    for (const { name } of tables) {
      const columns = source.pragma(`table_info("${name}")`) as { name: string }[];
      const cents = columns.filter(column => column.name.endsWith('_cents'));
      if (!cents.length) continue;
      const db = fixture(name);
      try {
        // The legacy all-null row above is valid. Test malformed input directly;
        // the named error proves the cent guard, not an unrelated FK, rejected it.
        for (const column of cents) {
          for (const invalid of [0.5, Number.MAX_SAFE_INTEGER + 1, 'corrupt', Infinity]) {
            expect(
              () => db.prepare(`UPDATE "${name}" SET "${column.name}" = ?`).run(invalid),
              `${name}.${column.name}: ${invalid}`
            ).toThrowError(new RegExp(`chk_${name}_${column.name}_safe_integer`));
          }
          exercised++;
        }
      } finally {
        db.close();
      }
    }
    expect(exercised).toBeGreaterThanOrEqual(30);
  });

  it('requires complete product and lot bases without conflating unknown with zero', () => {
    for (const table of ['products', 'inventory_lots']) {
      const db = fixture(table);
      try {
        const field = table === 'products' ? 'inventory_value_cents' : 'carrying_value_cents';
        expect(() => db.prepare(`UPDATE ${table} SET ${field} = 0`).run()).toThrowError(
          /valuation_basis/
        );
        const fields =
          table === 'products'
            ? 'inventory_value_cents=0, cogs_value_cents=0, valuation_quantity=0'
            : 'carrying_value_cents=0, valuation_quantity=0';
        expect(() => db.exec(`UPDATE ${table} SET ${fields}`)).not.toThrow();
        expect(() => db.exec(`UPDATE ${table} SET ${field}=1`)).toThrowError(/empty_value/);
        expect(() => db.exec(`UPDATE ${table} SET valuation_quantity=1e999`)).toThrowError(
          /finite_quantity/
        );
        expect(() => db.exec(`UPDATE ${table} SET valuation_version=0.5`)).toThrowError(
          /safe_integer/
        );
        expect(() => db.exec(`UPDATE ${table} SET valuation_version=-1`)).toThrowError(
          /safe_integer/
        );
        if (table === 'products') {
          expect(() =>
            db.exec(
              'UPDATE products SET inventory_value_cents=-100, cogs_value_cents=-100, valuation_quantity=-1'
            )
          ).not.toThrow();
        } else {
          expect(() =>
            db.exec('UPDATE inventory_lots SET carrying_value_cents=-1, valuation_quantity=1')
          ).toThrowError(/safe_integer/);
        }
      } finally {
        db.close();
      }
    }
  });
});
