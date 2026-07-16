import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, initDatabase } from '../db/index.js';
import { seedDevData, DEV_TENANT_SLUG } from '../db/seed-dev.js';
import { resetTenantBySlug } from '../db/tenant-reset.js';

describe('resetTenantBySlug', () => {
  afterEach(() => {
    closeDatabase();
  });

  it('removes current and future tenant tables in FK-safe order', async () => {
    const db = await initDatabase({ dbPath: ':memory:' });
    const seeded = await seedDevData(db, { preset: 'default' });
    const sqlite = (db as unknown as { $client: import('better-sqlite3').Database }).$client;
    const user = sqlite
      .prepare('SELECT id FROM users WHERE tenant_id = ? LIMIT 1')
      .get(seeded.tenantId) as { id: string };

    sqlite
      .prepare(
        `INSERT INTO auth_refresh_families
          (id, tenant_id, user_id, current_jti, issued_at, last_rotated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'reset-family',
        seeded.tenantId,
        user.id,
        'reset-jti',
        '2026-07-14T00:00:00.000Z',
        '2026-07-14T00:00:00.000Z',
        '2026-07-21T00:00:00.000Z'
      );
    sqlite.exec(`
      CREATE TABLE future_tenant_rows (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        user_id TEXT NOT NULL REFERENCES users(id)
      );
    `);
    sqlite
      .prepare('INSERT INTO future_tenant_rows (id, tenant_id, user_id) VALUES (?, ?, ?)')
      .run('future-row', seeded.tenantId, user.id);
    sqlite
      .prepare(
        `INSERT INTO products (id, tenant_id, name, sku, catalog_type, is_active)
         VALUES (?, ?, ?, ?, 'variant_parent', 0)`
      )
      .run('reset-matrix-parent', seeded.tenantId, 'Reset matrix parent', 'RESET-MATRIX-PARENT');
    sqlite
      .prepare(
        `INSERT INTO products
          (id, tenant_id, name, sku, catalog_type, variant_parent_id, variant_signature)
         VALUES (?, ?, ?, ?, 'variant', ?, ?)`
      )
      .run(
        'reset-matrix-child',
        seeded.tenantId,
        'Reset matrix child',
        'RESET-MATRIX-CHILD',
        'reset-matrix-parent',
        '{"Size":"S"}'
      );
    const serializedSaleLine = sqlite
      .prepare(
        `SELECT si.id AS sale_item_id, si.product_id, cs.site_id
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN cash_sessions cs ON cs.id = s.cash_session_id
         WHERE s.tenant_id = ?
         LIMIT 1`
      )
      .get(seeded.tenantId) as
      | { sale_item_id: string; product_id: string; site_id: string }
      | undefined;
    expect(serializedSaleLine).toBeDefined();
    sqlite
      .prepare(
        `INSERT INTO product_serials
          (id, tenant_id, current_site_id, product_id, serial_number, status, sale_item_id)
         VALUES (?, ?, ?, ?, ?, 'sold', ?)`
      )
      .run(
        'reset-product-serial',
        seeded.tenantId,
        serializedSaleLine!.site_id,
        serializedSaleLine!.product_id,
        'RESET-SERIAL-1',
        serializedSaleLine!.sale_item_id
      );
    sqlite
      .prepare(
        `INSERT INTO sale_item_serials
          (id, tenant_id, sale_item_id, product_serial_id, serial_number)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        'reset-sale-item-serial',
        seeded.tenantId,
        serializedSaleLine!.sale_item_id,
        'reset-product-serial',
        'RESET-SERIAL-1'
      );

    await expect(resetTenantBySlug(db, DEV_TENANT_SLUG)).resolves.toBe(seeded.tenantId);

    expect(
      sqlite.prepare('SELECT id FROM tenants WHERE id = ?').get(seeded.tenantId)
    ).toBeUndefined();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM future_tenant_rows').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(sqlite.prepare("SELECT id FROM tenants WHERE slug = 'default'").get()).toBeTruthy();
  });

  it('is a no-op when the tenant does not exist', async () => {
    const db = await initDatabase({ dbPath: ':memory:' });
    await expect(resetTenantBySlug(db, 'missing')).resolves.toBeNull();
  });
});
