import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { seedProviderPayableScenario } from './db';

const DB_PATH = join(process.cwd(), 'packages/server/data/local.db');

/** Historical account fixture only; invoice creation is exercised through UI. */
export function seedProviderPurchasePickerScenario(seed: string) {
  const scenario = seedProviderPayableScenario(seed);
  const db = new Database(DB_PATH);
  db.pragma(`busy_timeout = ${Number(process.env.PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS) || 5000}`);
  try {
    db.transaction(() => {
      db.prepare('update purchases set created_at = ? where tenant_id = ? and id = ?').run(
        '2020-01-01T00:00:00.000Z',
        scenario.tenantId,
        scenario.purchase.id
      );
      const insertPurchase = db.prepare(`
        insert into purchases (
          id, tenant_id, purchase_number, provider_id, site_id, status,
          subtotal, total, created_by, created_at, updated_at
        ) values (?, ?, ?, ?, ?, 'completed', 10, 10, ?, ?, ?)
      `);
      const insertItem = db.prepare(`
        insert into purchase_items (
          id, purchase_id, product_id, quantity, unit_id, unit_equivalence,
          cost_per_unit, base_unit_cost, total
        ) values (?, ?, ?, 1, ?, 1, 10, 10, 10)
      `);
      // Exactly 100 newer documents pushed this still-uninvoiced purchase out
      // of the old modal. Do not create invoices just to make it reachable.
      for (let index = 0; index < 100; index += 1) {
        const id = randomUUID();
        const timestamp = new Date(Date.UTC(2021, 0, 1, 0, 0, index)).toISOString();
        insertPurchase.run(
          id,
          scenario.tenantId,
          `PICKER-${id}`,
          scenario.provider.id,
          scenario.sites[index % scenario.sites.length]!.id,
          scenario.manager.id,
          timestamp,
          timestamp
        );
        insertItem.run(randomUUID(), id, scenario.product.id, scenario.product.unitId);
      }
    })();
    return scenario;
  } finally {
    db.close();
  }
}

/** Independent persisted invoice evidence, scoped to this fixture's owner. */
export function readPickerInvoiceEvidence(
  tenantId: string,
  providerId: string,
  purchaseId: string
) {
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma(`busy_timeout = ${Number(process.env.PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS) || 5000}`);
  try {
    return db
      .prepare(
        `
      select id, purchase_id as purchaseId, site_id as siteId,
        document_number as documentNumber, amount
      from provider_payable_invoices
      where tenant_id = ? and provider_id = ? and purchase_id = ?
    `
      )
      .all(tenantId, providerId, purchaseId);
  } finally {
    db.close();
  }
}
