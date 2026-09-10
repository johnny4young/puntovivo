/** No invented orders on migration; sealed credentials and durable replay survive plaintext/encrypted restarts. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { createServer, type PuntovivoServer } from '../index.js';
import {
  externalOrderConnectors,
  externalOrderEvents,
  externalOrderNonces,
  externalOrderReceipts,
  externalOrders,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import {
  createCriticalCommandFixture,
  freshCriticalContext,
} from './utils/criticalCommandFixture.js';
import { prepareSandboxEnvelope } from '../services/external-orders/simulator.js';
import { receiveExternalOrder } from '../application/external-orders/receive.js';
import { openExternalOrderSecret } from '../services/external-orders/secret-box.js';
const encryptionKey = 'bc'.repeat(32),
  externalOrderSecretKey = 'cd'.repeat(32);
describe('External inbox historical upgrade and restart', () => {
  for (const encrypted of [false, true])
    it(`retains signed receipt identity and sealed secrets (encrypted=${encrypted})`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'puntovivo-external-upgrade-')),
        dbPath = join(directory, 'history.db'),
        prefix = join(directory, 'migrations');
      const encryption = encrypted ? { encryptionKey } : {};
      let server: PuntovivoServer | undefined;
      try {
        cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: Array<{ idx: number }>;
        };
        journal.entries = journal.entries.filter(entry => entry.idx < 69);
        expect(journal.entries).toHaveLength(69);
        writeFileSync(journalPath, JSON.stringify(journal));
        await initDatabase({ dbPath, seedData: false, migrationsFolder: prefix, ...encryption });
        const sqlite = (getDatabase() as unknown as { $client: Database.Database }).$client;
        sqlite.exec(`INSERT INTO tenants(id,name,slug,settings) VALUES ('tenant','External','external','{"modules":{"delivery":true}}');
    INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','External');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES ('admin','tenant','Admin','external@example.test','unused','admin');`);
        closeDatabase();
        server = await createServer({
          dbPath,
          seedData: false,
          externalOrderSecretKey,
          ...encryption,
        });
        let db = getDatabase();
        expect(db.select().from(externalOrderConnectors).all()).toEqual([]);
        expect(db.select().from(externalOrders).all()).toEqual([]);
        const fixture = await createCriticalCommandFixture({
          db,
          serverApp: server.app,
          tenantId: 'tenant',
          siteId: 'site',
          userId: 'admin',
          email: 'external@example.test',
          role: 'admin',
        });
        const caller = appRouter.createCaller(fixture.context),
          secret = randomBytes(32).toString('base64url');
        const connector = await caller.externalOrders.createConnector({
          siteId: 'site',
          name: 'Persistent sandbox',
          adapter: 'sandbox_v1',
          secret,
        });
        const body = JSON.stringify({
          schemaVersion: 1,
          eventId: 'original',
          orderId: 'external-1',
          kind: 'order.created',
          order: {
            customerName: 'Customer',
            address: 'Address',
            currencyCode: 'COP',
            quotedTotal: 100,
            items: [{ productCode: 'SKU', quantity: 1 }],
          },
        });
        const envelope = prepareSandboxEnvelope(connector.id, secret, body);
        // A second real connection owns the writer; do not simulate SQLITE_BUSY
        // by throwing from a mock. Retry the exact identity after it releases.
        const currentClient = (db as unknown as { $client: Database.Database }).$client,
          originalTimeout = currentClient.pragma('busy_timeout', { simple: true }) as number,
          competingWriter = new Database(dbPath);
        try {
          if (encrypted) {
            competingWriter.pragma("cipher = 'sqlcipher'");
            competingWriter.pragma('legacy = 4');
            competingWriter.pragma(`key = "x'${encryptionKey}'"`);
          }
          currentClient.pragma('busy_timeout = 1');
          competingWriter.exec('BEGIN IMMEDIATE');
          const anonymous = appRouter.createCaller({
            ...fixture.context,
            tenantId: null,
            siteId: null,
            user: null,
          });
          await expect(anonymous.externalOrders.receive(envelope)).rejects.toMatchObject({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'External orders are temporarily unavailable; retry the same request',
          });
          for (const table of [
            externalOrders,
            externalOrderEvents,
            externalOrderReceipts,
            externalOrderNonces,
          ])
            expect(db.select().from(table).all()).toEqual([]);
        } finally {
          if (competingWriter.inTransaction) competingWriter.exec('ROLLBACK');
          competingWriter.close();
          currentClient.pragma(`busy_timeout = ${originalTimeout}`);
        }
        const receipt = receiveExternalOrder(db, envelope);
        const before = {
          orders: db.select().from(externalOrders).all(),
          events: db.select().from(externalOrderEvents).all(),
          receipts: db.select().from(externalOrderReceipts).all(),
          nonces: db.select().from(externalOrderNonces).all(),
          connectors: db.select().from(externalOrderConnectors).all(),
        };
        expect(JSON.stringify(before.connectors)).not.toContain(secret);
        expect(before.orders).toHaveLength(1);
        await server.close();
        server = undefined;
        if (encrypted)
          expect(readFileSync(dbPath).subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
        for (let boot = 0; boot < 2; boot++) {
          server = await createServer({
            dbPath,
            seedData: false,
            externalOrderSecretKey,
            ...encryption,
          });
          db = getDatabase();
          expect(receiveExternalOrder(db, envelope)).toEqual(receipt);
          expect({
            orders: db.select().from(externalOrders).all(),
            events: db.select().from(externalOrderEvents).all(),
            receipts: db.select().from(externalOrderReceipts).all(),
            nonces: db.select().from(externalOrderNonces).all(),
            connectors: db.select().from(externalOrderConnectors).all(),
          }).toEqual(before);
          expect(
            openExternalOrderSecret(before.connectors[0]!.sealedSecret, {
              tenantId: 'tenant',
              connectorId: connector.id,
            })
          ).toBe(secret);
          const current = (db as unknown as { $client: Database.Database }).$client;
          expect(current.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          expect(current.prepare('PRAGMA integrity_check').get()).toEqual({
            integrity_check: 'ok',
          });
          expect(current.prepare('SELECT count(*) AS count FROM sales').get()).toEqual({
            count: 0,
          });
          const admin = appRouter.createCaller(
            freshCriticalContext({
              db,
              serverApp: server.app,
              tenantId: 'tenant',
              siteId: 'site',
              userId: 'admin',
              email: 'external@example.test',
              role: 'admin',
              deviceId: fixture.deviceId,
            })
          );
          expect((await admin.externalOrders.connectors({ siteId: 'site' })).rows[0]).toEqual(
            connector
          );
          await server.close();
          server = undefined;
        }
      } finally {
        await server?.close();
        closeDatabase();
        rmSync(directory, { recursive: true, force: true });
      }
    });
});
