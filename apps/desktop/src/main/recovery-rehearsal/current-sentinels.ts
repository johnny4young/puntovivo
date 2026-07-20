import type Database from 'better-sqlite3';

const FIXED_TIME = '2026-07-19T13:00:00.000Z';

/**
 * Tables whose current-only columns or rows must survive backup and restore.
 * Historical sales, inventory, fiscal, and loyalty coverage remains owned by
 * REHEARSAL_TABLES from the v1.7 fixture.
 */
export const CURRENT_REHEARSAL_TABLES = [
  'users',
  'customers',
  'products',
  'employee_shifts',
  'scheduled_shifts',
  'manager_approval_requests',
  'product_serials',
] as const;

/** Seed two independent current-schema graphs on top of the upgraded fixture. */
export function seedCurrentSentinels(sqlite: Database.Database): void {
  const run = (sql: string, values: unknown[]) => sqlite.prepare(sql).run(...values);
  const updateOne = (sql: string, values: unknown[]) => {
    const result = run(sql, values);
    if (result.changes !== 1) {
      throw new Error('current sentinel update did not match exactly one historical row');
    }
  };

  sqlite.transaction(() => {
    for (const suffix of ['a', 'b']) {
      const id = (entity: string) => `rehearsal-${entity}-${suffix}`;
      const tenantId = id('tenant');
      const siteId = id('site');
      const userId = id('user');
      const productId = id('product');

      updateOne('UPDATE users SET staff_pin_hash = ? WHERE id = ? AND tenant_id = ?', [
        `rehearsal-pin-hash-${suffix}`,
        userId,
        tenantId,
      ]);
      updateOne(
        'UPDATE customers SET privacy_status = ?, privacy_disposed_at = NULL WHERE id = ? AND tenant_id = ?',
        ['active', id('customer'), tenantId]
      );
      updateOne('UPDATE products SET tracks_serials = 1 WHERE id = ? AND tenant_id = ?', [
        productId,
        tenantId,
      ]);

      run(
        `INSERT INTO employee_shifts
          (id, tenant_id, user_id, site_id, clocked_in_at, clocked_out_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id('employee-shift'),
          tenantId,
          userId,
          siteId,
          '2026-07-19T08:00:00.000Z',
          '2026-07-19T12:00:00.000Z',
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      run(
        `INSERT INTO scheduled_shifts
          (id, tenant_id, user_id, site_id, starts_at, ends_at, time_zone, status,
           notes, version, created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id('scheduled-shift'),
          tenantId,
          userId,
          siteId,
          '2026-07-20T08:00:00.000Z',
          '2026-07-20T16:00:00.000Z',
          'America/Bogota',
          'scheduled',
          `Recovery rehearsal ${suffix.toUpperCase()}`,
          1,
          userId,
          userId,
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      run(
        `INSERT INTO manager_approval_requests
          (id, tenant_id, site_id, requester_id, action, status, reason,
           resource_type, resource_id, summary, requested_at, expires_at,
           required_approvals, approval_evidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id('manager-approval'),
          tenantId,
          siteId,
          userId,
          'refund',
          'pending',
          `Recovery approval ${suffix.toUpperCase()}`,
          'sale',
          id('sale'),
          `Approval sentinel ${suffix.toUpperCase()}`,
          FIXED_TIME,
          '2026-07-20T13:00:00.000Z',
          2,
          '[]',
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      run(
        `INSERT INTO product_serials
          (id, tenant_id, current_site_id, product_id, serial_number, status,
           unit_cost, warranty_expires_at, received_at, notes, sync_status,
           sync_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id('product-serial'),
          tenantId,
          siteId,
          productId,
          `SERIAL-${suffix.toUpperCase()}-001`,
          'in_stock',
          80,
          '2027-07-19T00:00:00.000Z',
          FIXED_TIME,
          `Restore sentinel ${suffix.toUpperCase()}`,
          'synced',
          1,
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
    }
  })();
}
