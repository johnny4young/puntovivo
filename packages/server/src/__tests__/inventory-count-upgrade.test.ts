/** Count adoption is additive: historical aggregate lines never gain invented identities. */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { ensureMigrationBaseline } from '../db/migration-baseline.js';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

describe('inventory count identity upgrade', () => {
  it('never stamps the identity migration as absent on a mixed partial schema', () => {
    const sql = new Database(':memory:');
    try {
      sql.exec(
        'CREATE TABLE purchases(id TEXT PRIMARY KEY); CREATE TABLE purchase_items(id TEXT PRIMARY KEY); CREATE TABLE inventory_lots(id TEXT PRIMARY KEY)'
      );
      const migrations = resolve(process.cwd(), 'src/db/migrations');
      ensureMigrationBaseline(sql, migrations);
      const hash = createHash('sha256')
        .update(readFileSync(join(migrations, '0079_inventory_count_identities.sql')))
        .digest('hex');
      expect(
        sql.prepare('SELECT id FROM __drizzle_migrations WHERE hash=?').get(hash)
      ).toBeUndefined();
    } finally {
      sql.close();
    }
  });

  for (const encrypted of [false, true]) {
    it(`preserves history and custody revisions through restart (encrypted=${encrypted})`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'puntovivo-count-upgrade-'));
      const dbPath = join(directory, 'history.db');
      const prefix = join(directory, 'migrations');
      const encryption = encrypted ? { encryptionKey: 'ef'.repeat(32) } : {};
      try {
        cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: Array<{ idx: number }>;
        };
        journal.entries = journal.entries.filter(entry => entry.idx < 79);
        expect(journal.entries).toHaveLength(79);
        writeFileSync(journalPath, JSON.stringify(journal));
        await initDatabase({ dbPath, seedData: false, migrationsFolder: prefix, ...encryption });
        const old = getDatabase().$client;
        old.exec(`
          INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP');
          INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company');
          INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central');
          INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES ('admin','tenant','Admin','count@example.test','unused','admin');
          INSERT INTO units(id,tenant_id,name,abbreviation) VALUES ('unit','tenant','Unit','UND');
          INSERT INTO products(id,tenant_id,name,sku,price,price2,price3,cost,initial_cost) VALUES ('product','tenant','Product','SKU',10,10,10,4,4);
          INSERT INTO inventory_count_sessions(id,tenant_id,site_id,status,created_by) VALUES ('count','tenant','site','approved','admin');
          INSERT INTO inventory_count_lines(id,tenant_id,session_id,product_id,unit_id,expected_quantity,counted_quantity,discrepancy) VALUES ('line','tenant','count','product','unit',2,1,-1);
          INSERT INTO inventory_lots(id,tenant_id,site_id,product_id,lot_number,on_hand,unit_cost,status) VALUES ('lot','tenant','site','product','LOT',2,4,'recalled');
          INSERT INTO product_serials(id,tenant_id,current_site_id,product_id,serial_number,status,unit_cost) VALUES ('serial','tenant','site','product','SERIAL','returned',4);
        `);
        const historicalStatuses = [
          'queued',
          'retrying',
          'submitting',
          'conflict',
          'dead_letter',
          'synced',
        ];
        const outboxInsert = old.prepare(
          'INSERT INTO sync_outbox(id,tenant_id,status,entity_type,entity_id,operation,payload,attempts,next_retry_at,last_error,claim_token,locked_at,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        for (const entity of ['inventory_count_sessions', 'inventory_count_lines', 'products']) {
          for (const status of historicalStatuses) {
            outboxInsert.run(
              `${entity}-${status}`,
              'tenant',
              status,
              entity,
              'historical-id',
              'update',
              '{"history":true}',
              2,
              '2026-09-07',
              '{"message":"retained"}',
              'old-claim',
              '2026-09-05',
              '2026-09-01',
              '2026-09-05'
            );
          }
        }
        closeDatabase();
        await initDatabase({ dbPath, seedData: false, ...encryption });
        const sql = getDatabase().$client;
        expect(
          sql
            .prepare(
              'SELECT tracking_mode,expected_quantity,counted_quantity,discrepancy FROM inventory_count_lines'
            )
            .get()
        ).toEqual({
          tracking_mode: 'aggregate',
          expected_quantity: 2,
          counted_quantity: 1,
          discrepancy: -1,
        });
        expect(sql.prepare('SELECT * FROM inventory_count_identities').all()).toEqual([]);
        expect(
          sql
            .prepare(
              'SELECT expected_valuation_version,expected_valuation_quantity,expected_inventory_value_cents,expected_cogs_value_cents,cogs_unit_cost_snapshot FROM inventory_count_lines'
            )
            .get()
        ).toEqual({
          expected_valuation_version: null,
          expected_valuation_quantity: null,
          expected_inventory_value_cents: null,
          expected_cogs_value_cents: null,
          cogs_unit_cost_snapshot: null,
        });
        for (const entity of ['inventory_count_sessions', 'inventory_count_lines', 'products']) {
          for (const status of historicalStatuses) {
            const adopted = entity !== 'products' && status !== 'synced';
            expect(
              sql
                .prepare(
                  'SELECT status,payload,attempts,next_retry_at,last_error,claim_token,locked_at,created_at,updated_at FROM sync_outbox WHERE id=?'
                )
                .get(`${entity}-${status}`)
            ).toEqual({
              status: adopted ? 'local_only' : status,
              payload: '{"history":true}',
              attempts: 2,
              next_retry_at: adopted ? null : '2026-09-07',
              last_error: '{"message":"retained"}',
              claim_token: adopted ? null : 'old-claim',
              locked_at: adopted ? null : '2026-09-05',
              created_at: '2026-09-01',
              updated_at: '2026-09-05',
            });
          }
        }

        expect(
          sql.prepare('SELECT status,on_hand,unit_cost,custody_version FROM inventory_lots').get()
        ).toEqual({ status: 'recalled', on_hand: 2, unit_cost: 4, custody_version: 0 });
        expect(
          sql
            .prepare(
              'SELECT status,stock_status_before_missing,custody_version FROM product_serials'
            )
            .get()
        ).toEqual({ status: 'returned', stock_status_before_missing: null, custody_version: 0 });
        sql.exec(
          "UPDATE inventory_lots SET sync_version=10,updated_at='2026-09-06',sync_status='synced'; UPDATE product_serials SET sync_version=10,updated_at='2026-09-06',sync_status='synced'"
        );
        expect(sql.prepare('SELECT custody_version FROM inventory_lots').get()).toEqual({
          custody_version: 0,
        });
        expect(sql.prepare('SELECT custody_version FROM product_serials').get()).toEqual({
          custody_version: 0,
        });
        sql.exec(
          "UPDATE inventory_lots SET on_hand=3; UPDATE inventory_lots SET on_hand=2; UPDATE product_serials SET status='missing',stock_status_before_missing='returned'"
        );
        closeDatabase();
        await initDatabase({ dbPath, seedData: false, ...encryption });
        expect(
          getDatabase()
            .$client.prepare('SELECT status,on_hand,custody_version FROM inventory_lots')
            .get()
        ).toEqual({ status: 'recalled', on_hand: 2, custody_version: 2 });
        expect(
          getDatabase()
            .$client.prepare(
              'SELECT status,stock_status_before_missing,custody_version FROM product_serials'
            )
            .get()
        ).toEqual({
          status: 'missing',
          stock_status_before_missing: 'returned',
          custody_version: 1,
        });
        expect(getDatabase().$client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        closeDatabase();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
