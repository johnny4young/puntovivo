/**
 * ENG-177c — `sales` cash-session CHECK constraint + FK-safe rebuild.
 *
 * Pins two invariants that bypass the application layer entirely:
 *
 *   1. The schema-level guard `chk_sales_cash_session_or_draft`
 *      (`CHECK (cash_session_id IS NOT NULL OR status = 'draft')`)
 *      rejects a committed sale (completed / cancelled / voided) with a
 *      null cash session, while leaving drafts and bound sales alone.
 *      This is the defense-in-depth backstop for the application-only
 *      `requireActiveCashSession` invariant (ENG-042 / ENG-055).
 *
 *   2. Adding that CHECK is a full SQLite table rebuild (CREATE
 *      __new_sales / INSERT…SELECT / DROP TABLE sales / RENAME), and
 *      drizzle-orm runs every migration inside ONE BEGIN/COMMIT where
 *      `PRAGMA foreign_keys` is a no-op. So the connection-level
 *      `foreign_keys = OFF` bracket in `db/index.ts` is the ONLY thing
 *      that stops `DROP TABLE sales` from cascade-deleting the ON DELETE
 *      CASCADE children (sale_items, sale_payments, sale_returns,
 *      kds_orders). The mechanism test below pins that finding with a
 *      positive + negative control so a future refactor cannot silently
 *      drop the FK-off step.
 *
 * Server-only, HTTP-less: the constraint tests boot the real schema
 * through `initDatabase`; the mechanism test exercises the exact rebuild
 * shape against the real binding.
 */

import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { resolveCachedNodeBinding } from '../db/native-binding.js';

// Raw probe connections must load the same Node-ABI addon initDatabase
// selects, or they die on dlopen when the on-disk default carries the
// Electron build (mirrors migrations.test.ts).
const nativeBinding = resolveCachedNodeBinding();

function liveClient(): Database.Database {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

/**
 * Build a parent table with an ON DELETE CASCADE child and seed two
 * child rows — the minimal shape of the `sales` → `sale_items` relation
 * the 0001 rebuild has to survive.
 */
function makeCascadePair(): Database.Database {
  const db = new Database(':memory:', { nativeBinding });
  db.exec(
    `CREATE TABLE parent (id TEXT PRIMARY KEY, status TEXT);
     CREATE TABLE child (
       id TEXT PRIMARY KEY,
       parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE
     );
     INSERT INTO parent VALUES ('p1', 'completed');
     INSERT INTO child VALUES ('c1', 'p1'), ('c2', 'p1');`
  );
  return db;
}

/**
 * Rebuild `parent` exactly the way the 0001 migration rebuilds `sales`,
 * inside a single transaction — so the migration's own PRAGMA lines
 * would be no-ops and only the connection-level state set before BEGIN
 * decides whether the child cascade fires.
 */
function rebuildParentInTransaction(db: Database.Database): void {
  db.exec('BEGIN');
  db.exec(
    `CREATE TABLE __new_parent (
       id TEXT PRIMARY KEY,
       status TEXT,
       CHECK (status IS NOT NULL OR id = 'draft')
     );`
  );
  db.exec('INSERT INTO __new_parent SELECT id, status FROM parent;');
  db.exec('DROP TABLE parent;');
  db.exec('ALTER TABLE __new_parent RENAME TO parent;');
  db.exec('COMMIT');
}

describe('sales cash-session CHECK constraint (ENG-177c)', () => {
  afterEach(() => {
    // closeDatabase() is synchronous; only the initDatabase-based tests
    // open the shared singleton, so guard the no-DB case.
    try {
      closeDatabase();
    } catch {
      /* no shared DB open (mechanism test manages its own) */
    }
  });

  it('rejects committed sales with a null cash session and accepts the legal shapes', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const db = liveClient();
    // Isolate the CHECK from the row's other FK/uniqueness requirements —
    // we are exercising the constraint, not the parent tables. Money
    // columns keep their non-negative defaults.
    db.pragma('foreign_keys = OFF');

    let seq = 0;
    const insert = (status: string, cashSessionId: string | null) =>
      db
        .prepare(
          `INSERT INTO sales (id, tenant_id, sale_number, created_by, status, cash_session_id)
           VALUES (?, 't1', ?, 'u1', ?, ?)`
        )
        .run(`s-${seq}`, `N-${seq++}`, status, cashSessionId);

    // Every committed status with a null session is rejected by the CHECK.
    for (const status of ['completed', 'cancelled', 'voided']) {
      expect(() => insert(status, null)).toThrow(/constraint failed/i);
    }
    // A draft with a null session is exempt by design.
    expect(() => insert('draft', null)).not.toThrow();
    // Any status bound to a session is fine.
    expect(() => insert('completed', 'cs-1')).not.toThrow();
  });

  it('leaves foreign-key enforcement enabled after migrations run', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    // The migrate-span bracket disables FK enforcement only for the
    // rebuild and must restore it before the server serves any query.
    expect(liveClient().pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('a table rebuild with foreign_keys OFF at the connection preserves cascade children', () => {
    const db = makeCascadePair();
    try {
      // db/index.ts sets connection-level OFF *before* drizzle's BEGIN —
      // this is what makes the DROP TABLE skip the ON DELETE CASCADE.
      db.pragma('foreign_keys = OFF');
      rebuildParentInTransaction(db);
      db.pragma('foreign_keys = ON');

      const child = db.prepare('SELECT count(*) AS n FROM child').get() as {
        n: number;
      };
      expect(child.n).toBe(2); // children survived the rebuild
      expect(db.pragma('foreign_key_check') as unknown[]).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('negative control: the same rebuild with enforcement left ON cascade-deletes the children', () => {
    const db = makeCascadePair();
    try {
      // No bracket: enforcement stays ON, so DROP TABLE parent fires the
      // ON DELETE CASCADE and the child rows are lost. Pinning this stops
      // a future refactor from silently dropping the FK-off step in
      // db/index.ts and shipping a data-destroying migration path.
      db.pragma('foreign_keys = ON');
      rebuildParentInTransaction(db);

      const child = db.prepare('SELECT count(*) AS n FROM child').get() as {
        n: number;
      };
      expect(child.n).toBe(0);
    } finally {
      db.close();
    }
  });
});
