/**
 * ENG-187 — Operations "Needs attention" aggregation.
 *
 * One tenant-scoped probe that answers "what failed and needs a retry?"
 * across the retryable outbox / sync surfaces, so the Operations landing
 * can open on an actionable-failures queue instead of the flat Sync tab.
 *
 * It reuses the readiness count probes (`readSyncBacklog`,
 * `countFiscalOutboxFailures` from `services/readiness/signals.ts`) and
 * adds the two missing outbox counts (hardware + payment), so there is a
 * single source of truth for each "is X failing?" query.
 *
 * Scope note: cash over/short and inventory drift are intentionally NOT
 * included — those are reconciliation states that need a physical recount,
 * not a retry, and are computed by heavier report queries. The queue here
 * is the retryable outbox/sync failures only.
 *
 * @module services/operations/attention
 */
import { and, count, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { hardwareOutbox, paymentOutbox } from '../../db/schema.js';
import {
  countFiscalOutboxFailures,
  readSyncBacklog,
} from '../readiness/signals.js';

/**
 * The four retryable failure surfaces the Needs-attention queue covers.
 * Each value is ALSO the Operations `?tab=` key the row's CTA deep-links
 * to (`sync` / `fiscal` / `device` / `payments`), so they must stay in
 * lockstep with `OperationsPage` `TAB_KEYS`.
 */
export const OPERATIONS_ATTENTION_AREAS = [
  'sync',
  'fiscal',
  'device',
  'payments',
] as const;
export type OperationsAttentionArea =
  (typeof OPERATIONS_ATTENTION_AREAS)[number];

/**
 * Severity of an attention row. `danger` = terminal/stuck failures that
 * need a retry (sync conflicts, fiscal/hardware/payment outbox failures);
 * `warning` = a soft backlog signal (sync replication behind) that is not
 * failing, just lagging.
 */
export type OperationsAttentionSeverity = 'danger' | 'warning';

/** One area that currently needs attention. Areas with nothing pending are omitted. */
export interface OperationsAttentionEntry {
  area: OperationsAttentionArea;
  severity: OperationsAttentionSeverity;
  /** How many items are pending in that area (conflicts / failed docs / stuck jobs). */
  count: number;
}

/**
 * The Needs-attention payload. `areas` only contains surfaces that need
 * attention (empty = all clear). `highestSeverity` is `null` when all
 * clear, else the most severe area present (drives the badge tone).
 */
export interface OperationsNeedsAttention {
  areas: OperationsAttentionEntry[];
  totalCount: number;
  highestSeverity: OperationsAttentionSeverity | null;
}

/**
 * Pending sync rows above this count surface as a soft `warning` (the
 * replication is lagging but nothing has failed). Mirrors the readiness
 * sync threshold (`services/readiness` treats pending > 25 as degraded).
 */
const SYNC_BACKLOG_WARNING_THRESHOLD = 25;

/** Hardware-outbox statuses that mean a print/drawer job is stuck or failed. */
const HARDWARE_OUTBOX_FAILURE_STATUSES = [
  'failed',
  'retrying',
  'dead_letter',
] as const;

/** Payment-outbox statuses that mean a charge/refund is declined or stuck. */
const PAYMENT_OUTBOX_FAILURE_STATUSES = [
  'declined',
  'timeout',
  'retrying',
  'dead_letter',
] as const;

/**
 * Count hardware-outbox rows in a failed / stuck state for the tenant.
 * A positive count means receipt prints or drawer kicks are not landing.
 */
export async function countHardwareOutboxFailures(
  db: DatabaseInstance,
  tenantId: string
): Promise<number> {
  const row = await db
    .select({ total: count(hardwareOutbox.id) })
    .from(hardwareOutbox)
    .where(
      and(
        eq(hardwareOutbox.tenantId, tenantId),
        inArray(hardwareOutbox.status, [...HARDWARE_OUTBOX_FAILURE_STATUSES])
      )
    )
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Count payment-outbox rows in a declined / stuck state for the tenant.
 * A positive count means electronic charges or refunds need operator
 * attention (retry or mark-settled in the Payments panel).
 */
export async function countPaymentOutboxFailures(
  db: DatabaseInstance,
  tenantId: string
): Promise<number> {
  const row = await db
    .select({ total: count(paymentOutbox.id) })
    .from(paymentOutbox)
    .where(
      and(
        eq(paymentOutbox.tenantId, tenantId),
        inArray(paymentOutbox.status, [...PAYMENT_OUTBOX_FAILURE_STATUSES])
      )
    )
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Aggregate the retryable-failure counts into the Needs-attention payload
 * for the tenant. An area is omitted when it has nothing pending. Sync
 * conflicts outrank a sync backlog (conflicts = `danger`, a large pending
 * backlog with no conflicts = `warning`).
 */
export async function computeNeedsAttention(
  db: DatabaseInstance,
  tenantId: string
): Promise<OperationsNeedsAttention> {
  const [backlog, fiscalFailures, hardwareFailures, paymentFailures] =
    await Promise.all([
      readSyncBacklog(db, tenantId),
      countFiscalOutboxFailures(db, tenantId),
      countHardwareOutboxFailures(db, tenantId),
      countPaymentOutboxFailures(db, tenantId),
    ]);

  const areas: OperationsAttentionEntry[] = [];

  if (backlog.conflicts > 0) {
    areas.push({ area: 'sync', severity: 'danger', count: backlog.conflicts });
  } else if (backlog.pending > SYNC_BACKLOG_WARNING_THRESHOLD) {
    areas.push({ area: 'sync', severity: 'warning', count: backlog.pending });
  }
  if (fiscalFailures > 0) {
    areas.push({ area: 'fiscal', severity: 'danger', count: fiscalFailures });
  }
  if (hardwareFailures > 0) {
    areas.push({ area: 'device', severity: 'danger', count: hardwareFailures });
  }
  if (paymentFailures > 0) {
    areas.push({
      area: 'payments',
      severity: 'danger',
      count: paymentFailures,
    });
  }

  const totalCount = areas.reduce((sum, entry) => sum + entry.count, 0);
  const highestSeverity: OperationsAttentionSeverity | null = areas.some(
    entry => entry.severity === 'danger'
  )
    ? 'danger'
    : areas.length > 0
      ? 'warning'
      : null;

  return { areas, totalCount, highestSeverity };
}
