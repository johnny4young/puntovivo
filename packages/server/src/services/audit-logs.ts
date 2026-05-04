/**
 * Audit Log Service (Phase 8 / Tier-2 #8).
 *
 * Every call writes a single immutable row into `audit_logs`. The writer is
 * designed to be invoked from **inside the caller's transaction** so the
 * audit row is atomic with the sensitive action — if the surrounding
 * operation rolls back, so does the audit entry. This is intentional:
 * orphaned audit rows (action rolled back but audit written, or vice
 * versa) are worse than no audit at all.
 *
 * The `action` and `resourceType` fields are free-form strings at the DB
 * layer; the TypeScript literal unions declared in `db/schema.ts` (via
 * `auditLogActionEnum` / `auditLogResourceTypeEnum`) are the single source
 * of truth for what's allowed. Extending the list never requires a
 * migration.
 *
 * @module services/audit-logs
 */

import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import {
  auditLogs,
  auditLogActionEnum,
  auditLogResourceTypeEnum,
  users,
  type AuditLogAction,
  type AuditLogResourceType,
} from '../db/schema.js';

export interface WriteAuditLogArgs {
  tx: DatabaseInstance;
  tenantId: string;
  actorId: string;
  action: AuditLogAction;
  resourceType: AuditLogResourceType;
  resourceId: string;
  /** Snapshot of the resource BEFORE the sensitive action ran. Null when creating. */
  before?: Record<string, unknown> | null;
  /** Snapshot AFTER the action. Null when deleting. */
  after?: Record<string, unknown> | null;
  /** Free-form per-action details (e.g. void reason, discrepancy note). */
  metadata?: Record<string, unknown> | null;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function isAuditLogAction(value: string): value is AuditLogAction {
  return auditLogActionEnum.some(item => item === value);
}

function parseAuditLogAction(value: string): AuditLogAction {
  if (isAuditLogAction(value)) {
    return value;
  }

  throw new Error(`Unknown audit log action: ${value}`);
}

function isAuditLogResourceType(value: string): value is AuditLogResourceType {
  return auditLogResourceTypeEnum.some(item => item === value);
}

function parseAuditLogResourceType(value: string): AuditLogResourceType {
  if (isAuditLogResourceType(value)) {
    return value;
  }

  throw new Error(`Unknown audit log resource type: ${value}`);
}

/**
 * Writes one audit row. MUST be called inside the caller's transaction so
 * the row and the audited action share the same atomic boundary.
 *
 * Returns the inserted row id so callers can correlate downstream
 * effects (e.g. ENG-053 `operation_effects` rows of kind `audit_log`)
 * against the audit row that was just written.
 */
export function writeAuditLog(args: WriteAuditLogArgs): string {
  const id = nanoid();
  args.tx
    .insert(auditLogs)
    .values({
      id,
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      before: args.before ?? null,
      after: args.after ?? null,
      metadata: args.metadata ?? null,
      createdAt: getTimestamp(),
    })
    .run();
  return id;
}

export interface ListAuditLogsOptions {
  limit?: number;
  action?: AuditLogAction;
  resourceType?: AuditLogResourceType;
  resourceId?: string;
  actorId?: string;
  /** ISO datetime; rows with `created_at >= createdAfter` are kept. */
  createdAfter?: string;
  /** ISO datetime; rows with `created_at <= createdBefore` are kept. */
  createdBefore?: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string | null;
  actorEmail: string | null;
  action: AuditLogAction;
  resourceType: AuditLogResourceType;
  resourceId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Reverse-chronological list bounded by `limit` (default 100, max 500).
 * Joins the `users` table once so the UI can render the actor's name +
 * email without a second round trip per row.
 */
export function listAuditLogs(
  db: DatabaseInstance,
  tenantId: string,
  options: ListAuditLogsOptions = {}
): AuditLogEntry[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

  const conditions = [eq(auditLogs.tenantId, tenantId)];
  if (options.action) conditions.push(eq(auditLogs.action, options.action));
  if (options.resourceType)
    conditions.push(eq(auditLogs.resourceType, options.resourceType));
  if (options.resourceId)
    conditions.push(eq(auditLogs.resourceId, options.resourceId));
  if (options.actorId) conditions.push(eq(auditLogs.actorId, options.actorId));
  if (options.createdAfter)
    conditions.push(gte(auditLogs.createdAt, options.createdAfter));
  if (options.createdBefore)
    conditions.push(lte(auditLogs.createdAt, options.createdBefore));

  const rows = db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actorName: users.name,
      actorEmail: users.email,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      before: auditLogs.before,
      after: auditLogs.after,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    // Tenant-guard the actor join: if a future migration ever allowed an
    // actorId to resolve to a user record from a sibling tenant, the PII
    // (name / email) would leak through the admin-only viewer. Adding the
    // tenant constraint directly to the JOIN makes the foreign actor
    // collapse to `null actorName / actorEmail` instead of spilling across
    // tenant boundaries. Defense in depth — the audit_logs row itself is
    // already tenant-scoped by the `WHERE` clause below.
    .leftJoin(
      users,
      and(eq(auditLogs.actorId, users.id), eq(users.tenantId, tenantId))
    )
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .all();

  return rows.map(row => ({
    id: row.id,
    actorId: row.actorId,
    actorName: row.actorName ?? null,
    actorEmail: row.actorEmail ?? null,
    action: parseAuditLogAction(row.action),
    resourceType: parseAuditLogResourceType(row.resourceType),
    resourceId: row.resourceId,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
    createdAt: row.createdAt,
  }));
}
