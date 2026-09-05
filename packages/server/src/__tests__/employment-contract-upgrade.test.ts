/** Additive upgrade invents no pay; explicit contract evidence survives encrypted restart. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { employmentContracts, employmentContractEvents } from '../db/schema.js';
import {
  createEmploymentContract,
  type EmploymentContractCommandContext,
} from '../application/workforce/contracts.js';

describe('employment contract upgrade and durability', () => {
  for (const encrypted of [false, true]) {
    it(`preserves existing attendance and explicit employment evidence (encrypted=${encrypted})`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'puntovivo-workforce-upgrade-'));
      const dbPath = join(directory, 'history.db');
      const prefix = join(directory, 'migrations');
      const encryptionKey = 'cd'.repeat(32);
      const encryption = encrypted ? { encryptionKey } : {};
      try {
        cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: Array<{ idx: number }>;
        };
        journal.entries = journal.entries.filter(entry => entry.idx < 70);
        expect(journal.entries).toHaveLength(70);
        writeFileSync(journalPath, JSON.stringify(journal));
        await initDatabase({ dbPath, seedData: false, migrationsFolder: prefix, ...encryption });
        const previous = (getDatabase() as unknown as { $client: Database.Database }).$client;
        expect(
          previous
            .prepare("SELECT name FROM sqlite_master WHERE name = 'employment_contracts'")
            .get()
        ).toBeUndefined();
        previous.exec(`
          INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP');
          INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company');
          INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central');
          INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES ('admin','tenant','Admin','workforce@example.test','unused','admin');
          INSERT INTO employee_shifts(id,tenant_id,site_id,user_id,clocked_in_at,clocked_out_at)
          VALUES ('historical','tenant','site','admin','2026-01-05T08:00:00.000Z','2026-01-05T16:00:00.000Z');
        `);
        const attendance = previous.prepare('SELECT * FROM employee_shifts').all();
        closeDatabase();
        await initDatabase({ dbPath, seedData: false, ...encryption });
        const db = getDatabase();
        const current = (db as unknown as { $client: Database.Database }).$client;
        expect(db.select().from(employmentContracts).all()).toEqual([]);
        expect(db.select().from(employmentContractEvents).all()).toEqual([]);
        expect(current.prepare('SELECT * FROM employee_shifts').all()).toEqual(attendance);
        const ctx: EmploymentContractCommandContext = {
          db,
          tenantId: 'tenant',
          user: { id: 'admin', email: 'workforce@example.test', role: 'admin', tenantId: 'tenant' },
          envelope: {
            operationId: randomUUID(),
            idempotencyKey: randomUUID(),
            clientCreatedAt: new Date().toISOString(),
          },
          // This storage test exercises the transaction, not middleware replay.
          completeInTransaction: () => {},
        };
        const input = {
          terms: {
            userId: 'admin',
            siteId: 'site',
            position: 'Store manager',
            effectiveFrom: '2026-01-01',
            currencyCode: 'COP',
            pay: { basis: 'monthly' as const, amount: 2500000 },
          },
          reason: 'Explicit historical employment evidence',
        };
        const competitor = new Database(dbPath);
        const previousTimeout = current.pragma('busy_timeout', { simple: true }) as number;
        try {
          if (encrypted) {
            competitor.pragma("cipher = 'sqlcipher'");
            competitor.pragma('legacy = 4');
            competitor.pragma(`key = "x'${encryptionKey}'"`);
          }
          current.pragma('busy_timeout = 1');
          competitor.exec('BEGIN IMMEDIATE');
          await expect(createEmploymentContract(ctx, input)).rejects.toThrow();
          expect(db.select().from(employmentContracts).all()).toEqual([]);
          expect(db.select().from(employmentContractEvents).all()).toEqual([]);
        } finally {
          if (competitor.inTransaction) competitor.exec('ROLLBACK');
          competitor.close();
          current.pragma(`busy_timeout = ${previousTimeout}`);
        }
        await createEmploymentContract(ctx, input);
        const expected = {
          contracts: db.select().from(employmentContracts).all(),
          events: db.select().from(employmentContractEvents).all(),
        };
        expect(expected.contracts).toHaveLength(1);
        expect(expected.events).toHaveLength(1);
        closeDatabase();
        if (encrypted)
          expect(readFileSync(dbPath).subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
        for (let boot = 0; boot < 2; boot++) {
          await initDatabase({ dbPath, seedData: false, ...encryption });
          const restarted = getDatabase();
          const sqlite = (restarted as unknown as { $client: Database.Database }).$client;
          expect({
            contracts: restarted.select().from(employmentContracts).all(),
            events: restarted.select().from(employmentContractEvents).all(),
          }).toEqual(expected);
          expect(sqlite.prepare('SELECT * FROM employee_shifts').all()).toEqual(attendance);
          expect(sqlite.prepare('SELECT count(*) AS count FROM sales').get()).toEqual({ count: 0 });
          expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
          closeDatabase();
        }
      } finally {
        closeDatabase();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
