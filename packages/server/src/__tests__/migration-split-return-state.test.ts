/**
 * Migration 0054 — splitting return state off payment_status.
 *
 * payment_status used to carry two independent axes, so writing a return
 * value destroyed the collection value. 0054 moves the return axis to its own
 * column and then recovers the collection state from the tenders actually
 * taken.
 *
 * The part worth pinning is what the migration does with NO evidence. A sale
 * written before `sale_payments` existed has no tender rows, and an unguarded
 * SUM over zero rows is 0 -- which reads as "nothing collected" and would
 * label a legacy ticket as still owed. The migration must leave those alone
 * rather than invent a receivable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0054_split_return_state.sql'),
  'utf8'
);

let workdir: string | null = null;

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = null;
});

/** The pre-0054 shape: no return_state column, tenders in their own table. */
function openPreMigrationDb(): Database.Database {
  workdir = mkdtempSync(join(tmpdir(), 'puntovivo-0054-'));
  const db = new Database(join(workdir, 'pre-0054.db'));
  db.exec(`
    CREATE TABLE sales (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      total REAL NOT NULL,
      payment_status TEXT NOT NULL
    );
    CREATE TABLE sale_payments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sale_id TEXT NOT NULL,
      amount REAL NOT NULL
    );
  `);
  return db;
}

function applyMigration(db: Database.Database): void {
  for (const statement of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = statement.trim();
    if (sql) db.exec(sql);
  }
}

function seedSale(
  db: Database.Database,
  sale: { id: string; total: number; paymentStatus: string; tenders?: number[] }
): void {
  db.prepare('INSERT INTO sales (id, tenant_id, total, payment_status) VALUES (?, ?, ?, ?)').run(
    sale.id,
    'tenant-1',
    sale.total,
    sale.paymentStatus
  );
  for (const [index, amount] of (sale.tenders ?? []).entries()) {
    db.prepare(
      'INSERT INTO sale_payments (id, tenant_id, sale_id, amount) VALUES (?, ?, ?, ?)'
    ).run(`${sale.id}-tender-${index}`, 'tenant-1', sale.id, amount);
  }
}

function readSale(db: Database.Database, id: string) {
  return db.prepare('SELECT payment_status, return_state FROM sales WHERE id = ?').get(id) as {
    payment_status: string;
    return_state: string | null;
  };
}

describe('migration 0054 splits the return axis without inventing collection state', () => {
  it('derives collection state only where tenders prove it', () => {
    const db = openPreMigrationDb();
    try {
      // Fully tendered and returned.
      seedSale(db, { id: 'paid', total: 100, paymentStatus: 'refunded', tenders: [60, 40] });
      // Partially tendered and returned.
      seedSale(db, {
        id: 'partial',
        total: 100,
        paymentStatus: 'partially_refunded',
        tenders: [30],
      });
      // Tendered then fully reversed: zero IS evidence here.
      seedSale(db, { id: 'reversed', total: 100, paymentStatus: 'refunded', tenders: [50, -50] });
      // Written before sale_payments existed: no evidence at all.
      seedSale(db, { id: 'legacy', total: 100, paymentStatus: 'refunded' });
      // Never returned: untouched by either statement.
      seedSale(db, { id: 'untouched', total: 100, paymentStatus: 'paid', tenders: [100] });

      applyMigration(db);

      expect(readSale(db, 'paid')).toEqual({ payment_status: 'paid', return_state: 'refunded' });
      expect(readSale(db, 'partial')).toEqual({
        payment_status: 'partial',
        return_state: 'partially_refunded',
      });
      expect(readSale(db, 'reversed')).toEqual({
        payment_status: 'pending',
        return_state: 'refunded',
      });

      // The whole point: no tender rows means no verdict. The legacy sentinel
      // stays, which the payment_status enum still accepts for exactly this.
      // Labelling it `pending` would assert a receivable that no evidence
      // supports, against a ticket most likely settled in cash.
      expect(readSale(db, 'legacy')).toEqual({
        payment_status: 'refunded',
        return_state: 'refunded',
      });

      expect(readSale(db, 'untouched')).toEqual({
        payment_status: 'paid',
        return_state: null,
      });
    } finally {
      db.close();
    }
  });

  it('scopes the tender lookup to the same tenant', () => {
    const db = openPreMigrationDb();
    try {
      seedSale(db, { id: 'scoped', total: 100, paymentStatus: 'refunded' });
      // Another tenant's tender against the same sale id must not count.
      db.prepare(
        'INSERT INTO sale_payments (id, tenant_id, sale_id, amount) VALUES (?, ?, ?, ?)'
      ).run('foreign-tender', 'tenant-2', 'scoped', 100);

      applyMigration(db);

      expect(readSale(db, 'scoped')).toEqual({
        payment_status: 'refunded',
        return_state: 'refunded',
      });
    } finally {
      db.close();
    }
  });
});
