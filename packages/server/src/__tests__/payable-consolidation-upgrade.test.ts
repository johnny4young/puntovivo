import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { closeDatabase, initDatabase } from '../db/index.js';
import { rawSqliteClient } from '../db/raw-client.js';
import { sites, users } from '../db/schema.js';

const folder = resolve(process.cwd(), 'src/db/migrations');

/** 0115 rebuilds provider_payable_invoices to carry the tax_amount checks. */
describe('0115 provider payable upgrade', () => {
  it.each([false, true])(
    'keeps invoices, their allocations and links through the rebuild (encrypted=%s)',
    async encrypted => {
      const dir = mkdtempSync(join(tmpdir(), 'puntovivo-payable-upgrade-'));
      const dbPath = join(dir, 'history.db');
      const prefix = join(dir, 'migrations');
      const encryption = encrypted ? { encryptionKey: 'cd'.repeat(32) } : {};
      try {
        cpSync(folder, prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: Array<{ idx: number }>;
        };
        journal.entries = journal.entries.filter(row => row.idx < 115);
        writeFileSync(journalPath, JSON.stringify(journal));

        const old = await initDatabase({
          dbPath,
          seedData: true,
          migrationsFolder: prefix,
          ...encryption,
        });
        const owner = old.select().from(users).get()!;
        const tenantId = owner.tenantId;
        const siteId = old.select().from(sites).get()!.id;
        const client = rawSqliteClient(old)!;
        const columns = client
          .prepare('SELECT name FROM pragma_table_info(?)')
          .all('provider_payable_invoices') as Array<{ name: string }>;
        expect(columns.map(column => column.name)).not.toContain('tax_amount');

        client
          .prepare('INSERT INTO providers(id,tenant_id,name) VALUES (?,?,?)')
          .run('legacy-provider', tenantId, 'Legacy supplier');
        client
          .prepare(
            "INSERT INTO purchases(id,tenant_id,purchase_number,provider_id,site_id,created_by,status,subtotal,total) VALUES (?,?,?,?,?,?,'completed',100,100)"
          )
          .run('legacy-purchase', tenantId, 'LEG-1', 'legacy-provider', siteId, owner.id);
        const insertInvoice = client.prepare(
          "INSERT INTO provider_payable_invoices(id,tenant_id,provider_id,site_id,purchase_id,kind,document_number,issued_at,due_at,amount,created_by,created_at) VALUES (?,?,?,?,?,'invoice',?,'2026-10-01','2026-10-31',?,?,'2026-10-01T00:00:00.000Z')"
        );
        insertInvoice.run(
          'legacy-linked',
          tenantId,
          'legacy-provider',
          siteId,
          'legacy-purchase',
          'FAC-1',
          100,
          owner.id
        );
        insertInvoice.run(
          'legacy-unlinked',
          tenantId,
          'legacy-provider',
          siteId,
          null,
          'FAC-2',
          50,
          owner.id
        );
        client
          .prepare(
            "INSERT INTO provider_payable_payments(id,tenant_id,provider_id,site_id,amount,method,paid_at,created_by) VALUES (?,?,?,?,40,'transfer','2026-10-05',?)"
          )
          .run('legacy-payment', tenantId, 'legacy-provider', siteId, owner.id);
        client
          .prepare(
            "INSERT INTO provider_payable_allocations(id,tenant_id,provider_id,invoice_id,source_type,payment_id,amount,created_by) VALUES (?,?,?,?,'payment',?,40,?)"
          )
          .run(
            'legacy-allocation',
            tenantId,
            'legacy-provider',
            'legacy-linked',
            'legacy-payment',
            owner.id
          );
        closeDatabase();

        const upgraded = await initDatabase({ dbPath, seedData: false, ...encryption });
        const sqlite = rawSqliteClient(upgraded)!;
        try {
          expect(
            sqlite
              .prepare(
                'SELECT id, purchase_id, amount, tax_amount FROM provider_payable_invoices ORDER BY id'
              )
              .all()
          ).toEqual([
            { id: 'legacy-linked', purchase_id: 'legacy-purchase', amount: 100, tax_amount: 0 },
            { id: 'legacy-unlinked', purchase_id: null, amount: 50, tax_amount: 0 },
          ]);
          expect(
            sqlite.prepare('SELECT id, invoice_id FROM provider_payable_allocations').all()
          ).toEqual([{ id: 'legacy-allocation', invoice_id: 'legacy-linked' }]);
          expect(
            sqlite
              .prepare('SELECT id, invoice_id, purchase_id FROM provider_payable_invoice_purchases')
              .all()
          ).toEqual([
            {
              id: 'legacy-payable-link:legacy-linked:legacy-purchase',
              invoice_id: 'legacy-linked',
              purchase_id: 'legacy-purchase',
            },
          ]);
          expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

          const setTax = sqlite.prepare(
            "UPDATE provider_payable_invoices SET tax_amount = ? WHERE id = 'legacy-unlinked'"
          );
          expect(() => setTax.run(-1)).toThrow(/chk_provider_payable_invoices_tax_nonneg/);
          expect(() => setTax.run(1.005)).toThrow(/chk_provider_payable_invoices_tax_2dec/);
          expect(() => setTax.run(9.5)).not.toThrow();
          // The rebuilt table keeps its unique indexes.
          expect(() => insertInvoiceAgain(sqlite, tenantId, siteId, owner.id, 'FAC-1')).toThrow(
            /UNIQUE constraint failed/
          );
        } finally {
          closeDatabase();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});

function insertInvoiceAgain(
  sqlite: Database.Database,
  tenantId: string,
  siteId: string,
  userId: string,
  documentNumber: string
) {
  return sqlite
    .prepare(
      "INSERT INTO provider_payable_invoices(id,tenant_id,provider_id,site_id,kind,document_number,issued_at,due_at,amount,created_by) VALUES ('duplicate',?,'legacy-provider',?,'invoice',?,'2026-10-01','2026-10-31',10,?)"
    )
    .run(tenantId, siteId, documentNumber, userId);
}
