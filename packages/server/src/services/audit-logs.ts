/**
 * Audit Log Service ().
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

import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { createHash } from 'node:crypto';
import {
  auditChainHeads,
  auditLogs,
  users,
  type AuditLogAction,
  type AuditLogResourceType,
} from '../db/schema.js';
import { getAuditReviewActions, type AuditReviewCategory } from './audit-review.js';
import { computeAuditHeadMac, hasAuditAnchorKey, verifyAuditHeadMac } from './audit-anchor.js';

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
  /** Critical-command correlation id from the validated Command Envelope. */
  operationId?: string | null | undefined;
  /**
   * hash-chain support for writers that need a
   * DETERMINISTIC id (the anomaly-detection dedup). When provided, the
   * insert runs as INSERT OR IGNORE: a duplicate id is silently skipped
   * (per-row, never aborting the surrounding batch) and the chain head
   * does not advance. The id MUST be globally unique across tenants —
   * embed a globally unique entity id (a user id, the tenant id) in the
   * key, because `audit_logs.id` is a global primary key and a
   * cross-tenant collision is absorbed as a skip, not detected.
   */
  id?: string | undefined;
  /** Override the row timestamp (anomaly rows carry occurrence time). */
  createdAt?: string | undefined;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

/** Sentinel prev-hash for the first chained row of a tenant. */
export const AUDIT_CHAIN_GENESIS = 'genesis';

/**
 * Canonical payload the content hash covers. One code path
 * for the writer AND the verifier: at write time the values are the
 * pre-insert JS objects; at verify time they are parse(stored text),
 * and JSON.stringify of a parsed JSON value reproduces the same string.
 */
export function canonicalAuditPayload(row: {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  operationId: string | null;
  createdAt: string;
}): string {
  return JSON.stringify([
    row.id,
    row.tenantId,
    row.actorId,
    row.action,
    row.resourceType,
    row.resourceId,
    row.before,
    row.after,
    row.metadata,
    row.operationId,
    row.createdAt,
  ]);
}

/**
 * Canonical payload for a legally redacted row. The original snapshots are
 * deliberately absent, but the redaction marker and every immutable envelope
 * field remain authenticated by the chain. Keeping this format distinct from
 * the original payload prevents a forged redaction marker from disabling
 * content verification.
 */
