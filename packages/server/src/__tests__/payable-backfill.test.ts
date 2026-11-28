import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The 0115 backfill turns every legacy single-purchase invoice into a bridge
 * row. Replaying the real backfill SQL — read verbatim from the migration file
 * — against a minimal pre-0115 shape verifies the migration's invariants.
 */
const migrationPath = join(
  import.meta.dirname,
  '../db/migrations/0115_provider_payable_invoice_purchases.sql'
);
const migrationSql = readFileSync(migrationPath, 'utf8');
const backfillSql = migrationSql.slice(migrationSql.indexOf('INSERT OR IGNORE INTO'));

const preMigrationShape = `
  CREATE TABLE provider_payable_invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    purchase_id TEXT,
    created_at TEXT
  );
  CREATE TABLE provider_payable_invoice_purchases (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    purchase_id TEXT NOT NULL,
    sync_status TEXT,
    sync_version INTEGER,
    created_at TEXT
  );
`;

type LinkedInvoice = {
  invoiceId: string;
  tenantId: string;
  purchaseId: string;
  createdAt: string;
};

/** The same commercial facts, seeded in a different order on each replica. */
const linkedInvoices: LinkedInvoice[] = [
  {
    invoiceId: 'inv-alpha',
    tenantId: 'tenant-1',
    purchaseId: 'purchase-alpha',
    createdAt: '2026-11-01 10:00:00',
  },
  {
    invoiceId: 'inv-beta',
    tenantId: 'tenant-1',
    purchaseId: 'purchase-beta',
    createdAt: '2026-11-02 10:00:00',
  },
  {
    invoiceId: 'inv-gamma',
    tenantId: 'tenant-2',
    purchaseId: 'purchase-gamma',
    createdAt: '2026-11-03 10:00:00',
  },
];

/**
 * One replica: an independent in-memory database carrying the same fixture.
 * `order` only changes row insertion order, never the facts themselves, so a
 * deterministic backfill must produce the same rows either way.
 */
async function buildReplica(order: LinkedInvoice[]): Promise<{ rows: unknown[] }> {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(preMigrationShape);
  const insert = db.prepare(
    'INSERT INTO provider_payable_invoices (id, tenant_id, purchase_id, created_at) VALUES (?, ?, ?, ?)'
  );
  for (const invoice of order) {
    insert.run(invoice.invoiceId, invoice.tenantId, invoice.purchaseId, invoice.createdAt);
  }
  db.exec(backfillSql);
  const rows = db
    .prepare(
      'SELECT id, tenant_id, invoice_id, purchase_id, sync_status, sync_version, created_at FROM provider_payable_invoice_purchases ORDER BY invoice_id'
    )
    .all();
  db.close();
  return { rows };
}

describe('0115 payable backfill', () => {
  it('bridges only invoices that carry a legacy purchase link', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');

    db.exec(preMigrationShape);

    db.prepare(
      "INSERT INTO provider_payable_invoices (id, tenant_id, purchase_id) VALUES ('inv-linked', 'tenant-1', 'purchase-1')"
    ).run();
    db.prepare(
      "INSERT INTO provider_payable_invoices (id, tenant_id, purchase_id) VALUES ('inv-opening', 'tenant-1', NULL)"
    ).run();

    db.exec(backfillSql);
    // Replaying the backfill statement must stay idempotent.
    db.exec(backfillSql);

    const bridge = db
      .prepare('SELECT invoice_id, purchase_id FROM provider_payable_invoice_purchases')
      .all() as Array<{ invoice_id: string; purchase_id: string }>;

    expect(bridge).toEqual([{ invoice_id: 'inv-linked', purchase_id: 'purchase-1' }]);
    // The migration's promise to a synced world: backfilled links start as
    // pending sync rows, exactly like a freshly created link.
    const statuses = db
      .prepare('SELECT sync_status, sync_version FROM provider_payable_invoice_purchases')
      .all() as Array<{ sync_status: string | null; sync_version: number | null }>;
    expect(statuses).toEqual([{ sync_status: 'pending', sync_version: 1 }]);

    db.close();
  });

  it('mints the same bridge rows, id included, on every replica', async () => {
    const first = await buildReplica(linkedInvoices);
    const second = await buildReplica([...linkedInvoices].reverse());

    expect(first.rows).toHaveLength(linkedInvoices.length);
    // Byte-identical is the whole point: two devices that ran this migration
    // against the same invoices must converge on one row per link, not on two
    // rows describing the same link under different identities.
    expect(second.rows).toEqual(first.rows);

    const ids = (first.rows as Array<{ id: string }>).map(row => row.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Order independence alone could still hide randomness that happens to be
    // seeded once per database. A replica that holds a single one of these
    // invoices must therefore mint that same id on its own: the identity is a
    // function of the row, never of its neighbours.
    for (const link of linkedInvoices) {
      const alone = await buildReplica([link]);
      const together = (first.rows as Array<{ id: string; invoice_id: string }>).find(
        row => row.invoice_id === link.invoiceId
      );
      expect(alone.rows).toEqual([together]);
    }
  });
});
