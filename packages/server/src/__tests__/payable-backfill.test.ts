import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The 0102 backfill turns every legacy single-purchase invoice into a bridge
 * row. Replaying the whole chain for one INSERT would be the honest-but-slow
 * way; this test replays the REAL backfill SQL — read verbatim from the
 * migration file — against a minimal pre-0102 shape and asserts the invariants
 * the migration promises.
 */
const migrationPath = join(
  import.meta.dirname,
  '../db/migrations/0102_provider_payable_invoice_purchases.sql'
);
const migrationSql = readFileSync(migrationPath, 'utf8');
const backfillSql = migrationSql.slice(migrationSql.indexOf('INSERT INTO'));

describe('0102 payable backfill', () => {
  it('bridges only invoices that carry a legacy purchase link', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');

    // Minimal pre-0102 shape of the two tables the backfill touches.
    db.exec(`
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
    `);

    db.prepare(
      "INSERT INTO provider_payable_invoices (id, tenant_id, purchase_id) VALUES ('inv-linked', 'tenant-1', 'purchase-1')"
    ).run();
    db.prepare(
      "INSERT INTO provider_payable_invoices (id, tenant_id, purchase_id) VALUES ('inv-opening', 'tenant-1', NULL)"
    ).run();

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
});
