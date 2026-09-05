/** New/historical encrypted availability storage, no inferred preferences and repeatable boots. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { employeeAvailability, employeeAvailabilityEvents } from '../db/schema.js';
import {
  createAvailability,
  replaceAvailability,
  voidAvailability,
} from '../application/workforce/availability.js';
import type { WorkforceCommandContext } from '../application/workforce/writer.js';
for (const encrypted of [false, true])
  describe(`availability upgrade encrypted=${encrypted}`, () => {
    it('adopts without inferred availability and preserves weekly decisions and attendance across restarts', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'puntovivo-availability-upgrade-')),
        dbPath = join(directory, 'history.db'),
        prefix = join(directory, 'migrations');
      const encryption = encrypted ? { encryptionKey: 'da'.repeat(32) } : {};
      try {
        cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json'),
          journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
            entries: Array<{ idx: number }>;
          };
        journal.entries = journal.entries.filter(entry => entry.idx < 72);
        expect(journal.entries).toHaveLength(72);
        writeFileSync(journalPath, JSON.stringify(journal));
        await initDatabase({ dbPath, seedData: false, migrationsFolder: prefix, ...encryption });
        const before = (getDatabase() as unknown as { $client: Database.Database }).$client;
        expect(
          before.prepare("SELECT name FROM sqlite_master WHERE name='employee_availability'").get()
        ).toBeUndefined();
        before.exec(`
        INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP');
        INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company');
        INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central');
        INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES ('admin','tenant','Admin','admin@example.test','unused','admin'),('worker','tenant','Worker','worker@example.test','unused','viewer');
        INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO');
        INSERT INTO employee_shifts(id,tenant_id,site_id,user_id,clocked_in_at,clocked_out_at) VALUES ('historic','tenant','site','worker','2026-01-05T08:00:00.000Z','2026-01-05T16:00:00.000Z');
      `);
        const attendance = before.prepare('SELECT * FROM employee_shifts').all();
        closeDatabase();
        await initDatabase({ dbPath, seedData: false, ...encryption });
        const db = getDatabase(),
          sqlite = (db as unknown as { $client: Database.Database }).$client;
        expect(db.select().from(employeeAvailability).all()).toEqual([]);
        expect(db.select().from(employeeAvailabilityEvents).all()).toEqual([]);
        expect(sqlite.prepare('SELECT * FROM employee_shifts').all()).toEqual(attendance);
        const ctx = (): WorkforceCommandContext => ({
          db,
          tenantId: 'tenant',
          user: { id: 'admin', email: 'admin@example.test', role: 'admin', tenantId: 'tenant' },
          envelope: {
            operationId: randomUUID(),
            idempotencyKey: randomUUID(),
            clientCreatedAt: new Date().toISOString(),
          },
          // Storage/restart proof only; actual middleware completion/replay is exercised by router tests.
          completeInTransaction: () => {},
        });
        const first = await createAvailability(ctx(), {
          userId: 'worker',
          fromDate: '2026-09-07',
          untilDate: null,
          slots: [{ weekday: 1, startMinute: 480, endMinute: 960 }],
          reason: 'Explicit operational availability',
        });
        const next = await replaceAvailability(ctx(), {
          id: first.id,
          expectedVersion: 1,
          fromDate: '2026-09-14',
          slots: [],
          reason: 'Explicit weekly coverage change',
        });
        await voidAvailability(ctx(), {
          id: next.id,
          expectedVersion: 1,
          reason: 'Explicit removal of restriction',
        });
        const expected = {
          rows: db.select().from(employeeAvailability).all(),
          events: db.select().from(employeeAvailabilityEvents).all(),
        };
        expect(expected.rows).toHaveLength(2);
        expect(expected.events).toHaveLength(4);
        expect(() => sqlite.prepare('UPDATE employee_availability SET version=0').run()).toThrow();
        expect(() =>
          sqlite.prepare("UPDATE employee_availability SET slots_json='{}'").run()
        ).toThrow();
        expect(() =>
          sqlite
            .prepare("UPDATE employee_availability SET replaces_id='missing' WHERE id=?")
            .run(next.id)
        ).toThrow();
        closeDatabase();
        if (encrypted)
          expect(readFileSync(dbPath).subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
        for (let boot = 0; boot < 2; boot++) {
          await initDatabase({ dbPath, seedData: false, ...encryption });
          const current = getDatabase(),
            raw = (current as unknown as { $client: Database.Database }).$client;
          expect({
            rows: current.select().from(employeeAvailability).all(),
            events: current.select().from(employeeAvailabilityEvents).all(),
          }).toEqual(expected);
          expect(raw.prepare('SELECT * FROM employee_shifts').all()).toEqual(attendance);
          expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          expect(raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
          closeDatabase();
        }
      } finally {
        closeDatabase();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
