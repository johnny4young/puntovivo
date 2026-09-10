/** No inferred leave on upgrade; explicit private decisions survive encrypted restart. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { employeeTimeOff, employeeTimeOffEvents } from '../db/schema.js';
import {
  createTimeOff,
  advanceTimeOff,
  type TimeOffCommandContext,
} from '../application/workforce/time-off.js';

for (const encrypted of [false, true]) {
  describe(`time-off additive upgrade (encrypted=${encrypted})`, () => {
    it('preserves actual attendance without inventing requests, and retains decisions through two restarts', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'puntovivo-time-off-upgrade-'));
      const dbPath = join(directory, 'history.db'),
        prefix = join(directory, 'migrations');
      const encryptionKey = 'ef'.repeat(32),
        encryption = encrypted ? { encryptionKey } : {};
      try {
        cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: Array<{ idx: number }>;
        };
        journal.entries = journal.entries.filter(entry => entry.idx < 71);
        expect(journal.entries).toHaveLength(71);
        writeFileSync(journalPath, JSON.stringify(journal));
        await initDatabase({ dbPath, seedData: false, migrationsFolder: prefix, ...encryption });
        const before = (getDatabase() as unknown as { $client: Database.Database }).$client;
        expect(
          before.prepare("SELECT name FROM sqlite_master WHERE name='employee_time_off'").get()
        ).toBeUndefined();
        before.exec(`
          INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP');
          INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company');
          INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central');
          INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
            ('admin','tenant','Admin','admin@example.test','unused','admin'),
            ('worker','tenant','Worker','worker@example.test','unused','viewer');
          INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO');
          INSERT INTO employee_shifts(id,tenant_id,site_id,user_id,clocked_in_at,clocked_out_at)
          VALUES ('historical','tenant','site','worker','2026-01-05T08:00:00.000Z','2026-01-05T16:00:00.000Z');
        `);
        const attendance = before.prepare('SELECT * FROM employee_shifts').all();
        closeDatabase();
        await initDatabase({ dbPath, seedData: false, ...encryption });
        const db = getDatabase(),
          current = (db as unknown as { $client: Database.Database }).$client;
        expect(db.select().from(employeeTimeOff).all()).toEqual([]);
        expect(db.select().from(employeeTimeOffEvents).all()).toEqual([]);
        expect(current.prepare('SELECT * FROM employee_shifts').all()).toEqual(attendance);
        const ctx = (): TimeOffCommandContext => ({
          db,
          tenantId: 'tenant',
          user: { id: 'admin', email: 'admin@example.test', role: 'admin', tenantId: 'tenant' },
          envelope: {
            operationId: randomUUID(),
            idempotencyKey: randomUUID(),
            clientCreatedAt: new Date().toISOString(),
          },
          // Storage test only; real middleware replay/completion is covered by employee-time-off.test.
          completeInTransaction: () => {},
        });
        const input = {
          userId: 'worker',
          siteId: 'site',
          kind: 'leave' as const,
          fromDate: '2026-09-07',
          untilDate: '2026-09-09',
          reason: 'Private operational absence explanation',
        };
        const competitor = new Database(dbPath),
          timeout = current.pragma('busy_timeout', { simple: true }) as number;
        try {
          if (encrypted) {
            competitor.pragma("cipher = 'sqlcipher'");
            competitor.pragma('legacy = 4');
            competitor.pragma(`key = "x'${encryptionKey}'"`);
          }
          current.pragma('busy_timeout=1');
          competitor.exec('BEGIN IMMEDIATE');
          await expect(createTimeOff(ctx(), input)).rejects.toThrow();
          expect(db.select().from(employeeTimeOff).all()).toEqual([]);
          expect(db.select().from(employeeTimeOffEvents).all()).toEqual([]);
        } finally {
          if (competitor.inTransaction) competitor.exec('ROLLBACK');
          competitor.close();
          current.pragma(`busy_timeout=${timeout}`);
        }
        const created = await createTimeOff(ctx(), input);
        const approved = await advanceTimeOff(ctx(), {
          id: created.id,
          siteId: created.siteId,
          expectedVersion: 1,
          status: 'approved',
          reason: 'Explicit approval with coverage',
        });
        await advanceTimeOff(ctx(), {
          id: approved.id,
          siteId: approved.siteId,
          expectedVersion: 2,
          status: 'cancelled',
          reason: 'Explicit cancellation of absence',
        });
        const expected = {
          rows: db.select().from(employeeTimeOff).all(),
          events: db.select().from(employeeTimeOffEvents).all(),
        };
        expect(expected.rows).toHaveLength(1);
        expect(expected.events).toHaveLength(3);
        expect(expected.rows[0]).toMatchObject({
          version: 3,
          status: 'cancelled',
          approvedByUserId: 'admin',
          approvedAt: expect.any(String),
        });
        closeDatabase();
        if (encrypted)
          expect(readFileSync(dbPath).subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
        for (let boot = 0; boot < 2; boot++) {
          await initDatabase({ dbPath, seedData: false, ...encryption });
          const restarted = getDatabase(),
            sqlite = (restarted as unknown as { $client: Database.Database }).$client;
          expect({
            rows: restarted.select().from(employeeTimeOff).all(),
            events: restarted.select().from(employeeTimeOffEvents).all(),
          }).toEqual(expected);
          expect(sqlite.prepare('SELECT * FROM employee_shifts').all()).toEqual(attendance);
          expect(sqlite.prepare('SELECT count(*) AS n FROM employment_contracts').get()).toEqual({
            n: 0,
          });
          expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
          closeDatabase();
        }
      } finally {
        closeDatabase();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
}
