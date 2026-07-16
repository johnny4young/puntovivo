import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { tenants } from './schema.js';
import type { DatabaseInstance } from './types.js';

interface SqliteTableInfoRow {
  name: string;
}

interface SqliteForeignKeyRow {
  from: string;
  table: string;
  on_delete: string;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function getSqliteClient(db: DatabaseInstance): Database.Database {
  return (db as unknown as { $client: Database.Database }).$client;
}

/**
 * Finds every tenant-owned table and orders children before their referenced
 * parents. Keeping discovery runtime-driven prevents the developer reset path
 * from silently drifting whenever a migration adds another tenant table.
 */
function getTenantTablesInDeleteOrder(sqlite: Database.Database): string[] {
  const tableNames = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as SqliteTableInfoRow[];

  const tenantTables = tableNames
    .map(row => row.name)
    .filter(name => name !== 'tenants')
    .filter(name => {
      const columns = sqlite
        .prepare(`PRAGMA table_info(${quoteIdentifier(name)})`)
        .all() as SqliteTableInfoRow[];
      return columns.some(column => column.name === 'tenant_id');
    });
  const tenantTableSet = new Set(tenantTables);
  const childrenByParent = new Map<string, Set<string>>();

  for (const table of tenantTables) {
    childrenByParent.set(table, new Set());
  }
  for (const child of tenantTables) {
    const foreignKeys = sqlite
      .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(child)})`)
      .all() as SqliteForeignKeyRow[];
    for (const foreignKey of foreignKeys) {
      // ENG-110b — self-references are cleared inside the reset transaction
      // before deletion. They therefore do not create a cross-table ordering
      // edge (which would only manufacture a cycle here).
      if (foreignKey.table !== child && tenantTableSet.has(foreignKey.table)) {
        childrenByParent.get(foreignKey.table)?.add(child);
      }
    }
  }

  // Join/detail tables often omit tenant_id and are removed by a CASCADE
  // from their tenant-owned parent. If they also hold NO ACTION references
  // to another tenant table, the cascading parent must be deleted first.
  // Example: transfer_order_items cascades from transfer_orders but points to
  // products with NO ACTION, so transfer_orders must precede products.
  for (const { name: bridgeTable } of tableNames) {
    if (tenantTableSet.has(bridgeTable) || bridgeTable === 'tenants') continue;
    const foreignKeys = sqlite
      .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(bridgeTable)})`)
      .all() as SqliteForeignKeyRow[];
    const cascadingParents = foreignKeys
      .filter(key => key.on_delete.toUpperCase() === 'CASCADE' && tenantTableSet.has(key.table))
      .map(key => key.table);
    const blockingParents = foreignKeys
      .filter(key => key.on_delete.toUpperCase() !== 'CASCADE' && tenantTableSet.has(key.table))
      .map(key => key.table);
    for (const blockingParent of blockingParents) {
      for (const cascadingParent of cascadingParents) {
        childrenByParent.get(blockingParent)?.add(cascadingParent);
      }
    }
  }

  const state = new Map<string, 'visiting' | 'visited'>();
  const ordered: string[] = [];
  const visit = (table: string): void => {
    const current = state.get(table);
    if (current === 'visited') return;
    if (current === 'visiting') {
      throw new Error(`Tenant table foreign-key cycle detected at ${table}`);
    }
    state.set(table, 'visiting');
    for (const child of [...(childrenByParent.get(table) ?? [])].sort()) {
      visit(child);
    }
    state.set(table, 'visited');
    ordered.push(table);
  };

  for (const table of [...tenantTables].sort()) {
    visit(table);
  }
  return ordered;
}

/**
 * Break nullable, non-cascading self references before deleting a tenant.
 * SQLite enforces RESTRICT / NO ACTION while a DELETE statement is running,
 * so deleting a parent and its children in one statement is not sufficient.
 */
function clearTenantSelfReferences(
  sqlite: Database.Database,
  tenantTables: string[],
  tenantId: string
): void {
  for (const table of tenantTables) {
    const selfReferences = (
      sqlite
        .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
        .all() as SqliteForeignKeyRow[]
    ).filter(
      foreignKey =>
        foreignKey.table === table && foreignKey.on_delete.toUpperCase() !== 'CASCADE'
    );
    for (const foreignKey of selfReferences) {
      sqlite
        .prepare(
          `UPDATE ${quoteIdentifier(table)}
           SET ${quoteIdentifier(foreignKey.from)} = NULL
           WHERE tenant_id = ? AND ${quoteIdentifier(foreignKey.from)} IS NOT NULL`
        )
        .run(tenantId);
    }
  }
}

/**
 * Deletes one tenant and every tenant-scoped row without relying on a static
 * table list. Intended only for destructive development/QA reset commands.
 */
export async function resetTenantBySlug(
  db: DatabaseInstance,
  tenantSlug: string
): Promise<string | null> {
  const existingTenant = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .get();
  if (!existingTenant) return null;

  const sqlite = getSqliteClient(db);
  const tables = getTenantTablesInDeleteOrder(sqlite);
  sqlite.transaction(() => {
    clearTenantSelfReferences(sqlite, tables, existingTenant.id);
    for (const table of tables) {
      try {
        sqlite
          .prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE tenant_id = ?`)
          .run(existingTenant.id);
      } catch (error) {
        throw new Error(`Failed to reset tenant table ${table}`, { cause: error });
      }
    }
    sqlite.prepare('DELETE FROM tenants WHERE id = ?').run(existingTenant.id);
  })();

  return existingTenant.id;
}
