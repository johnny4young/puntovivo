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

import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type Database from 'better-sqlite3';
import {
  auditChainHeads,
  auditLogs,
  users,
  type AuditLogAction,
  type AuditLogResourceType,
} from '../db/schema.js';
import { getAuditReviewActions, type AuditReviewCategory } from './audit-review.js';
import {
  computeAuditHeadMac,
  hasAuditAnchorKey,
  reconcileAuditAnchor,
  reserveAuditAnchor,
  verifyAuditHeadMac,
  type AuditAnchorPoint,
} from './audit-anchor.js';

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

function pointFromHead(head: AuditChainHead): AuditAnchorPoint {
  return head
    ? { counter: head.anchorCounter, headHash: head.headHash }
    : { counter: 0, headHash: AUDIT_CHAIN_GENESIS };
}

function scheduleAuditAnchorSettlement(
  db: DatabaseInstance,
  tenantId: string,
  expected: AuditAnchorPoint
): void {
  queueMicrotask(() => {
    try {
      const head = db
        .select({
          headHash: auditChainHeads.headHash,
          anchorCounter: auditChainHeads.anchorCounter,
        })
        .from(auditChainHeads)
        .where(eq(auditChainHeads.tenantId, tenantId))
        .get() as { headHash: string; anchorCounter: number } | undefined;
      const actual = head
        ? { counter: head.anchorCounter, headHash: head.headHash }
        : { counter: 0, headHash: AUDIT_CHAIN_GENESIS };
      // Settle only the reservation this write observed. A later synchronous
      // transaction may already have extended pending to a newer head.
      if (actual.counter === expected.counter && actual.headHash === expected.headHash) {
        reconcileAuditAnchor(tenantId, actual, 'settle');
      }
    } catch {
      // Pending remains durable. The next write/verification retries recovery
      // and fails closed on divergence; a microtask must never become an
      // unhandled Electron main-process exception.
    }
  });
}

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
    .select({
      headHash: auditChainHeads.headHash,
      headMac: auditChainHeads.headMac,
      anchorCounter: auditChainHeads.anchorCounter,
      version: auditChainHeads.version,
      adoptedAt: auditChainHeads.adoptedAt,
    })
    .from(auditChainHeads)
    .where(eq(auditChainHeads.tenantId, args.tenantId))
    .get() as AuditChainHead;
  // Never append to an untrusted head: otherwise an offline attacker
  // could strip the MAC, recompute history, and wait for the next
  // legitimate action to bless the forged chain with a fresh MAC.
  // A new tenant has no head and is anchored by its first write.
  if (
    head &&
    hasAuditAnchorKey() &&
    (head.headMac === null ||
      !verifyAuditHeadMac(args.tenantId, head.headHash, head.anchorCounter, head.headMac))
  ) {
    throw new Error('AUDIT_CHAIN_HEAD_UNTRUSTED');
  }
  const currentPoint = pointFromHead(head);
  // Detect rewind/divergence before appending. In a multi-write transaction
  // this may see the prior pending point and deliberately keeps it pending.
  reconcileAuditAnchor(args.tenantId, currentPoint, 'write');
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
  const nextPoint = { counter: currentPoint.counter + 1, headHash: chainHash };
  // Persist the reservation outside the DB before advancing the transactional
  // head. Crash-before-commit and crash-after-commit remain distinguishable.
  reserveAuditAnchor(args.tenantId, currentPoint, nextPoint);
  // Anchor the new head outside the DB's trust domain when the
  // deployment has an anchor key (null MAC otherwise — verification
  // then reports the chain as unanchored, not broken).
  const headMac = computeAuditHeadMac(args.tenantId, chainHash, nextPoint.counter);
  if (head) {
    const advanced = args.tx
      .update(auditChainHeads)
      .set({
        headHash: chainHash,
        headMac,
        anchorCounter: nextPoint.counter,
        version: head.version + 1,
        updatedAt: createdAt,
      })
      .where(
        and(
          eq(auditChainHeads.tenantId, args.tenantId),
          eq(auditChainHeads.version, head.version),
          eq(auditChainHeads.headHash, head.headHash)
        )
      )
      .run() as { changes?: number };
    if ((advanced.changes ?? 0) !== 1) {
      throw new Error('AUDIT_CHAIN_HEAD_CONFLICT_RETRY_REQUIRED');
    }
  } else {
    try {
      args.tx
        .insert(auditChainHeads)
        .values({
          tenantId: args.tenantId,
          headHash: chainHash,
          headMac,
          anchorCounter: nextPoint.counter,
          version: 1,
          adoptedAt: createdAt,
          updatedAt: createdAt,
        })
        .run();
    } catch (error) {
      throw new Error('AUDIT_CHAIN_HEAD_CONFLICT_RETRY_REQUIRED', { cause: error });
    }
  }
  scheduleAuditAnchorSettlement(args.tx, args.tenantId, nextPoint);
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
  /** External counter/head state agreed with this database snapshot. */
  freshnessAnchored: boolean;
  reason?:
    | 'missing-link'
    | 'content-mismatch'
    | 'link-mismatch'
    | 'redaction-invalid'
    | 'orphan-rows'
    | 'head-missing'
    | 'anchor-mismatch'
    | 'anchor-divergence'
    | 'unchained-after-adoption'
    | 'snapshot-changed';
}

