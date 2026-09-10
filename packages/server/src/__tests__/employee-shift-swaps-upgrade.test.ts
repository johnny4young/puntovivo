/** Fresh/historical encrypted restarts preserve consent, claims, immutable lineage and existing attendance. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { createShiftSwap, advanceShiftSwap } from '../application/workforce/shift-swaps.js';
import type { WorkforceCommandContext } from '../application/workforce/writer.js';
const raw = () => (getDatabase() as unknown as { $client: Database.Database }).$client;
const tables = [
  'employee_shift_swaps',
  'employee_shift_swap_claims',
  'employee_shift_swap_events',
  'scheduled_shifts',
  'employee_shifts',
];
const snapshot = () =>
  Object.fromEntries(
    tables.map(table => [table, raw().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
  );
function context(id: 'admin' | 'worker' | 'cashier'): WorkforceCommandContext {
  return {
    db: getDatabase(),
    tenantId: 'tenant',
    user: {
      id,
      email: `${id}@example.test`,
      role: id === 'worker' ? 'viewer' : id,
      tenantId: 'tenant',
    },
    envelope: {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    },
    completeInTransaction: () => {},
  };
}
const seed = () =>
  raw().exec(`
  INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP');
  INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company');
  INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central');
  INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES ('admin','tenant','Admin','admin@example.test','unused','admin'),('worker','tenant','Worker','worker@example.test','unused','viewer'),('cashier','tenant','Cashier','cashier@example.test','unused','cashier');
  INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO');
  INSERT INTO scheduled_shifts(id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id,notes) VALUES
  ('a','tenant','worker','site','2030-09-09T13:00:00.000Z','2030-09-09T21:00:00.000Z','America/Bogota','admin','admin','Original intent'),
  ('b','tenant','cashier','site','2030-09-10T13:00:00.000Z','2030-09-10T21:00:00.000Z','America/Bogota','admin','admin',NULL);
  INSERT INTO employee_shifts(id,tenant_id,site_id,user_id,clocked_in_at,clocked_out_at) VALUES ('historic','tenant','site','worker','2026-01-05T13:00:00.000Z','2026-01-05T21:00:00.000Z');
`);
for (const encrypted of [false, true])
  describe(`shift swap storage encrypted=${encrypted}`, () => {
    it.each(['fresh', 'historical'] as const)(
      'preserves explicit consent and replacement decisions after %s boot',
      async origin => {
        const directory = mkdtempSync(join(tmpdir(), 'puntovivo-swap-upgrade-')),
          dbPath = join(directory, 'history.db'),
          prefix = join(directory, 'migrations'),
          encryption = encrypted ? { encryptionKey: 'ae'.repeat(32) } : {};
        try {
          if (origin === 'historical') {
            cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
            const journalPath = join(prefix, 'meta/_journal.json'),
              journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
                entries: Array<{ idx: number }>;
              };
            journal.entries = journal.entries.filter(entry => entry.idx < 74);
            expect(journal.entries).toHaveLength(74);
            writeFileSync(journalPath, JSON.stringify(journal));
            await initDatabase({
              dbPath,
              seedData: false,
              migrationsFolder: prefix,
              ...encryption,
            });
            expect(
              raw()
                .prepare("SELECT name FROM sqlite_master WHERE name='employee_shift_swaps'")
                .get()
            ).toBeUndefined();
          } else await initDatabase({ dbPath, seedData: false, ...encryption });
          seed();
          const originals = raw().prepare('SELECT * FROM scheduled_shifts ORDER BY rowid').all(),
            attendance = raw().prepare('SELECT * FROM employee_shifts').all();
          closeDatabase();
          await initDatabase({ dbPath, seedData: false, ...encryption });
          expect(snapshot()).toEqual({
            employee_shift_swaps: [],
            employee_shift_swap_claims: [],
            employee_shift_swap_events: [],
            scheduled_shifts: originals,
            employee_shifts: attendance,
          });
          const row = await createShiftSwap(context('worker'), {
            offeredShiftId: 'a',
            requestedShiftId: 'b',
            offeredVersion: 1,
            requestedVersion: 1,
            reason: 'Explicit employee exchange',
          });
          await advanceShiftSwap(context('cashier'), {
            id: row.id,
            expectedVersion: 1,
            status: 'accepted',
          });
          let expected = snapshot();
          closeDatabase();
          await initDatabase({ dbPath, seedData: false, ...encryption });
          expect(snapshot()).toEqual(expected);
          await advanceShiftSwap(context('admin'), {
            id: row.id,
            expectedVersion: 2,
            status: 'approved',
          });
          expected = snapshot();
          expect(expected.employee_shift_swap_events).toHaveLength(3);
          expect(expected.employee_shift_swap_claims).toEqual([]);
          expect(expected.scheduled_shifts).toHaveLength(4);
          const journal = raw().prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all();
          for (let boot = 0; boot < 2; boot++) {
            closeDatabase();
            await initDatabase({ dbPath, seedData: false, ...encryption });
            expect(snapshot()).toEqual(expected);
            expect(raw().prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()).toEqual(
              journal
            );
            expect(raw().prepare('SELECT * FROM employee_shifts').all()).toEqual(attendance);
            expect(raw().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
            expect(raw().prepare('PRAGMA integrity_check').get()).toEqual({
              integrity_check: 'ok',
            });
          }
          closeDatabase();
          if (encrypted) {
            expect(readFileSync(dbPath).subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
            const unreadable = new Database(dbPath, { readonly: true });
            try {
              expect(() =>
                unreadable.prepare('SELECT * FROM employee_shift_swaps').all()
              ).toThrow();
            } finally {
              unreadable.close();
            }
          }
        } finally {
          closeDatabase();
          rmSync(directory, { recursive: true, force: true });
        }
      }
    );
  });
