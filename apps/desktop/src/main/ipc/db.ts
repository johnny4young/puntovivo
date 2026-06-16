/**
 * ENG-178 — desktop database-bridge handlers, extracted verbatim from the
 * former monolithic `main/index.ts`.
 *
 * Owns the `db:*` IPC handler bodies + their table helpers + the table
 * allowlist + the ENG-025 cross-tenant guards. Electron-free: it reaches
 * the embedded SQLite store only through `runtime.getSqliteClient()` and
 * the `desktopSession` singleton, so the logic is unit-testable under
 * `node --test` without booting Electron (mirroring the `backup-bundle.ts`
 * / `desktopSession.ts` idiom). The thin `ipc/register.ts` layer wires
 * these to `ipcMain.handle`.
 *
 * @module main/ipc/db
 */

import { getSqliteClient } from '../runtime.js';
import * as desktopSession from '../session/desktopSession.js';

export type AllowedDesktopTable =
  | 'products'
  | 'customers'
  | 'sales'
  | 'sale_items'
  | 'categories'
  | 'inventory_movements'
  | 'sync_outbox';

export const ALLOWED_DESKTOP_TABLES = [
  'products',
  'customers',
  'sales',
  'sale_items',
  'categories',
  'inventory_movements',
  'sync_outbox',
] as const satisfies readonly AllowedDesktopTable[];

export const DIRECT_TENANT_TABLES = new Set<AllowedDesktopTable>([
  'products',
  'customers',
  'sales',
  'categories',
  'inventory_movements',
  'sync_outbox',
]);

const tableColumnsCache = new Map<AllowedDesktopTable, Set<string>>();

export function isAllowedDesktopTable(value: string): value is AllowedDesktopTable {
  return (ALLOWED_DESKTOP_TABLES as readonly string[]).includes(value);
}

export function getAllowedDesktopTable(table: string): AllowedDesktopTable {
  if (!isAllowedDesktopTable(table)) {
    throw new Error(`Table "${table}" is not allowed in the desktop bridge`);
  }

  return table;
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, match => `_${match.toLowerCase()}`);
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function getTableColumns(table: AllowedDesktopTable): Set<string> {
  const cached = tableColumnsCache.get(table);
  if (cached) {
    return cached;
  }

  const rows = getSqliteClient().$client
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  const columns = new Set(rows.map(row => row.name));
  tableColumnsCache.set(table, columns);
  return columns;
}

function isJsonColumn(table: AllowedDesktopTable, column: string): boolean {
  return table === 'sync_outbox' && (column === 'payload' || column === 'last_error');
}

function serializeColumnValue(
  table: AllowedDesktopTable,
  column: string,
  value: unknown
): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (column.startsWith('is_') && typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (isJsonColumn(table, column)) {
    if (value === null) {
      return null;
    }
    return JSON.stringify(value);
  }

  return value;
}

function deserializeColumnValue(
  table: AllowedDesktopTable,
  column: string,
  value: unknown
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (column.startsWith('is_') && typeof value === 'number') {
    return value === 1;
  }

  if (isJsonColumn(table, column) && typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  return value;
}

function normalizeRecordForTable(
  table: AllowedDesktopTable,
  input: Record<string, unknown>,
  options: { includeId?: boolean } = {}
): Record<string, unknown> {
  const columns = getTableColumns(table);
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const column = toSnakeCase(key);
    if (!columns.has(column)) {
      continue;
    }

    if (column === 'id' && !options.includeId) {
      continue;
    }

    const serialized = serializeColumnValue(table, column, value);
    if (serialized !== undefined) {
      normalized[column] = serialized;
    }
  }

  return normalized;
}

