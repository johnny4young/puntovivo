/** Historical delivery queues survive upgrade and encrypted restart without invented evidence. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import {
  restaurantReservations,
  reservationEvents,
  deliveryOrderEvents,
  deliveryOrders,
} from '../db/schema.js';

const migrations = resolve(process.cwd(), 'src/db/migrations');
const key = 'ab'.repeat(32);

describe('Delivery fulfillment upgrade', () => {
  for (const encrypted of [false, true]) {
    it(`retains every legacy field and unknown provenance (encrypted=${encrypted})`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'puntovivo-delivery-upgrade-'));
      const dbPath = join(directory, 'historical.db');
      const prefix = join(directory, 'migrations');
      const encryption = encrypted ? { encryptionKey: key } : {};
      try {
        cpSync(migrations, prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: Array<{ idx: number }>;
        };
        journal.entries = journal.entries.filter(entry => entry.idx < 67);
        expect(journal.entries).toHaveLength(67);
        writeFileSync(journalPath, JSON.stringify(journal));
        await initDatabase({ dbPath, seedData: false, migrationsFolder: prefix, ...encryption });
        const old = (getDatabase() as unknown as { $client: Database.Database }).$client;
        old.exec(`
          INSERT INTO tenants (id, name, slug) VALUES ('tenant', 'Delivery', 'delivery');
          INSERT INTO companies (id, tenant_id, name) VALUES ('company', 'tenant', 'Delivery');
          INSERT INTO sites (id, tenant_id, company_id, name) VALUES ('site', 'tenant', 'company', 'Central');
          INSERT INTO delivery_orders (id, tenant_id, site_id, customer_name, address, items_snapshot, status, total_amount, accepted_at)
          VALUES ('legacy', 'tenant', 'site', 'Recipient', 'Address', '{historical malformed', 'delivered', 12.34, '2025-01-01 00:00:00');
        `);
        const before = old.prepare('SELECT * FROM delivery_orders').get();
        closeDatabase();
        if (encrypted)
          expect(readFileSync(dbPath).subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
        for (let boot = 0; boot < 2; boot++) {
          await initDatabase({ dbPath, seedData: false, ...encryption });
          const db = getDatabase();
          const sqlite = (db as unknown as { $client: Database.Database }).$client;
          const row = sqlite.prepare('SELECT * FROM delivery_orders').get();
          expect(row).toEqual({
            ...(before as object),
            source: 'legacy',
            currency_code: null,
            version: 1,
            cancellation_reason: null,
          });
          expect(db.select().from(deliveryOrderEvents).all()).toEqual([]);
          expect(db.select().from(restaurantReservations).all()).toEqual([]);
          expect(db.select().from(reservationEvents).all()).toEqual([]);
          expect(db.select().from(deliveryOrders).all()).toHaveLength(1);
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