type AuditChainHead =
  | {
      headHash: string;
      headMac: string | null;
      anchorCounter: number;
      version: number;
      adoptedAt: string;
    }
  | undefined;

const AUDIT_CHAIN_PAGE_SIZE = 512;
const AUDIT_CHAIN_WORKER_THRESHOLD = 1_024;
const AUDIT_CHAIN_SNAPSHOT_RETRIES = 2;

type AuditChainStats = {
  totalCount: number;
  chainedCount: number;
  unchainedAfterAdoption: number;
};

type RawAuditChainRow = {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before: string | null;
  after: string | null;
  metadata: string | null;
  operationId: string | null;
  createdAt: string;
  contentHash: string;
  prevHash: string;
  chainHash: string;
  redactedAt: string | null;
};

type AuditHashPageRow = {
  id: string;
  canonical: string;
  contentHash: string;
  prevHash: string;
  chainHash: string;
  contentInvalid: boolean;
  redactionInvalid: boolean;
};

type AuditHashPageResult =
  | { valid: true; checkedCount: number; nextCursor: string }
  | {
      valid: false;
      checkedCount: number;
      brokenAtId?: string;
      reason: 'missing-link' | 'content-mismatch' | 'link-mismatch' | 'redaction-invalid';
    };

interface AuditChainVerificationOptions {
  pageSize?: number;
  workerThreshold?: number;
  onPage?: (checkedCount: number) => void;
}

function sqliteClient(db: DatabaseInstance): Database.Database {
  const boundary = db as DatabaseInstance & {
    $client?: Database.Database;
    session?: { client?: Database.Database };
  };
  const client = boundary.$client ?? boundary.session?.client;
  if (!client) throw new Error('SQLITE_NATIVE_CLIENT_UNAVAILABLE');
  return client;
}

function readAuditChainStats(
  db: DatabaseInstance,
  tenantId: string,
  adoptedAt: string | null
): AuditChainStats {
  const row = db.get<{
    totalCount: number;
    chainedCount: number;
    unchainedAfterAdoption: number | null;
  }>(sql`
    SELECT
      COUNT(*) AS totalCount,
      COUNT(chain_hash) AS chainedCount,
      SUM(
        CASE
          WHEN chain_hash IS NULL
            AND ${adoptedAt} IS NOT NULL
            AND created_at >= ${adoptedAt}
          THEN 1
          ELSE 0
        END
      ) AS unchainedAfterAdoption
    FROM audit_logs
    WHERE tenant_id = ${tenantId}
  `) as
    { totalCount: number; chainedCount: number; unchainedAfterAdoption: number | null } | undefined;
  return {
    totalCount: row?.totalCount ?? 0,
    chainedCount: row?.chainedCount ?? 0,
    unchainedAfterAdoption: row?.unchainedAfterAdoption ?? 0,
  };
}

function readAuditChainHead(db: DatabaseInstance, tenantId: string): AuditChainHead {
  return db
    .select({
      headHash: auditChainHeads.headHash,
      headMac: auditChainHeads.headMac,
      anchorCounter: auditChainHeads.anchorCounter,
      version: auditChainHeads.version,
      adoptedAt: auditChainHeads.adoptedAt,
    })
    .from(auditChainHeads)
    .where(eq(auditChainHeads.tenantId, tenantId))
    .get() as AuditChainHead;
}

// Reuse one native statement per connection, not one allocation per page.
// Only SQL is retained: tenant/cursor/page bounds are rebound for every read.
const auditPageStatements = new WeakMap<Database.Database, Database.Statement>();