export function canonicalRedactedAuditPayload(row: {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  operationId: string | null;
  createdAt: string;
  redactedAt: string;
}): string {
  return JSON.stringify([
    'redacted-v1',
    row.id,
    row.tenantId,
    row.actorId,
    row.action,
    row.resourceType,
    row.resourceId,
    row.operationId,
    row.createdAt,
    row.redactedAt,
  ]);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * The module JSDoc states the DB column is "free-form text" and that
 * extending the enum "never requires a migration". A throw on unknown
 * values contradicts that contract — if any historical row carries an
 * action that has since been removed or renamed, the entire list view
 * crashes with a 500. Cast through `AuditLogAction` so the caller
 * still gets the union type at compile time, and let the renderer
 * fall back to the raw string via the i18n `defaultValue` mechanism.
 */
function parseAuditLogAction(value: string): AuditLogAction {
  return value as AuditLogAction;
}

function parseAuditLogResourceType(value: string): AuditLogResourceType {
  return value as AuditLogResourceType;
}

/**
 * Writes one audit row. MUST be called inside the caller's transaction so
 * the row and the audited action share the same atomic boundary.
 *
 * Returns the inserted row id so callers can correlate downstream
 * effects (e.g.  `operation_effects` rows of kind `audit_log`)
 * against the audit row that was just written.
 */
export function writeAuditLog(args: WriteAuditLogArgs): string {
  const id = args.id ?? nanoid();
  const createdAt = args.createdAt ?? getTimestamp();
  const row = {
    id,
    tenantId: args.tenantId,
    actorId: args.actorId,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    before: args.before ?? null,
    after: args.after ?? null,
    metadata: args.metadata ?? null,
    operationId: args.operationId ?? null,
    createdAt,
  };

  // hash chain. The head read + row insert + head upsert all
  // run inside the caller's transaction (the documented contract of
  // this helper), so SQLite's single writer serializes the chain and
  // no two rows can claim the same prev hash.
  const head = args.tx
    .select({ headHash: auditChainHeads.headHash, headMac: auditChainHeads.headMac })
    .from(auditChainHeads)
    .where(eq(auditChainHeads.tenantId, args.tenantId))
    .get() as { headHash: string; headMac: string | null } | undefined;
  // Never append to an untrusted head: otherwise an offline attacker
  // could strip the MAC, recompute history, and wait for the next
  // legitimate action to bless the forged chain with a fresh MAC.
  // A new tenant has no head and is anchored by its first write.
  if (
    head &&
    hasAuditAnchorKey() &&
    (head.headMac === null || !verifyAuditHeadMac(args.tenantId, head.headHash, head.headMac))
  ) {
    throw new Error('AUDIT_CHAIN_HEAD_UNTRUSTED');
  }
  const prevHash = head?.headHash ?? AUDIT_CHAIN_GENESIS;
  const contentHash = sha256Hex(canonicalAuditPayload(row));
  const chainHash = sha256Hex(`${prevHash}\n${contentHash}`);

  if (args.id !== undefined) {
    // Deterministic-id writers get true INSERT OR IGNORE semantics:
    // a duplicate id (same tenant re-run OR a cross-tenant collision on
    // the global primary key) is absorbed per-statement without
    // aborting the surrounding batch transaction, and the head only
    // advances when the row actually landed.
    const result = args.tx
      .insert(auditLogs)
      .values({ ...row, contentHash, prevHash, chainHash })
      .onConflictDoNothing()
      .run() as { changes?: number };
    if ((result.changes ?? 0) === 0) {
      return id;
    }
  } else {
    args.tx
      .insert(auditLogs)
      .values({ ...row, contentHash, prevHash, chainHash })
      .run();
  }
  // Anchor the new head outside the DB's trust domain when the
  // deployment has an anchor key (null MAC otherwise — verification
  // then reports the chain as unanchored, not broken).
  const headMac = computeAuditHeadMac(args.tenantId, chainHash);
  args.tx
    .insert(auditChainHeads)
    .values({ tenantId: args.tenantId, headHash: chainHash, headMac, updatedAt: createdAt })
    .onConflictDoUpdate({
      target: auditChainHeads.tenantId,
      set: { headHash: chainHash, headMac, updatedAt: createdAt },
    })
    .run();
  return id;
}

export interface AuditChainVerification {
  valid: boolean;
  /** Rows that participate in the chain and were walked. */
  checkedCount: number;
  /** Legacy rows written before the chain shipped (reported, not failed). */
  unchainedCount: number;
  /**
   * Row id nearest the break, when invalid: the edited row for
   * content/link/redaction failures, or the surviving successor whose
   * prev hash dangles for a missing link. Absent when the break sits
   * between the stored head and the newest surviving row.
   */
  brokenAtId?: string;
  /**
   * True when the deployment has an anchor key AND the stored head
   * carried a matching MAC. False only for unkeyed deployments.
   */
  anchored: boolean;
  reason?:
    | 'missing-link'
    | 'content-mismatch'
    | 'link-mismatch'
    | 'redaction-invalid'
    | 'orphan-rows'
    | 'head-missing'
    | 'anchor-mismatch';
}

type AuditChainRow = typeof auditLogs.$inferSelect;
type AuditChainHead = { headHash: string; headMac: string | null } | undefined;

function readAuditChainSnapshot(
  db: DatabaseInstance,
  tenantId: string
): { rows: AuditChainRow[]; head: AuditChainHead } {
  return {
    rows: db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tenantId))
      .all() as AuditChainRow[],
    head: db
      .select({ headHash: auditChainHeads.headHash, headMac: auditChainHeads.headMac })
      .from(auditChainHeads)
      .where(eq(auditChainHeads.tenantId, tenantId))
      .get() as AuditChainHead,
  };
}

