/**
 * ENG-030 — AI audit-log persistence + reporting helpers.
 *
 * One module-local boundary around the `ai_audit_log` table so the
 * tRPC router and the client-side pipeline can stay free of Drizzle
 * query primitives.
 *
 * @module services/ai/auditLog
 */
import { and, count, desc, eq, gte, lt, lte, or, sql, sum } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import { aiAuditLog } from '../../db/schema.js';
import type { AIAuditLogRow, NewAIAuditLogRow } from '../../db/schema.js';

/** Insert a single audit-log row. Returns the generated id. */
export async function recordCall(
  db: DatabaseInstance,
  row: Omit<NewAIAuditLogRow, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
  }
): Promise<{ id: string }> {
  const id = row.id ?? nanoid();
  await db.insert(aiAuditLog).values({
    ...row,
    id,
    createdAt: row.createdAt ?? new Date().toISOString(),
  });
  return { id };
}

/**
 * Sum the cost of every successful call this calendar month for a
 * given tenant. Failed calls (`error_code IS NOT NULL`) are excluded
 * because they're persisted with `cost_usd = 0` already, but the
 * filter is documented to keep the intent explicit.
 */
export async function currentMonthSpend(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date()
): Promise<number> {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfNextMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1
  ).toISOString();
  const result = await db
    .select({ total: sum(aiAuditLog.costUsd) })
    .from(aiAuditLog)
    .where(
      and(
        eq(aiAuditLog.tenantId, tenantId),
        gte(aiAuditLog.createdAt, startOfMonth),
        lt(aiAuditLog.createdAt, startOfNextMonth)
      )
    )
    .get();
  const raw = result?.total;
  if (raw === null || raw === undefined) return 0;
  // Drizzle's `sum` returns string when summing real columns under
  // better-sqlite3; coerce defensively.
  return typeof raw === 'number' ? raw : Number(raw) || 0;
}

export interface ListUsageOptions {
  limit: number;
  /** Opaque cursor returned by the previous page. */
  cursor?: string;
}

export interface ListUsagePage {
  items: AIAuditLogRow[];
  nextCursor: string | null;
}

const USAGE_CURSOR_SEPARATOR = '|';

function encodeUsageCursor(row: Pick<AIAuditLogRow, 'createdAt' | 'id'>): string {
  return `${encodeURIComponent(row.createdAt)}${USAGE_CURSOR_SEPARATOR}${encodeURIComponent(row.id)}`;
}

function parseUsageCursor(cursor: string): { createdAt: string; id: string | null } {
  const separatorIndex = cursor.lastIndexOf(USAGE_CURSOR_SEPARATOR);
  if (separatorIndex === -1) {
    return { createdAt: cursor, id: null };
  }
  return {
    createdAt: decodeURIComponent(cursor.slice(0, separatorIndex)),
    id: decodeURIComponent(cursor.slice(separatorIndex + 1)),
  };
}

export async function listUsage(
  db: DatabaseInstance,
  tenantId: string,
  opts: ListUsageOptions
): Promise<ListUsagePage> {
  const safeLimit = Math.min(Math.max(opts.limit, 1), 200);
  const cursor = opts.cursor ? parseUsageCursor(opts.cursor) : null;
  const cursorFilter = cursor
    ? cursor.id
      ? or(
          lt(aiAuditLog.createdAt, cursor.createdAt),
          and(eq(aiAuditLog.createdAt, cursor.createdAt), lt(aiAuditLog.id, cursor.id))
        )
      : lt(aiAuditLog.createdAt, cursor.createdAt)
    : undefined;
  const where = cursorFilter
    ? and(eq(aiAuditLog.tenantId, tenantId), cursorFilter)
    : eq(aiAuditLog.tenantId, tenantId);
  const rows = await db
    .select()
    .from(aiAuditLog)
    .where(where)
    .orderBy(desc(aiAuditLog.createdAt), desc(aiAuditLog.id))
    .limit(safeLimit + 1);
  const hasMore = rows.length > safeLimit;
  const items = hasMore ? rows.slice(0, safeLimit) : rows;
  const nextCursor = hasMore && items.length > 0 ? encodeUsageCursor(items[items.length - 1]!) : null;
  return { items, nextCursor };
}

export type BreakdownScope = 'site' | 'user' | 'feature' | 'provider';

export interface BreakdownEntry {
  scopeKey: string;
  totalCostUsd: number;
  callCount: number;
}

const SCOPE_COLUMN: Record<BreakdownScope, AnySQLiteColumn> = {
  site: aiAuditLog.siteId,
  user: aiAuditLog.userId,
  feature: aiAuditLog.feature,
  provider: aiAuditLog.providerId,
};

/**
 * Aggregate spend by scope for an optional time window. Backs the
 * admin's `ai.usageByBreakdown` procedure for multi-site governance.
 */
export async function byBreakdown(
  db: DatabaseInstance,
  tenantId: string,
  scope: BreakdownScope,
  opts?: { from?: Date; to?: Date }
): Promise<BreakdownEntry[]> {
  const column = SCOPE_COLUMN[scope];
  const filters = [eq(aiAuditLog.tenantId, tenantId)];
  if (opts?.from) {
    filters.push(gte(aiAuditLog.createdAt, opts.from.toISOString()));
  }
  if (opts?.to) {
    filters.push(lte(aiAuditLog.createdAt, opts.to.toISOString()));
  }
  const rows = await db
    .select({
      scopeKey: column,
      totalCostUsd: sql<number | string>`COALESCE(SUM(${aiAuditLog.costUsd}), 0)`,
      callCount: count(aiAuditLog.id),
    })
    .from(aiAuditLog)
    .where(and(...filters))
    .groupBy(column)
    .orderBy(desc(sql`COALESCE(SUM(${aiAuditLog.costUsd}), 0)`));

  return rows.map(row => ({
    // Null site / user keys surface as the empty string so the UI can
    // render a `Sin sede` / `No site` row without losing the bucket.
    scopeKey: row.scopeKey ?? '',
    totalCostUsd: typeof row.totalCostUsd === 'number'
      ? row.totalCostUsd
      : Number(row.totalCostUsd) || 0,
    callCount: typeof row.callCount === 'number' ? row.callCount : Number(row.callCount) || 0,
  }));
}