function readBoundedAuditChainPage(
  db: DatabaseInstance,
  tenantId: string,
  cursor: string,
  pageSize: number
): RawAuditChainRow[] {
  const client = sqliteClient(db);
  let statement = auditPageStatements.get(client);
  if (!statement) {
    statement = client.prepare(
      `WITH RECURSIVE chain(
         depth, id, tenantId, actorId, action, resourceType, resourceId,
         beforePayload, afterPayload, metadataPayload, operationId, createdAt,
         contentHash, prevHash, chainHash, redactedAt
       ) AS (
         SELECT
           0, id, tenant_id, actor_id, action, resource_type, resource_id,
           before, after, metadata, operation_id, created_at,
           content_hash, prev_hash, chain_hash, redacted_at
         FROM audit_logs INDEXED BY idx_audit_logs_chain_hash
         WHERE chain_hash = ? AND tenant_id = ?
         UNION ALL
         SELECT
           chain.depth + 1, prior.id, prior.tenant_id, prior.actor_id,
           prior.action, prior.resource_type, prior.resource_id,
           prior.before, prior.after, prior.metadata, prior.operation_id,
           prior.created_at, prior.content_hash, prior.prev_hash,
           prior.chain_hash, prior.redacted_at
         FROM audit_logs AS prior INDEXED BY idx_audit_logs_chain_hash
         INNER JOIN chain ON prior.chain_hash = chain.prevHash
         WHERE prior.tenant_id = ?
           AND chain.prevHash <> ?
           AND chain.depth + 1 < ?
       )
       SELECT
         id, tenantId, actorId, action, resourceType, resourceId,
         beforePayload AS before, afterPayload AS after, metadataPayload AS metadata,
         operationId, createdAt, contentHash, prevHash, chainHash, redactedAt
       FROM chain
       ORDER BY depth ASC
       LIMIT ?`
    );
    auditPageStatements.set(client, statement);
  }
  return statement.all(
    cursor,
    tenantId,
    tenantId,
    AUDIT_CHAIN_GENESIS,
    pageSize,
    pageSize
  ) as RawAuditChainRow[];
}

function parseAuditJson(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  return JSON.parse(value) as Record<string, unknown>;
}

