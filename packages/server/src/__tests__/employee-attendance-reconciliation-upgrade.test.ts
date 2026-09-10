/** Fresh/historical plain and encrypted restarts preserve frozen plan outcomes without backfill. */
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { recordAttendanceReconciliation } from '../application/workforce/attendance-reconciliation.js';
import type { WorkforceCommandContext } from '../application/workforce/writer.js';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

const raw = () => (getDatabase() as unknown as { $client: Database.Database }).$client;
const tables = [
  'employee_shift_reconciliations',
  'employee_shift_reconciliation_events',
  'scheduled_shifts',
  'employee_shifts',
];
const snapshot = () =>
  Object.fromEntries(
    tables.map(table => [table, raw().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
  );
function context(): WorkforceCommandContext {
  return {
    db: getDatabase(),
    tenantId: 'tenant',
    user: {
      id: 'manager',
      email: 'manager@example.test',
      role: 'manager',
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
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('worker','tenant','Worker','worker@example.test','unused','cashier');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO');
    INSERT INTO scheduled_shifts(
      id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id
    ) VALUES ('plan','tenant','worker','site','2026-01-05T13:00:00.000Z','2026-01-05T21:00:00.000Z','America/Bogota','manager','manager');
    INSERT INTO employee_shifts(id,tenant_id,site_id,user_id,clocked_in_at,clocked_out_at)
      VALUES ('actual','tenant','site','worker','2026-01-05T13:10:00.000Z','2026-01-05T21:00:00.000Z');
  `);

for (const encrypted of [false, true])
  describe(`attendance reconciliation storage encrypted=${encrypted}`, () => {
    it.each(['fresh', 'historical'] as const)(
      'adds no invented outcome and preserves explicit revisions after %s boot',
      async origin => {
        const directory = mkdtempSync(join(tmpdir(), 'puntovivo-attendance-reconciliation-')),
          dbPath = join(directory, 'history.db'),
          prefix = join(directory, 'migrations'),
          encryption = encrypted ? { encryptionKey: 'ce'.repeat(32) } : {};
        try {
          if (origin === 'historical') {
            cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
            const journalPath = join(prefix, 'meta/_journal.json');
            const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
              entries: Array<{ idx: number }>;
            };
            journal.entries = journal.entries.filter(entry => entry.idx < 75);
            expect(journal.entries).toHaveLength(75);
            writeFileSync(journalPath, JSON.stringify(journal));
            await initDatabase({
              dbPath,
              seedData: false,
              migrationsFolder: prefix,
              ...encryption,
            });
            expect(
              raw()
                .prepare(
                  "SELECT name FROM sqlite_master WHERE name='employee_shift_reconciliations'"
                )
                .get()
            ).toBeUndefined();
          } else await initDatabase({ dbPath, seedData: false, ...encryption });
          seed();
          const schedule = raw().prepare('SELECT * FROM scheduled_shifts').all();
          const attendance = raw().prepare('SELECT * FROM employee_shifts').all();
          closeDatabase();
          await initDatabase({ dbPath, seedData: false, ...encryption });
          expect(snapshot()).toEqual({
            employee_shift_reconciliations: [],
            employee_shift_reconciliation_events: [],
            scheduled_shifts: schedule,
            employee_shifts: attendance,
          });
          const linked = await recordAttendanceReconciliation(context(), {
            scheduledShiftId: 'plan',
            scheduledShiftVersion: 1,
            expectedVersion: 0,
            outcome: 'attended',
            employeeShiftId: 'actual',
            reason: 'Reviewed original terminal evidence',
          });
          expect(linked).toMatchObject({ outcome: 'attended', version: 1 });
          let expected = snapshot();
          closeDatabase();
          await initDatabase({ dbPath, seedData: false, ...encryption });
          expect(snapshot()).toEqual(expected);
          await recordAttendanceReconciliation(context(), {
            scheduledShiftId: 'plan',
            scheduledShiftVersion: 1,
            expectedVersion: 1,
            outcome: 'no_show',
            employeeShiftId: null,
            reason: 'Revised after manager evidence review',
          });
          expected = snapshot();
          expect(expected.employee_shift_reconciliation_events).toHaveLength(2);
          const migrations = raw().prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all();
          for (let boot = 0; boot < 2; boot++) {
            closeDatabase();
            await initDatabase({ dbPath, seedData: false, ...encryption });
            expect(snapshot()).toEqual(expected);
            expect(raw().prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()).toEqual(
              migrations
            );
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
                unreadable.prepare('SELECT * FROM employee_shift_reconciliations').all()
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