export function mapRowToRendererRecord(
  table: AllowedDesktopTable,
  row: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (!row) {
    return null;
  }

  const mapped = Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      toCamelCase(column),
      deserializeColumnValue(table, column, value),
    ])
  );

  if (table === 'sync_outbox') {
    const queueRow = mapped as Record<string, unknown>;
    // Renderer historically expected `payload` + `retryCount` (matching
    // the IndexedDB shadow shape). After the ENG-064b cutover the
    // server columns are `payload` + `attempts` directly, so we just
    // alias `attempts` over to `retryCount` for the renderer payload.
    const payload = queueRow.payload as Record<string, unknown> | undefined;
    const retryCount = queueRow.attempts as number | undefined;
    delete queueRow.attempts;
    delete queueRow.payloadVersion;

    return {
      ...queueRow,
      payload: payload ?? {},
      retryCount: retryCount ?? 0,
    };
  }

  return mapped;
}

async function getDesktopRecordById(
  table: AllowedDesktopTable,
  id: string
): Promise<Record<string, unknown> | null> {
  const sqlite = getSqliteClient().$client;
  const row = sqlite.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).get(id) as
    | Record<string, unknown>
    | undefined;

  return mapRowToRendererRecord(table, row);
}

/**
 * ENG-025 — guard that blocks single-record operations (`db:getById`,
 * `db:update`, `db:delete`) when the target row belongs to a tenant
 * other than the one held by `desktopSession`. Returns silently when
 * the row is reachable; throws `CROSS_TENANT_ACCESS` otherwise. For
 * tables that do not carry a `tenant_id` column directly (e.g.
 * `sale_items`) the check climbs through `sales.tenant_id` so the
 * scope still holds.
 *
 * Existing behaviour for non-existent rows: pass through (the
 * handler returns `undefined` / no-op) — we only block
 * cross-tenant access of existing rows, mirroring the tRPC layer's
 * "not found vs not authorized" silence to avoid leaking which IDs
 * exist in other tenants.
 */
export async function assertRowBelongsToActiveTenant(
  table: AllowedDesktopTable,
  id: string
): Promise<void> {
  const activeTenantId = desktopSession.requireTenantId();
  const sqlite = getSqliteClient().$client;

  let rowTenantId: string | null;
  if (table === 'sale_items') {
    const joined = sqlite
      .prepare(
        `SELECT s.tenant_id AS tenant_id
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE si.id = ? LIMIT 1`
      )
      .get(id) as { tenant_id?: string } | undefined;
    rowTenantId = joined?.tenant_id ?? null;
  } else if (DIRECT_TENANT_TABLES.has(table)) {
    const row = sqlite
      .prepare(`SELECT tenant_id FROM ${table} WHERE id = ? LIMIT 1`)
      .get(id) as { tenant_id?: string } | undefined;
    rowTenantId = row?.tenant_id ?? null;
  } else {
    // Catalog / global tables (none in ALLOWED_DESKTOP_TABLES today,
    // but defensive). No tenant column → access is always allowed.
    return;
  }

  if (rowTenantId === null) {
    // Row missing — let the actual handler return its usual "not
    // found" response instead of leaking existence cross-tenant.
    return;
  }

  if (rowTenantId !== activeTenantId) {
    throw new Error('CROSS_TENANT_ACCESS');
  }
}

function getSaleIdFromRecord(data: Record<string, unknown>): string | null {
  const value = data.saleId ?? data.sale_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function assertSaleItemWriteBelongsToActiveTenant(
  data: Record<string, unknown>,
  options: { requireSaleId: boolean }
): Promise<void> {
  const saleId = getSaleIdFromRecord(data);
  if (!saleId) {
    if (options.requireSaleId) {
      throw new Error('SALE_ID_REQUIRED');
    }
    return;
  }

  const activeTenantId = desktopSession.requireTenantId();
  const row = getSqliteClient().$client
    .prepare('SELECT tenant_id FROM sales WHERE id = ? LIMIT 1')
    .get(saleId) as { tenant_id?: string } | undefined;

  if (!row?.tenant_id || row.tenant_id !== activeTenantId) {
    throw new Error('CROSS_TENANT_ACCESS');
  }
}

export async function handleDesktopGetAll(tableName: string, tenantId: string): Promise<unknown[]> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;

  const rows =
    table === 'sale_items'
      ? (sqlite
          .prepare(
            `SELECT si.*
             FROM sale_items si
             INNER JOIN sales s ON s.id = si.sale_id
             WHERE s.tenant_id = ?`
          )
          .all(tenantId) as Record<string, unknown>[])
      : DIRECT_TENANT_TABLES.has(table)
        ? (sqlite
            .prepare(`SELECT * FROM ${table} WHERE tenant_id = ?`)
            .all(tenantId) as Record<string, unknown>[])
        : (sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]);

  return rows
    .map(row => mapRowToRendererRecord(table, row))
    .filter((row): row is Record<string, unknown> => row !== null);
}