function prepareAuditHashPage(rows: readonly RawAuditChainRow[]): AuditHashPageRow[] {
  return rows.map(row => {
    let before: Record<string, unknown> | null = null;
    let after: Record<string, unknown> | null = null;
    let metadata: Record<string, unknown> | null = null;
    let contentInvalid = false;
    try {
      before = parseAuditJson(row.before);
      after = parseAuditJson(row.after);
      metadata = parseAuditJson(row.metadata);
    } catch {
      contentInvalid = true;
    }
    const redactionInvalid =
      row.redactedAt !== null && (before !== null || after !== null || metadata !== null);
    const canonical =
      row.redactedAt === null
        ? canonicalAuditPayload({
            id: row.id,
            tenantId: row.tenantId,
            actorId: row.actorId,
            action: row.action,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            before,
            after,
            metadata,
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
    return {
      id: row.id,
      canonical,
      contentHash: row.contentHash,
      prevHash: row.prevHash,
      chainHash: row.chainHash,
      contentInvalid,
      redactionInvalid,
    };
  });
}

function verifyAuditHashPage(
  expectedCursor: string,
  rows: readonly AuditHashPageRow[]
): AuditHashPageResult {
  let cursor = expectedCursor;
  let checkedCount = 0;
  let successorId: string | undefined;
  for (const row of rows) {
    if (row.chainHash !== cursor) {
      return {
        valid: false,
        checkedCount,
        ...(successorId !== undefined ? { brokenAtId: successorId } : {}),
        reason: 'missing-link',
      };
    }
    if (row.redactionInvalid) {
      return {
        valid: false,
        checkedCount,
        brokenAtId: row.id,
        reason: 'redaction-invalid',
      };
    }
    if (row.contentInvalid) {
      return {
        valid: false,
        checkedCount,
        brokenAtId: row.id,
        reason: 'content-mismatch',
      };
    }
    if (sha256Hex(row.canonical) !== row.contentHash) {
      return {
        valid: false,
        checkedCount,
        brokenAtId: row.id,
        reason: 'content-mismatch',
      };
    }
    if (sha256Hex(`${row.prevHash}\n${row.contentHash}`) !== row.chainHash) {
      return {
        valid: false,
        checkedCount,
        brokenAtId: row.id,
        reason: 'link-mismatch',
      };
    }
    checkedCount += 1;
    successorId = row.id;
    cursor = row.prevHash;
  }
  return { valid: true, checkedCount, nextCursor: cursor };
}

const AUDIT_HASH_WORKER_SOURCE = String.raw`
  const { parentPort } = require('node:worker_threads');
  const { createHash } = require('node:crypto');
  const sha256Hex = value => createHash('sha256').update(value, 'utf8').digest('hex');
  parentPort.on('message', ({ expectedCursor, rows }) => {
    let cursor = expectedCursor;
    let checkedCount = 0;
    let successorId;
    for (const row of rows) {
      if (row.chainHash !== cursor) {
        parentPort.postMessage({ valid: false, checkedCount, ...(successorId ? { brokenAtId: successorId } : {}), reason: 'missing-link' });
        return;
      }
      if (row.redactionInvalid) {
        parentPort.postMessage({ valid: false, checkedCount, brokenAtId: row.id, reason: 'redaction-invalid' });
        return;
      }
      if (row.contentInvalid) {
        parentPort.postMessage({ valid: false, checkedCount, brokenAtId: row.id, reason: 'content-mismatch' });
        return;
      }
      if (sha256Hex(row.canonical) !== row.contentHash) {
        parentPort.postMessage({ valid: false, checkedCount, brokenAtId: row.id, reason: 'content-mismatch' });
        return;
      }
      if (sha256Hex(row.prevHash + '\n' + row.contentHash) !== row.chainHash) {
        parentPort.postMessage({ valid: false, checkedCount, brokenAtId: row.id, reason: 'link-mismatch' });
        return;
      }
      checkedCount += 1;
      successorId = row.id;
      cursor = row.prevHash;
    }
    parentPort.postMessage({ valid: true, checkedCount, nextCursor: cursor });
  });
`;

function verifyAuditHashPageInWorker(
  worker: Worker,
  expectedCursor: string,
  rows: readonly AuditHashPageRow[]
): Promise<AuditHashPageResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onMessage = (result: AuditHashPageResult) => {
      settled = true;
      cleanup();
      resolve(result);
    };
    const onError = (error: Error) => {
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`AUDIT_CHAIN_WORKER_EXITED:${code}`));
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    try {
      worker.postMessage({ expectedCursor, rows });
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

function sameAuditSnapshot(
  left: { head: AuditChainHead; stats: AuditChainStats },
  right: { head: AuditChainHead; stats: AuditChainStats }
): boolean {
  return (
    left.head?.headHash === right.head?.headHash &&
    left.head?.headMac === right.head?.headMac &&
    left.head?.version === right.head?.version &&
    left.head?.anchorCounter === right.head?.anchorCounter &&
    left.head?.adoptedAt === right.head?.adoptedAt &&
    left.stats.totalCount === right.stats.totalCount &&
    left.stats.chainedCount === right.stats.chainedCount &&
    left.stats.unchainedAfterAdoption === right.stats.unchainedAfterAdoption
  );
}

function readAuditVerificationSnapshot(
  db: DatabaseInstance,
  tenantId: string
): { head: AuditChainHead; stats: AuditChainStats } {
  return db.transaction(tx => {
    const head = readAuditChainHead(tx, tenantId);
    return { head, stats: readAuditChainStats(tx, tenantId, head?.adoptedAt ?? null) };
  });
}

function verifyAuditChainSynchronouslyPaged(args: {
  db: DatabaseInstance;
  tenantId: string;
  head: AuditChainHead;
  stats: AuditChainStats;
  onVerifiedRows?: (rows: readonly RawAuditChainRow[], offset: number) => void;
}): AuditChainVerification {
  const unchainedCount = args.stats.totalCount - args.stats.chainedCount;
  if (args.stats.chainedCount === 0 && !args.head) {
    return {
      valid: true,
      checkedCount: 0,
      unchainedCount,
      anchored: false,
      freshnessAnchored: false,
    };
  }
  if (!args.head) {
    return {
      valid: false,
      checkedCount: 0,
      unchainedCount,
      anchored: false,
      freshnessAnchored: false,
      reason: 'head-missing',
    };
  }

  let anchored = false;
  if (hasAuditAnchorKey()) {
    if (
      args.head.headMac === null ||
      !verifyAuditHeadMac(
        args.tenantId,
        args.head.headHash,
        args.head.anchorCounter,
        args.head.headMac
      )
    ) {
      return {
        valid: false,
        checkedCount: 0,
        unchainedCount,
        anchored: false,
        freshnessAnchored: false,
        reason: 'anchor-mismatch',
      };
    }
    anchored = true;
  }

  let freshnessAnchored: boolean;
  try {
    freshnessAnchored = reconcileAuditAnchor(
      args.tenantId,
      pointFromHead(args.head),
      'write'
    ).freshnessAnchored;
  } catch {
    return {
      valid: false,
      checkedCount: 0,
      unchainedCount,
      anchored,
      freshnessAnchored: false,
      reason: 'anchor-divergence',
    };
  }
  if (args.stats.unchainedAfterAdoption > 0) {
    return {
      valid: false,
      checkedCount: 0,
      unchainedCount,
      anchored,
      freshnessAnchored,
      reason: 'unchained-after-adoption',
    };
  }

  let cursor = args.head.headHash;
  let checkedCount = 0;
  while (cursor !== AUDIT_CHAIN_GENESIS && checkedCount <= args.stats.chainedCount) {
    const rawRows = readBoundedAuditChainPage(
      args.db,
      args.tenantId,
      cursor,
      AUDIT_CHAIN_PAGE_SIZE
    );
    if (rawRows.length === 0) {
      return {
        valid: false,
        checkedCount,
        unchainedCount,
        anchored,
        freshnessAnchored,
        reason: 'missing-link',
      };
    }
    const page = verifyAuditHashPage(cursor, prepareAuditHashPage(rawRows));
    if (!page.valid) {
      return {
        valid: false,
        checkedCount: checkedCount + page.checkedCount,
        unchainedCount,
        anchored,
        freshnessAnchored,
        ...(page.brokenAtId !== undefined ? { brokenAtId: page.brokenAtId } : {}),
        reason: page.reason,
      };
    }
    args.onVerifiedRows?.(rawRows, checkedCount);
    checkedCount += page.checkedCount;
    cursor = page.nextCursor;
  }

  if (cursor !== AUDIT_CHAIN_GENESIS) {
    return {
      valid: false,
      checkedCount,
      unchainedCount,
      anchored,
      freshnessAnchored,
      reason: 'missing-link',
    };
  }
  if (checkedCount !== args.stats.chainedCount) {
    return {
      valid: false,
      checkedCount,
      unchainedCount,
      anchored,
      freshnessAnchored,
      reason: 'orphan-rows',
    };
  }
  return { valid: true, checkedCount, unchainedCount, anchored, freshnessAnchored };
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

  // BetterSQLite3 transactions deliberately do not expose `$client`, but
  // Drizzle's transaction session owns the same synchronous native client.
  // Keeping the walk, payload scrub, rehash and head CAS on that one client is
  // what preserves the privacy operation's all-or-nothing boundary. A Worker
  // is intentionally not used here: handing it the DB would split the caller's
  // transaction (and require exporting SQLCipher material). The admin verifier
  // can offload pure hashing because it owns no business write.
  const client = sqliteClient(args.tx);
  const targetIds = new Set(ids);
  const suffix = nanoid(12).replaceAll('-', '_');
  const walkTable = `audit_redaction_walk_${suffix}`;
  const targetTable = `audit_redaction_target_${suffix}`;
  if (!/^[a-z0-9_]+$/i.test(walkTable) || !/^[a-z0-9_]+$/i.test(targetTable)) {
    throw new Error('AUDIT_REDACTION_TEMP_NAME_INVALID');
  }

  try {
    // The verified walk only retains depth, stable row id, and authenticated
    // content digest. `depth` is the sole temp-table key: audit_logs.id is
    // already globally unique, while link/count verification rejects a cycle
    // before rewrite. A second UNIQUE id index would duplicate all 100k ids in
    // memory without strengthening the verified-chain invariant.
    client.exec(
      `CREATE TEMP TABLE ${walkTable} (
         depth INTEGER PRIMARY KEY,
         id TEXT NOT NULL,
         contentHash TEXT NOT NULL
       ) WITHOUT ROWID;
       CREATE TEMP TABLE ${targetTable} (
         id TEXT PRIMARY KEY,
         redactedContentHash TEXT
       ) WITHOUT ROWID;`
    );
    const insertTarget = client.prepare(
      `INSERT OR IGNORE INTO ${targetTable} (id, redactedContentHash) VALUES (?, NULL)`
    );
    for (const id of ids) insertTarget.run(id);

    const insertWalk = client.prepare(
      `INSERT INTO ${walkTable} (depth, id, contentHash) VALUES (?, ?, ?)`
    );
    const updateTargetHash = client.prepare(
      `UPDATE ${targetTable} SET redactedContentHash = ? WHERE id = ?`
    );
    const snapshot = (() => {
      const head = readAuditChainHead(args.tx, args.tenantId);
      return { head, stats: readAuditChainStats(args.tx, args.tenantId, head?.adoptedAt ?? null) };
    })();
    const verification = verifyAuditChainSynchronouslyPaged({
      db: args.tx,
      tenantId: args.tenantId,
      head: snapshot.head,
      stats: snapshot.stats,
      onVerifiedRows: (rows, offset) => {
        rows.forEach((row, index) => {
          insertWalk.run(offset + index, row.id, row.contentHash);
          if (targetIds.has(row.id)) {
            const redactedContentHash = sha256Hex(
              canonicalRedactedAuditPayload({
                id: row.id,
                tenantId: row.tenantId,
                actorId: row.actorId,
                action: row.action,
                resourceType: row.resourceType,
                resourceId: row.resourceId,
                operationId: row.operationId,
                createdAt: row.createdAt,
                redactedAt: args.redactedAt,
              })
            );
            if (updateTargetHash.run(redactedContentHash, row.id).changes !== 1) {
              throw new Error('AUDIT_REDACTION_TARGET_HASH_MISSING');
            }
          }
        });
      },
    });
    if (!verification.valid) {
      throw new Error(`AUDIT_CHAIN_UNTRUSTED:${verification.reason ?? 'unknown'}`);
    }

    const targetResult = client
      .prepare(
        `UPDATE audit_logs
         SET before = NULL, after = NULL, metadata = NULL, redacted_at = ?
         WHERE tenant_id = ? AND id IN (SELECT id FROM ${targetTable})`
      )
      .run(args.redactedAt, args.tenantId);
    const targetCount = targetResult.changes;
    if (targetCount === 0) return 0;
    if (snapshot.stats.chainedCount === 0) return targetCount;

    const chainedTargets = client
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ${walkTable} walk
         INNER JOIN ${targetTable} target ON target.id = walk.id`
      )
      .get() as { count: number };
    if (chainedTargets.count === 0) return targetCount;

    const updatedWalkTargets = client
      .prepare(
        `UPDATE ${walkTable}
         SET contentHash = (
           SELECT target.redactedContentHash
           FROM ${targetTable} target
           WHERE target.id = ${walkTable}.id
         )
         WHERE id IN (
           SELECT id FROM ${targetTable} WHERE redactedContentHash IS NOT NULL
         )`
      )
      .run();
    if (updatedWalkTargets.changes !== chainedTargets.count) {
      throw new Error('AUDIT_REDACTION_TARGET_HASH_MISSING');
    }

    const updateRow = client.prepare(
      `UPDATE audit_logs
       SET content_hash = ?, prev_hash = ?, chain_hash = ?
       WHERE tenant_id = ? AND id = ?`
    );
    const readRewritePage = client.prepare(
      `SELECT depth, id, contentHash
       FROM ${walkTable}
       WHERE depth < ?
       ORDER BY depth DESC
       LIMIT ?`
    );
    let prevHash = AUDIT_CHAIN_GENESIS;
    let depthCursor = snapshot.stats.chainedCount;
    while (depthCursor > 0) {
      const rewriteRows = readRewritePage.all(depthCursor, AUDIT_CHAIN_PAGE_SIZE) as Array<{
        depth: number;
        id: string;
        contentHash: string;
      }>;
      if (rewriteRows.length === 0) throw new Error('AUDIT_CHAIN_UNTRUSTED:missing-link');
      for (const row of rewriteRows) {
        const contentHash = row.contentHash;
        const chainHash = sha256Hex(`${prevHash}\n${contentHash}`);
        const updated = updateRow.run(contentHash, prevHash, chainHash, args.tenantId, row.id);
        if (updated.changes !== 1) throw new Error('AUDIT_CHAIN_HEAD_CONFLICT_RETRY_REQUIRED');
        prevHash = chainHash;
      }
      depthCursor = rewriteRows.at(-1)?.depth ?? 0;
    }

    const currentPoint = pointFromHead(snapshot.head);
    const nextPoint = { counter: currentPoint.counter + 1, headHash: prevHash };
    reserveAuditAnchor(args.tenantId, currentPoint, nextPoint);
    const advanced = args.tx
      .update(auditChainHeads)
      .set({
        headHash: prevHash,
        headMac: computeAuditHeadMac(args.tenantId, prevHash, nextPoint.counter),
        anchorCounter: nextPoint.counter,
        version: (snapshot.head?.version ?? 0) + 1,
        updatedAt: args.redactedAt,
      })
      .where(
        and(
          eq(auditChainHeads.tenantId, args.tenantId),
          eq(auditChainHeads.version, snapshot.head?.version ?? -1),
          eq(auditChainHeads.headHash, snapshot.head?.headHash ?? AUDIT_CHAIN_GENESIS)
        )
      )
      .run() as { changes?: number };
    if ((advanced.changes ?? 0) !== 1) {
      throw new Error('AUDIT_CHAIN_HEAD_CONFLICT_RETRY_REQUIRED');
    }
    scheduleAuditAnchorSettlement(args.tx, args.tenantId, nextPoint);
    return targetCount;
  } finally {
    client.exec(`DROP TABLE IF EXISTS ${walkTable}; DROP TABLE IF EXISTS ${targetTable};`);
  }
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
 * or env secret. A suffix rewind to a historical head+MAC pair is rejected
 * when a configured external anchor store remembers a newer confirmed
 * counter/head pair. Without that store,
 * the MAC still protects integrity but `freshnessAnchored` remains false.
 * Without an anchor key the
 * recompute-everything attack is undetectable and verification
 * reports anchored: false. Rows with NULL chain columns are tolerated only
 * when they predate `audit_chain_heads.adopted_at`; new unchained rows make
 * verification fail closed.
 */
const auditVerificationFlights = new WeakMap<
  DatabaseInstance,
  Map<string, Promise<AuditChainVerification>>
>();

async function yieldAuditVerification(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

async function verifyAuditChainAttempt(
  db: DatabaseInstance,
  tenantId: string,
  options: AuditChainVerificationOptions
): Promise<{ result: AuditChainVerification; stable: boolean }> {
  const initial = readAuditVerificationSnapshot(db, tenantId);
  const { head, stats } = initial;
  const unchainedCount = stats.totalCount - stats.chainedCount;

  if (stats.chainedCount === 0 && !head) {
    return {
      result: {
        valid: true,
        checkedCount: 0,
        unchainedCount,
        anchored: false,
        freshnessAnchored: false,
      },
      stable: sameAuditSnapshot(initial, readAuditVerificationSnapshot(db, tenantId)),
    };
  }
  if (!head) {
    return {
      result: {
        valid: false,
        checkedCount: 0,
        unchainedCount,
        anchored: false,
        freshnessAnchored: false,
        reason: 'head-missing',
      },
      stable: sameAuditSnapshot(initial, readAuditVerificationSnapshot(db, tenantId)),
    };
  }

  let anchored = false;
  if (hasAuditAnchorKey()) {
    if (
      head.headMac === null ||
      !verifyAuditHeadMac(tenantId, head.headHash, head.anchorCounter, head.headMac)
    ) {
      return {
        result: {
          valid: false,
          checkedCount: 0,
          unchainedCount,
          anchored: false,
          freshnessAnchored: false,
          reason: 'anchor-mismatch',
        },
        stable: sameAuditSnapshot(initial, readAuditVerificationSnapshot(db, tenantId)),
      };
    }
    anchored = true;
  }

  let freshnessAnchored: boolean;
  try {
    freshnessAnchored = reconcileAuditAnchor(
      tenantId,
      pointFromHead(head),
      'settle'
    ).freshnessAnchored;
  } catch {
    return {
      result: {
        valid: false,
        checkedCount: 0,
        unchainedCount,
        anchored,
        freshnessAnchored: false,
        reason: 'anchor-divergence',
      },
      stable: sameAuditSnapshot(initial, readAuditVerificationSnapshot(db, tenantId)),
    };
  }

  if (stats.unchainedAfterAdoption > 0) {
    return {
      result: {
        valid: false,
        checkedCount: 0,
        unchainedCount,
        anchored,
        freshnessAnchored,
        reason: 'unchained-after-adoption',
      },
      stable: sameAuditSnapshot(initial, readAuditVerificationSnapshot(db, tenantId)),
    };
  }

  const pageSize = Math.max(1, Math.min(options.pageSize ?? AUDIT_CHAIN_PAGE_SIZE, 2_048));
  const workerThreshold = Math.max(1, options.workerThreshold ?? AUDIT_CHAIN_WORKER_THRESHOLD);
  const worker =
    stats.chainedCount >= workerThreshold
      ? new Worker(AUDIT_HASH_WORKER_SOURCE, {
          eval: true,
          name: `audit-chain-${tenantId.slice(0, 24)}`,
        })
      : null;

  let cursor = head.headHash;
  let checkedCount = 0;
  try {
    while (cursor !== AUDIT_CHAIN_GENESIS && checkedCount <= stats.chainedCount) {
      const rawRows = readBoundedAuditChainPage(db, tenantId, cursor, pageSize);
      if (rawRows.length === 0) {
        const finalSnapshot = readAuditVerificationSnapshot(db, tenantId);
        return {
          result: {
            valid: false,
            checkedCount,
            unchainedCount,
            anchored,
            freshnessAnchored,
            reason: 'missing-link',
          },
          stable: sameAuditSnapshot(initial, finalSnapshot),
        };
      }

      const rows = prepareAuditHashPage(rawRows);
      const pageResult = worker
        ? await verifyAuditHashPageInWorker(worker, cursor, rows)
        : verifyAuditHashPage(cursor, rows);
      checkedCount += pageResult.checkedCount;
      if (!pageResult.valid) {
        const finalSnapshot = readAuditVerificationSnapshot(db, tenantId);
        return {
          result: {
            valid: false,
            checkedCount,
            unchainedCount,
            anchored,
            freshnessAnchored,
            ...(pageResult.brokenAtId !== undefined ? { brokenAtId: pageResult.brokenAtId } : {}),
            reason: pageResult.reason,
          },
          stable: sameAuditSnapshot(initial, finalSnapshot),
        };
      }
      cursor = pageResult.nextCursor;
      options.onPage?.(checkedCount);
      await yieldAuditVerification();
    }
  } finally {
    if (worker) await worker.terminate();
  }

  const finalSnapshot = readAuditVerificationSnapshot(db, tenantId);
  const stable = sameAuditSnapshot(initial, finalSnapshot);
  if (cursor !== AUDIT_CHAIN_GENESIS) {
    return {
      result: {
        valid: false,
        checkedCount,
        unchainedCount,
        anchored,
        freshnessAnchored,
        reason: 'missing-link',
      },
      stable,
    };
  }
  if (checkedCount !== stats.chainedCount) {
    return {
      result: {
        valid: false,
        checkedCount,
        unchainedCount,
        anchored,
        freshnessAnchored,
        reason: 'orphan-rows',
      },
      stable,
    };
  }
  return {
    result: { valid: true, checkedCount, unchainedCount, anchored, freshnessAnchored },
    stable,
  };
}

async function runAuditChainVerification(
  db: DatabaseInstance,
  tenantId: string,
  options: AuditChainVerificationOptions
): Promise<AuditChainVerification> {
  for (let attempt = 0; attempt <= AUDIT_CHAIN_SNAPSHOT_RETRIES; attempt += 1) {
    const verification = await verifyAuditChainAttempt(db, tenantId, options);
    if (verification.stable) return verification.result;
    await yieldAuditVerification();
  }
  const current = readAuditVerificationSnapshot(db, tenantId);
  return {
    valid: false,
    checkedCount: 0,
    unchainedCount: current.stats.totalCount - current.stats.chainedCount,
    anchored: false,
    freshnessAnchored: false,
    reason: 'snapshot-changed',
  };
}

/**
 * Verify one tenant without materializing its complete history. Each page is
 * resolved backwards from the persisted head through
 * `idx_audit_logs_chain_hash`, includes only canonical hash fields, and yields
 * before the next page. Large chains hash in one short-lived Worker; small
 * chains avoid worker startup cost. A head/count re-read rejects or retries a
 * concurrent snapshot change.
 *
 * In-flight work is shared only while it is pending. The promise is removed in
 * `finally`, so a later call always re-reads SQLite and cannot hide an external
 * mutation behind a cached integrity verdict.
 */
export function verifyAuditChain(
  db: DatabaseInstance,
  tenantId: string,
  options: AuditChainVerificationOptions = {}
): Promise<AuditChainVerification> {
  let flights = auditVerificationFlights.get(db);
  if (!flights) {
    flights = new Map();
    auditVerificationFlights.set(db, flights);
  }
  const existing = flights.get(tenantId);
  if (existing) return existing;

  const pending = runAuditChainVerification(db, tenantId, options).finally(() => {
    if (flights?.get(tenantId) === pending) flights.delete(tenantId);
  });
  flights.set(tenantId, pending);
  return pending;
}

/**
 * Cheap boot gate: validates only persisted heads and external freshness state.
 * Full row hashing remains an explicit admin operation (and is paged in the
 * next hardening band), but a rewound database must not accept ordinary writes
 * merely because nobody opened the audit screen first.
 */
export function assertAuditAnchorHeadsTrusted(db: DatabaseInstance): void {
  const table = db.get<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_chain_heads'`
  );
  if (!table) return;
  const heads = db
    .select({
      tenantId: auditChainHeads.tenantId,
      headHash: auditChainHeads.headHash,
      headMac: auditChainHeads.headMac,
      anchorCounter: auditChainHeads.anchorCounter,
    })
    .from(auditChainHeads)
    .all();
  for (const head of heads) {
    if (
      hasAuditAnchorKey() &&
      (head.headMac === null ||
        !verifyAuditHeadMac(head.tenantId, head.headHash, head.anchorCounter, head.headMac))
    ) {
      throw new Error(`AUDIT_CHAIN_HEAD_UNTRUSTED:${head.tenantId}`);
    }
    reconcileAuditAnchor(
      head.tenantId,
      { counter: head.anchorCounter, headHash: head.headHash },
      'settle'
    );
  }
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
