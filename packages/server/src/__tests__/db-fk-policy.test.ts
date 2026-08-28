/**
 * pins the foreign-key onDelete policy documented in
 * docs/ARCHITECTURE.md. Three behaviours need explicit regression
 * coverage so a future schema edit cannot silently flip the contract:
 *
 * - CASCADE on parent-of-items relations (sale_items, quotation_items,
 * transfer_order_items, fiscal_document_items, sale_payments,
 * purchase_items, order_items). Deleting the parent must atomically
 * remove the child rows.
 * - SET NULL on optional context pointers (sync_outbox.device_id ->
 * devices). Deleting the device must null the pointer, NOT cascade.
 * - RESTRICT on the multi-tenant invariant and audit immutability.
 * Deleting a tenant while audit rows reference it must throw
 * FOREIGN KEY constraint failed.
 *
 * The tests use raw SQL inserts to bypass the application layer
 * (procedures may enforce additional guards). The point is to pin the
 * FK constraint behaviour at the SQLite layer where the schema lives.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

interface LiveDatabase {
  $client: Database.Database;
}

function db(): Database.Database {
  return (getDatabase() as unknown as LiveDatabase).$client;
}

function newId(): string {
  return nanoid();
}

const NOW = '2026-05-24T00:00:00.000Z';

function seedTenantAndUser(): { tenantId: string; userId: string } {
  const tenantId = newId();
  const userId = newId();
  db()
    .prepare(
      `INSERT INTO tenants (id, name, slug, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
    .run(tenantId, 'Tenant FK Test', `t-${tenantId.slice(0, 6)}`, NOW, NOW);
  db()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, name, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'admin', 1, ?, ?)`
    )
    .run(userId, tenantId, `${userId.slice(0, 6)}@fk.test`, 'FK Tester', 'x', NOW, NOW);
  return { tenantId, userId };
}

afterEach(() => {
  closeDatabase();
});

describe('FK onDelete cascade behaviour', () => {
  it('deletes sale_items when the parent sale is deleted (cascade)', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const { tenantId, userId } = seedTenantAndUser();

    const saleId = newId();
    // this exercises the sale → sale_items cascade, which is
    // status-agnostic. Use a draft (exempt from the new
    // chk_sales_cash_session_or_draft CHECK) so the fixture needs no
    // cash session; a draft cart legitimately carries line items.
    db()
      .prepare(
        `INSERT INTO sales (
          id, tenant_id, sale_number, created_by, status, payment_method,
          payment_status, subtotal, tax_amount, total, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'draft', 'cash', 'paid', 0, 0, 0, ?, ?)`
      )
      .run(saleId, tenantId, `S-${saleId.slice(0, 6)}`, userId, NOW, NOW);

    const productId = newId();
    db()
      .prepare(
        `INSERT INTO products (
          id, tenant_id, sku, name, price, cost, is_active,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, 0, 1, ?, ?)`
      )
      .run(productId, tenantId, `SKU-${productId.slice(0, 6)}`, 'p', NOW, NOW);

    const itemId = newId();
    db()
      .prepare(
        `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price)
         VALUES (?, ?, ?, 1, 100)`
      )
      .run(itemId, saleId, productId);

    db().prepare('DELETE FROM sales WHERE id = ?').run(saleId);

    const remaining = db()
      .prepare('SELECT COUNT(*) AS n FROM sale_items WHERE id = ?')
      .get(itemId) as { n: number };
    expect(remaining.n).toBe(0);
  });

  it('blocks tenant deletion while audit_logs reference it (multi-tenant + audit immutability)', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const { tenantId, userId } = seedTenantAndUser();

    db()
      .prepare(
        `INSERT INTO audit_logs (
          id, tenant_id, actor_id, action, resource_type, resource_id, created_at
        ) VALUES (?, ?, ?, 'test.action', 'test', 'r1', ?)`
      )
      .run(newId(), tenantId, userId, NOW);

    expect(() => db().prepare('DELETE FROM tenants WHERE id = ?').run(tenantId)).toThrow(
      /FOREIGN KEY constraint failed/
    );
  });

  it('keeps frozen sale tax lineage independent from a deleted rate catalog row', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const { tenantId, userId } = seedTenantAndUser();
    const rateId = newId();
    db()
      .prepare(
        `INSERT INTO vat_rates (id, tenant_id, name, rate, kind, created_at, updated_at)
         VALUES (?, ?, 'Temporary IVA', 19, 'iva', ?, ?)`
      )
      .run(rateId, tenantId, NOW, NOW);

    const saleId = newId();
    db()
      .prepare(
        `INSERT INTO sales (
          id, tenant_id, sale_number, created_by, status, payment_method,
          payment_status, subtotal, tax_amount, total, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'draft', 'cash', 'paid', 100, 19, 119, ?, ?)`
      )
      .run(saleId, tenantId, `S-${saleId.slice(0, 6)}`, userId, NOW, NOW);
    const productId = newId();
    db()
      .prepare(
        `INSERT INTO products (id, tenant_id, sku, name, price, cost, created_at, updated_at)
         VALUES (?, ?, ?, 'Frozen tax product', 119, 50, ?, ?)`
      )
      .run(productId, tenantId, `SKU-${productId.slice(0, 6)}`, NOW, NOW);
    const itemId = newId();
    db()
      .prepare(
        `INSERT INTO sale_items (
          id, sale_id, product_id, quantity, unit_price, tax_rate, tax_amount, total
        ) VALUES (?, ?, ?, 1, 119, 19, 19, 119)`
      )
      .run(itemId, saleId, productId);
    const componentId = newId();
    db()
      .prepare(
        `INSERT INTO sale_item_tax_components (
          id, tenant_id, sale_item_id, component_key, vat_rate_id, tax_kind,
          tax_rate, taxable_amount, tax_amount, position, created_at
        ) VALUES (?, ?, ?, ?, ?, 'iva', 19, 100, 19, 0, ?)`
      )
      .run(componentId, tenantId, itemId, `vat:${rateId}`, rateId, NOW);

    db().prepare('DELETE FROM vat_rates WHERE id = ?').run(rateId);

    expect(
      db()
        .prepare(
          'SELECT vat_rate_id AS vatRateId, tax_amount AS taxAmount FROM sale_item_tax_components WHERE id = ?'
        )
        .get(componentId)
    ).toEqual({ vatRateId: rateId, taxAmount: 19 });
  });

  it('blocks user deletion while audit_logs reference them (audit immutability)', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const { tenantId, userId } = seedTenantAndUser();

    db()
      .prepare(
        `INSERT INTO audit_logs (
          id, tenant_id, actor_id, action, resource_type, resource_id, created_at
        ) VALUES (?, ?, ?, 'test.action', 'test', 'r1', ?)`
      )
      .run(newId(), tenantId, userId, NOW);

    expect(() => db().prepare('DELETE FROM users WHERE id = ?').run(userId)).toThrow(
      /FOREIGN KEY constraint failed/
    );
  });

  it('nulls sync_outbox.device_id when the referenced device is deleted (set null)', async () => {
    // SET NULL contract: decommissioning a device must NOT
    // cascade-delete the in-flight sync_outbox rows pointing at it.
    // The historical link is preserved with `device_id = NULL` so the
    // outbox row can still replay against the destination.
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const { tenantId, userId } = seedTenantAndUser();

    const deviceId = newId();
    db()
      .prepare(
        `INSERT INTO devices (
          id, tenant_id, kind, name, registered_by_user_id,
          created_at, updated_at
        ) VALUES (?, ?, 'desktop', 'FK Test Device', ?, ?, ?)`
      )
      .run(deviceId, tenantId, userId, NOW, NOW);

    const outboxId = newId();
    db()
      .prepare(
        `INSERT INTO sync_outbox (
          id, tenant_id, status, entity_type, entity_id, operation,
          conflict_policy, payload, payload_version, attempts,
          priority, device_id, created_at, updated_at
        ) VALUES (?, ?, 'queued', 'products', 'p-1', 'update',
          'auto_lww', '{}', 1, 0, 0, ?, ?, ?)`
      )
      .run(outboxId, tenantId, deviceId, NOW, NOW);

    db().prepare('DELETE FROM devices WHERE id = ?').run(deviceId);

    const row = db().prepare('SELECT device_id FROM sync_outbox WHERE id = ?').get(outboxId) as
      { device_id: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row?.device_id).toBeNull();
  });
});