export async function handleDesktopGetById(tableName: string, id: string): Promise<unknown> {
  const table = getAllowedDesktopTable(tableName);
  return getDesktopRecordById(table, id);
}

export async function handleDesktopInsert(
  tableName: string,
  data: Record<string, unknown>
): Promise<unknown> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;
  const normalized = normalizeRecordForTable(table, data, { includeId: true });
  const id = normalized.id;

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Table "${table}" requires a string id`);
  }

  const columns = Object.keys(normalized);
  if (columns.length === 0) {
    throw new Error(`No writable fields were provided for table "${table}"`);
  }

  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map(column => normalized[column]);

  sqlite
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...values);

  return getDesktopRecordById(table, id);
}

export async function handleDesktopUpdate(
  tableName: string,
  id: string,
  data: Record<string, unknown>
): Promise<unknown> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;
  const normalized = normalizeRecordForTable(table, data);
  const columns = Object.keys(normalized);

  if (columns.length > 0) {
    const assignments = columns.map(column => `${column} = ?`).join(', ');
    const values = columns.map(column => normalized[column]);
    sqlite.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(...values, id);
  }

  return getDesktopRecordById(table, id);
}

export async function handleDesktopDelete(tableName: string, id: string): Promise<boolean> {
  const table = getAllowedDesktopTable(tableName);
  const result = getSqliteClient().$client.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return result.changes > 0;
}

export async function handleDesktopGetByField(
  tableName: string,
  fieldName: string,
  value: unknown
): Promise<unknown[]> {
  const table = getAllowedDesktopTable(tableName);
  const field = toSnakeCase(fieldName);
  const activeTenantId = desktopSession.requireTenantId();

  if (!getTableColumns(table).has(field)) {
    throw new Error(`Field "${fieldName}" is not allowed for table "${table}"`);
  }

  const sqlite = getSqliteClient().$client;
  const rows =
    table === 'sale_items'
      ? (sqlite
          .prepare(
            `SELECT si.*
             FROM sale_items si
             INNER JOIN sales s ON s.id = si.sale_id
             WHERE si.${field} = ? AND s.tenant_id = ?`
          )
          .all(value, activeTenantId) as Record<string, unknown>[])
      : DIRECT_TENANT_TABLES.has(table)
        ? (sqlite
            .prepare(`SELECT * FROM ${table} WHERE ${field} = ? AND tenant_id = ?`)
            .all(value, activeTenantId) as Record<string, unknown>[])
        : (sqlite
            .prepare(`SELECT * FROM ${table} WHERE ${field} = ?`)
            .all(value) as Record<string, unknown>[]);

  return rows
    .map(row => mapRowToRendererRecord(table, row))
    .filter((row): row is Record<string, unknown> => row !== null);
}

export async function handleDesktopDeleteByTenant(tableName: string, tenantId: string): Promise<number> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;
  const result =
    table === 'sale_items'
      ? sqlite
          .prepare(
            `DELETE FROM sale_items
             WHERE sale_id IN (SELECT id FROM sales WHERE tenant_id = ?)`
          )
          .run(tenantId)
      : sqlite.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(tenantId);

  return result.changes;
}

export async function handleDesktopCountByTenant(tableName: string, tenantId: string): Promise<number> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;
  const row =
    table === 'sale_items'
      ? (sqlite
          .prepare(
            `SELECT COUNT(*) AS count
             FROM sale_items si
             INNER JOIN sales s ON s.id = si.sale_id
             WHERE s.tenant_id = ?`
          )
          .get(tenantId) as { count: number } | undefined)
      : (sqlite
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?`)
          .get(tenantId) as { count: number } | undefined);

  return row?.count ?? 0;
}
