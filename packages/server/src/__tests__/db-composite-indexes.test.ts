/**
 * pins the six composite indexes added in migration 0034,
 * plus the restaurant_tables partial unique that  declared in
 * schema.ts after it originally shipped in migration 0023.
 *
 * Each new index targets a hot listing query (audit logs, inventory
 * traceability, restaurant tables dropdown, operation_events worker
 * poll, quotations expiring-soon dashboard, sync_outbox per-entity
 * drilldown). If a future schema refactor drops one of these indexes
 * the query falls back to a full table scan that has historically
 * embarrassed the app on tenants with 100k+ rows. The assertions
 * below catch the regression at boot via sqlite_master.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

interface LiveDatabase {
  $client: Database.Database;
}

afterEach(() => {
  closeDatabase();
});

interface IndexInfo {
  name: string;
  tbl_name: string;
  sql: string | null;
}

interface IndexColumn {
  seqno: number;
  cid: number;
  name: string;
}

function readIndex(name: string): IndexInfo {
  const sqlite = (getDatabase() as unknown as LiveDatabase).$client;
  const row = sqlite
    .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name = ?")
    .get(name) as IndexInfo | undefined;
  if (!row) {
    throw new Error(`index ${name} not found in sqlite_master`);
  }
  return row;
}

function readIndexColumns(name: string): string[] {
  const sqlite = (getDatabase() as unknown as LiveDatabase).$client;
  return (sqlite.prepare(`PRAGMA index_info(${name})`).all() as IndexColumn[])
    .sort((a, b) => a.seqno - b.seqno)
    .map(row => row.name);
}

describe('composite indexes added by  (migration 0034)', () => {
  it('audit_logs gains tenant_created and tenant_action_created composites', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });

    expect(readIndex('idx_audit_logs_tenant_created').tbl_name).toBe('audit_logs');
    expect(readIndexColumns('idx_audit_logs_tenant_created')).toEqual(['tenant_id', 'created_at']);

    expect(readIndex('idx_audit_logs_tenant_action_created').tbl_name).toBe('audit_logs');
    expect(readIndexColumns('idx_audit_logs_tenant_action_created')).toEqual([
      'tenant_id',
      'action',
      'created_at',
    ]);
  });

  it('inventory_movements gains tenant_created composite for date-ordered listings', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });

    expect(readIndex('idx_inventory_movements_tenant_created').tbl_name).toBe(
      'inventory_movements'
    );
    expect(readIndexColumns('idx_inventory_movements_tenant_created')).toEqual([
      'tenant_id',
      'created_at',
    ]);
  });

  it('restaurant_tables carries a partial unique on the active name (originally from 0023) so archived names free for re-use', async () => {
    // The partial unique was first shipped by `0023_restaurant_tables.sql`
    // as `idx_restaurant_tables_unique_active_name`.  brings the
    // declaration into Drizzle's schema source-of-truth under the same
    // name so `drizzle-kit generate` cannot drift. This test pins the
    // canonical name + the partial WHERE clause that gates re-use.
    await initDatabase({ dbPath: ':memory:', seedData: false });

    const info = readIndex('idx_restaurant_tables_unique_active_name');
    expect(info.tbl_name).toBe('restaurant_tables');
    expect(info.sql).toContain('UNIQUE');
    // Accept both the legacy hand-written emission (WHERE `is_active` = 1)
    // and drizzle-kit's table-qualified one
    // (WHERE "restaurant_tables"."is_active" = 1) — same semantic pin.
    expect(info.sql).toMatch(
      /WHERE\s+(?:["`]?restaurant_tables["`]?\s*\.\s*)?["`]?is_active["`]?\s*=\s*1/i
    );
    expect(readIndexColumns('idx_restaurant_tables_unique_active_name')).toEqual([
      'tenant_id',
      'site_id',
      'name',
    ]);
  });

  it('operation_events gains status_created composite for the kernel worker poll', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });

    expect(readIndex('idx_operation_events_status_created').tbl_name).toBe('operation_events');
    expect(readIndexColumns('idx_operation_events_status_created')).toEqual([
      'status',
      'created_at',
    ]);
  });

  it('quotations gains tenant_status_valid_until composite for the expiring-soon dashboard', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });

    expect(readIndex('idx_quotations_tenant_status_valid_until').tbl_name).toBe('quotations');
    expect(readIndexColumns('idx_quotations_tenant_status_valid_until')).toEqual([
      'tenant_id',
      'status',
      'valid_until',
    ]);
  });

  it('sync_outbox entity index now carries status for the Operations Center peek query', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });

    const info = readIndex('idx_sync_outbox_entity');
    expect(info.tbl_name).toBe('sync_outbox');
    expect(readIndexColumns('idx_sync_outbox_entity')).toEqual([
      'entity_type',
      'entity_id',
      'status',
    ]);
  });
});