function verifyAuditChainSnapshot(
  tenantId: string,
  rows: AuditChainRow[],
  head: AuditChainHead
): AuditChainVerification {
  const chained = rows.filter(row => row.chainHash !== null);
  const unchainedCount = rows.length - chained.length;
  if (chained.length === 0 && !head) {
    return { valid: true, checkedCount: 0, unchainedCount, anchored: false };
  }
  if (!head) {
    return {
      valid: false,
      checkedCount: 0,
      unchainedCount,
      anchored: false,
      reason: 'head-missing',
    };
  }

  let anchored = false;
  if (hasAuditAnchorKey()) {
    if (head.headMac === null || !verifyAuditHeadMac(tenantId, head.headHash, head.headMac)) {
      return {
        valid: false,
        checkedCount: 0,
        unchainedCount,
        anchored: false,
        reason: 'anchor-mismatch',
      };
    }
    anchored = true;
  }

  const byChainHash = new Map(chained.map(row => [row.chainHash as string, row]));
  let cursor: string | null = head.headHash;
  let successorId: string | undefined;
  let checkedCount = 0;
  while (cursor !== null && cursor !== AUDIT_CHAIN_GENESIS && checkedCount <= chained.length) {
    const row = byChainHash.get(cursor);
    if (!row) {
      return {
        valid: false,
        checkedCount,
        unchainedCount,
        anchored,
        ...(successorId !== undefined ? { brokenAtId: successorId } : {}),
        reason: 'missing-link',
      };
    }

    if (
      row.redactedAt !== null &&
      (row.before !== null || row.after !== null || row.metadata !== null)
    ) {
      return {
        valid: false,
        checkedCount,
        unchainedCount,
        anchored,
        brokenAtId: row.id,
        reason: 'redaction-invalid',
      };
    }
    const canonical =
      row.redactedAt === null
        ? canonicalAuditPayload({
            id: row.id,
            tenantId: row.tenantId,
            actorId: row.actorId,
            action: row.action,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            before: row.before,
            after: row.after,
            metadata: row.metadata,
            operationId: row.operationId,
            createdAt: row.createdAt,
          })
        : canonicalRedactedAuditPayload({
            id: row.id,
            tenantId: row.tenantId,
            actorId: row.actorId,
            action: row.action,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            operationId: row.operationId,
            createdAt: row.createdAt,
            redactedAt: row.redactedAt,
          });
    if (sha256Hex(canonical) !== row.contentHash) {
      return {
        valid: false,
        checkedCount,
        unchainedCount,
        anchored,
        brokenAtId: row.id,
        reason: 'content-mismatch',
      };
    }
    const expectedChain = sha256Hex(`${row.prevHash}\n${row.contentHash}`);
    if (expectedChain !== row.chainHash) {
      return {
        valid: false,
        checkedCount,
        unchainedCount,
        anchored,
        brokenAtId: row.id,
        reason: 'link-mismatch',
      };
    }
    checkedCount += 1;
    successorId = row.id;
    cursor = row.prevHash;
  }

  if (checkedCount !== chained.length) {
    return { valid: false, checkedCount, unchainedCount, anchored, reason: 'orphan-rows' };
  }
  return { valid: true, checkedCount, unchainedCount, anchored };
}

/**
 * Scrub selected audit payloads and re-anchor the rewritten chain atomically.
 * Callers MUST invoke this helper inside the same transaction as the privacy
 * disposition or retention sweep that authorizes the redaction.
 */
export function redactAuditLogPayloads(args: {
  tx: DatabaseInstance;
  tenantId: string;
  ids: readonly string[];
  redactedAt: string;
}): number {
  const ids = [...new Set(args.ids)];
  if (ids.length === 0) return 0;

  const snapshot = readAuditChainSnapshot(args.tx, args.tenantId);
  const verification = verifyAuditChainSnapshot(args.tenantId, snapshot.rows, snapshot.head);
  if (!verification.valid) {
    throw new Error(`AUDIT_CHAIN_UNTRUSTED:${verification.reason ?? 'unknown'}`);
  }

  const targetIds = new Set(ids);
  const targets = snapshot.rows.filter(row => targetIds.has(row.id));
  if (targets.length === 0) return 0;

  args.tx
    .update(auditLogs)
    .set({ before: null, after: null, metadata: null, redactedAt: args.redactedAt })
    .where(
      and(
        eq(auditLogs.tenantId, args.tenantId),
        inArray(
          auditLogs.id,
          targets.map(row => row.id)
        )
      )
    )
    .run();

  const chained = snapshot.rows.filter(row => row.chainHash !== null);
  if (chained.length === 0) return targets.length;

  const byChainHash = new Map(chained.map(row => [row.chainHash as string, row]));
  const newestToOldest: AuditChainRow[] = [];
  let cursor: string | null = snapshot.head?.headHash ?? AUDIT_CHAIN_GENESIS;
  while (cursor !== null && cursor !== AUDIT_CHAIN_GENESIS) {
    const row = byChainHash.get(cursor);
    if (!row) throw new Error('AUDIT_CHAIN_UNTRUSTED:missing-link');
    newestToOldest.push(row);
    cursor = row.prevHash;
  }
  if (cursor === null) throw new Error('AUDIT_CHAIN_UNTRUSTED:missing-link');

  let prevHash = AUDIT_CHAIN_GENESIS;
  for (const row of newestToOldest.reverse()) {
    const redactedAt = targetIds.has(row.id) ? args.redactedAt : row.redactedAt;
    const contentHash = sha256Hex(
      redactedAt === null
        ? canonicalAuditPayload({
            id: row.id,
            tenantId: row.tenantId,
            actorId: row.actorId,
            action: row.action,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            before: row.before,
            after: row.after,
            metadata: row.metadata,
            operationId: row.operationId,
            createdAt: row.createdAt,
          })
        : canonicalRedactedAuditPayload({
            id: row.id,
            tenantId: row.tenantId,
            actorId: row.actorId,
            action: row.action,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            operationId: row.operationId,
            createdAt: row.createdAt,
            redactedAt,
          })
    );
    const chainHash = sha256Hex(`${prevHash}\n${contentHash}`);
    args.tx
      .update(auditLogs)
      .set({ contentHash, prevHash, chainHash })
      .where(and(eq(auditLogs.tenantId, args.tenantId), eq(auditLogs.id, row.id)))
      .run();
    prevHash = chainHash;
  }

  args.tx
    .update(auditChainHeads)
    .set({
      headHash: prevHash,
      headMac: computeAuditHeadMac(args.tenantId, prevHash),
      updatedAt: args.redactedAt,
    })
    .where(eq(auditChainHeads.tenantId, args.tenantId))
    .run();
  return targets.length;
}

/**
 * Walk the tenant's chain from the head backwards and verify
 * every link and every row's canonical content digest. Deleting or
 * editing any chained row breaks the walk; a legally redacted row
 * authenticates a distinct payload-free envelope after an authorized
 * chain rewrite, and its content fields MUST be null. A redaction marker
 * over non-null content is reported as tampering (`redaction-invalid`).
 *
 * Threat model (documented, deliberate): the chain itself is UNKEYED
 * SHA-256, so it detects accidental corruption and naive tampering
 * (edits, deletions, reordering that do not recompute hashes). When
 * the deployment has an anchor key (services/audit-anchor.ts), the
 * head additionally carries an HMAC under key material that lives
 * outside the DB, so recomputing the whole chain plus the head is no
 * longer enough — the adversary would also need the keychain envelope
 * or env secret. A residual gap remains even WITH a key: a rewind to
 * an OLD head of the same install replays that head's genuinely valid
 * MAC (no freshness component), so suffix truncation using a
 * historical head+MAC pair still verifies. Closing it needs a
 * monotonic counter or an exported signed head (captured as a planning
 * follow-up). Without an anchor key the
 * recompute-everything attack is undetectable and verification
 * reports anchored: false. Rows with NULL chain columns
 * are tolerated as pre-chain legacy and are inherently unverifiable —
 * the count is surfaced so an operator can notice it growing.
 */
export function verifyAuditChain(db: DatabaseInstance, tenantId: string): AuditChainVerification {
  // Snapshot rows AND head in one transaction: reading them in two
  // implicit transactions lets a concurrent writer advance the head
  // past the row snapshot and produce a false missing-link verdict.
  const snapshot = db.transaction(tx => readAuditChainSnapshot(tx, tenantId));
  return verifyAuditChainSnapshot(tenantId, snapshot.rows, snapshot.head);
}

// explicit `| undefined` so the tRPC `auditLogs.list`
// router can forward Zod-optional filter fields without violating
// `exactOptionalPropertyTypes`.
export interface ListAuditLogsOptions {
  limit?: number | undefined;
  action?: AuditLogAction | undefined;
  resourceType?: AuditLogResourceType | undefined;
  resourceId?: string | undefined;
  actorId?: string | undefined;
  /** ISO datetime; rows with `created_at >= createdAfter` are kept. */
  createdAfter?: string | undefined;
  /** ISO datetime; rows with `created_at <= createdBefore` are kept. */
  createdBefore?: string | undefined;
  /** Curated  sensitive-event category. */
  sensitiveCategory?: AuditReviewCategory | undefined;
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
  if (options.resourceType) conditions.push(eq(auditLogs.resourceType, options.resourceType));
  if (options.resourceId) conditions.push(eq(auditLogs.resourceId, options.resourceId));
  if (options.actorId) conditions.push(eq(auditLogs.actorId, options.actorId));
  if (options.createdAfter) conditions.push(gte(auditLogs.createdAt, options.createdAfter));
  if (options.createdBefore) conditions.push(lte(auditLogs.createdAt, options.createdBefore));
  if (options.sensitiveCategory) {
    conditions.push(
      inArray(auditLogs.action, [...getAuditReviewActions(options.sensitiveCategory)])
    );
  }

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
    .leftJoin(users, and(eq(auditLogs.actorId, users.id), eq(users.tenantId, tenantId)))
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
