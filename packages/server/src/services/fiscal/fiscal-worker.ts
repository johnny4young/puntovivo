/**
 * Fiscal worker daemon.
 *
 * Drains `fiscal_outbox` rows. Each tick: claim one row scoped to a
 * tenant, dispatch the adapter via the registry, mirror the verdict
 * back to `fiscal_documents.status`, transition the outbox row via
 * the kernel.
 *
 * Lifecycle:
 *
 * queued -> submitting -> accepted | rejected | contingency
 * \-> retrying -> dead_letter
 *
 * Mirror invariant (operator-visible state machine):
 *
 * process success                -> doc=accepted, outbox=accepted
 * recoverable err + budget left  -> doc=contingency, outbox=retrying
 * recoverable err + budget gone  -> doc=contingency (kept), outbox=dead_letter
 * non-recoverable err            -> doc=rejected, outbox=dead_letter
 *
 * The worker writes the doc status BEFORE the kernel transition so
 * an operator never sees a torn window where outbox=accepted but
 * doc=pending. Dead-letter from a recoverable error keeps the doc
 * at `contingency` so the operator can manual-retry.
 *
 * Boots from `packages/server/src/index.ts::createServer`. The
 * default singleton is registered on `setDefaultFiscalWorker` so
 * `safelyEmitFiscalDocument` can fire-and-forget an immediate tick
 * after enqueue without taking a worker reference through every
 * call site.
 *
 * @module services/fiscal/fiscal-worker
 */

import { and, count, eq, isNotNull, lte, min, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  fiscalDocuments,
  fiscalOutbox,
  tenants,
  type FiscalOutboxStatus,
} from '../../db/schema.js';
import type {
  FiscalAdapter,
  FiscalAdapterIssueInput,
  FiscalAdapterIssueResult,
} from './adapter.js';
import {
  BOUNDED_EXPONENTIAL_BACKOFF,
  createOutboxKernel,
  recordFailure,
  recordSuccess,
  refreshPendingCount,
  tickOutbox,
  type OutboxRetryPolicy,
  type OutboxRow,
} from '../../lib/outbox/index.js';
import { createModuleLogger, type PuntovivoLogger } from '../../logging/logger.js';
import { normalizeFiscalError } from './error-normalizer.js';
import { toOutboxError } from './errors.js';
import { getFiscalAdapter } from './registry.js';
import { enqueueWebhook } from '../events/enqueue-webhook.js';
import { projectFiscalDocumentAccepted } from '../events/projector.js';
import { isModuleActiveInSettings } from '../modules/manifest.js';

const fallbackLog = createModuleLogger('services/fiscal/fiscal-worker');

const DEFAULT_INTERVAL_MS = 30_000;
const STALE_CLAIM_MS = 5 * 60_000; // 5 minutes
const ADAPTER_TIMEOUT_MS = 60_000;

export interface FiscalOutboxPayload {
  countryCode: string;
  providerId: string;
  fiscalDocumentId: string;
  adapterInput: FiscalAdapterIssueInput;
}

export interface FiscalWorker {
  tickOnce(tenantId: string): Promise<TickOutcome>;
  start(): void;
  stop(): Promise<void>;
}

export interface TickOutcome {
  processed: boolean;
  rowId?: string;
  outcome?: 'completed' | 'retrying' | 'dead_letter';
}

export interface CreateFiscalWorkerOptions {
  db: DatabaseInstance;
  /**
   * Async iterator over tenants the worker should fan-out across on
   * each periodic tick. Default: every active tenant.
   */
  tenantIdsProvider?: () => Promise<string[]>;
  intervalMs?: number;
  workerId?: string;
  log?: PuntovivoLogger;
  /** Override for tests; defaults to BOUNDED_EXPONENTIAL_BACKOFF. */
  retryPolicy?: OutboxRetryPolicy;
  /**
   * Adapter resolver. Defaults to the registry's `getFiscalAdapter`.
   * Tests inject a stub here to control adapter behavior without
   * touching the registry singleton.
   */
  resolveAdapter?: (countryCode: string) => FiscalAdapter;
}

/**
 * Create a fiscal outbox kernel scoped to the supplied retry policy.
 * Pulled out as a factory so tests can spin up a kernel with a fast
 * retry policy without booting the full worker.
 */
export function createFiscalOutboxKernel(
  retryPolicy: OutboxRetryPolicy = BOUNDED_EXPONENTIAL_BACKOFF
) {
  return createOutboxKernel<FiscalOutboxStatus, FiscalOutboxPayload>({
    table: fiscalOutbox,
    kind: 'fiscal',
    initialStatus: 'queued',
    processingStatus: 'submitting',
    succeededStatus: 'accepted',
    retryingStatus: 'retrying',
    deadLetterStatus: 'dead_letter',
    terminalStatuses: ['accepted', 'rejected', 'dead_letter'] as const,
    retryPolicy,
  });
}

/**
 * Wrap a promise with a hard timeout. Used to guard against adapter
 * calls that hang past `ADAPTER_TIMEOUT_MS`. Throws a `TypeError`
 * (the normalizer maps that to MALFORMED_REQUEST — non-recoverable)
 * vs. a regular `Error` (PROVIDER_5XX recoverable). For a hung
 * provider we want recoverable, so we throw a regular Error here.
 */
async function withAdapterTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Fiscal adapter call exceeded ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createFiscalWorker(opts: CreateFiscalWorkerOptions): FiscalWorker {
  const {
    db,
    intervalMs = DEFAULT_INTERVAL_MS,
    workerId = `fiscal:${process.pid}`,
    log = fallbackLog,
    retryPolicy = BOUNDED_EXPONENTIAL_BACKOFF,
    resolveAdapter = getFiscalAdapter,
  } = opts;

  const tenantIdsProvider =
    opts.tenantIdsProvider ??
    (async (): Promise<string[]> => {
      const rows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.isActive, true));
      return rows.map(row => row.id);
    });

  const kernel = createFiscalOutboxKernel(retryPolicy);

  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let staleSweepHandle: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  /**
   * Reclaim outbox rows whose `claim_token`/`locked_at` is older
   * than STALE_CLAIM_MS — typically caused by a worker process
   * dying mid-tick. We flip them back to `queued` so the next
   * claim picks them up.
   */
  async function sweepStaleClaims(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    try {
      await db
        .update(fiscalOutbox)
        .set({
          claimToken: null,
          lockedAt: null,
          status: sql`CASE WHEN ${fiscalOutbox.status} = 'submitting' THEN 'queued' ELSE ${fiscalOutbox.status} END`,
          updatedAt: new Date().toISOString(),
        })
        .where(and(isNotNull(fiscalOutbox.lockedAt), lte(fiscalOutbox.lockedAt, cutoff)));
    } catch (err) {
      log.warn({ err }, 'fiscal worker stale-claim sweep failed');
    }
  }

  async function processFiscalRow(
    row: OutboxRow<FiscalOutboxPayload, FiscalOutboxStatus>
  ): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof toOutboxError> }> {
    const payload = row.payload;
    const adapter = resolveAdapter(payload.countryCode);
    const nowIso = new Date().toISOString();

    try {
      const issued = await withAdapterTimeout(
        adapter.issue(payload.adapterInput),
        ADAPTER_TIMEOUT_MS
      );

      // Mirror to fiscal_documents BEFORE the kernel transition so the
      // operator never sees outbox=accepted while doc=pending.
      await db
        .update(fiscalDocuments)
        .set({
          status: issued.status,
          cufe: issued.cufe,
          providerResponse: issued.providerResponse,
          xmlRef: issued.xmlRef,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(fiscalDocuments.id, payload.fiscalDocumentId),
            eq(fiscalDocuments.tenantId, row.tenantId)
          )
        );

      // Patch the outbox row's cufe so the dead-letter triage path can
      // join back to the document without a second query.
      await db
        .update(fiscalOutbox)
        .set({ cufe: issued.cufe, updatedAt: nowIso })
        .where(and(eq(fiscalOutbox.id, row.id), eq(fiscalOutbox.tenantId, row.tenantId)));

      if (issued.status === 'accepted') {
        await maybeEnqueueFiscalAcceptedEvent({
          row,
          payload,
          issued,
          acceptedAt: nowIso,
        });
      }

      return { ok: true };
    } catch (err) {
      const normalized = normalizeFiscalError(err, adapter.providerId);
      const docStatus = normalized.recoverable ? 'contingency' : 'rejected';

      await db
        .update(fiscalDocuments)
        .set({
          status: docStatus,
          retries: row.attempts + 1,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(fiscalDocuments.id, payload.fiscalDocumentId),
            eq(fiscalDocuments.tenantId, row.tenantId)
          )
        );

      return { ok: false, error: toOutboxError(normalized) };
    }
  }

  async function maybeEnqueueFiscalAcceptedEvent(args: {
    row: OutboxRow<FiscalOutboxPayload, FiscalOutboxStatus>;
    payload: FiscalOutboxPayload;
    issued: FiscalAdapterIssueResult;
    acceptedAt: string;
  }): Promise<void> {
    const { row, payload, issued, acceptedAt } = args;
    try {
      const tenant = await db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, row.tenantId))
        .get();
      if (!tenant || !isModuleActiveInSettings(tenant.settings, 'events-api')) {
        return;
      }

      const event = projectFiscalDocumentAccepted({
        tenantId: row.tenantId,
        operationEventId: null,
        payload: {
          fiscalDocumentId: payload.fiscalDocumentId,
          cufe: issued.cufe,
          documentNumber: payload.adapterInput.resolution.documentNumber,
          source: payload.adapterInput.source,
          sourceId: payload.adapterInput.sourceId,
          countryCode: payload.countryCode,
          providerId: issued.providerId,
          acceptedAt,
        },
      });
      if (!event) {
        return;
      }

      db.transaction(tx => {
        enqueueWebhook(tx, {
          tenantId: row.tenantId,
          event,
          idempotencyKey: payload.fiscalDocumentId,
        });
      });
    } catch (err) {
      log.warn(
        { err, tenantId: row.tenantId, fiscalDocumentId: payload.fiscalDocumentId },
        'fiscal accepted webhook enqueue failed (non-blocking)'
      );
    }
  }

  async function tickOnce(tenantId: string): Promise<TickOutcome> {
    if (stopped) return { processed: false };
    const result = await tickOutbox<FiscalOutboxPayload, FiscalOutboxStatus>(db, tenantId, {
      kernel,
      workerId,
      loggerLabel: 'fiscal-outbox-worker',
      process: async ({ row }) => processFiscalRow(row),
    });

    if (result.processed) {
      try {
        if (result.outcome === 'completed') {
          await recordSuccess(db, { tenantId, outboxKind: 'fiscal' });
        } else if (result.outcome === 'dead_letter') {
          await recordFailure(db, { tenantId, outboxKind: 'fiscal' });
        }
      } catch (err) {
        log.debug({ err, tenantId }, 'fiscal outbox metadata write failed (non-blocking)');
      }
      return {
        processed: true,
        rowId: result.rowId,
        outcome: result.outcome,
      };
    }
    return { processed: false };
  }

  async function refreshMetadataForAllTenants(): Promise<void> {
    try {
      const ids = await tenantIdsProvider();
      const nowIso = new Date().toISOString();
      for (const tenantId of ids) {
        const aggregate = await db
          .select({
            pendingCount: count(),
            oldestPendingAt: min(fiscalOutbox.createdAt),
          })
          .from(fiscalOutbox)
          .where(
            and(
              eq(fiscalOutbox.tenantId, tenantId),
              sql`${fiscalOutbox.status} IN ('queued', 'submitting', 'retrying', 'contingency')`
            )
          )
          .get();
        await refreshPendingCount(db, {
          tenantId,
          outboxKind: 'fiscal',
          pendingCount: aggregate?.pendingCount ?? 0,
          oldestPendingAt: aggregate?.oldestPendingAt ?? null,
          nowIso,
        });
      }
    } catch (err) {
      log.warn({ err }, 'fiscal worker metadata refresh failed');
    }
  }

  async function periodicTick(): Promise<void> {
    if (stopped) return;
    try {
      const ids = await tenantIdsProvider();
      for (const tenantId of ids) {
        // Drain in a loop until the tenant has no more eligible rows.
        // Bounded by a small limit so a hot tenant doesn't starve
        // the others on the same tick.
        const MAX_PER_TENANT_PER_TICK = 25;
        for (let i = 0; i < MAX_PER_TENANT_PER_TICK; i++) {
          const result = await tickOnce(tenantId);
          if (!result.processed) break;
        }
      }
    } catch (err) {
      log.warn({ err }, 'fiscal worker periodic tick failed');
    }
  }

  function start(): void {
    if (intervalHandle) return;
    stopped = false;
    log.info({ workerId, intervalMs }, 'fiscal worker started');
    // Run the stale-claim sweep at startup so a previous-process
    // crash doesn't leave wedged rows for one full interval.
    void sweepStaleClaims();
    intervalHandle = setInterval(() => {
      void periodicTick();
    }, intervalMs);
    staleSweepHandle = setInterval(() => {
      void sweepStaleClaims();
      void refreshMetadataForAllTenants();
    }, STALE_CLAIM_MS);
    if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
    if (typeof staleSweepHandle.unref === 'function') staleSweepHandle.unref();
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (staleSweepHandle) {
      clearInterval(staleSweepHandle);
      staleSweepHandle = null;
    }
    log.info({ workerId }, 'fiscal worker stopped');
  }

  return { tickOnce, start, stop };
}

// =============================================================================
// Default singleton (boot-time wiring)
// =============================================================================

let defaultWorker: FiscalWorker | null = null;

export function setDefaultFiscalWorker(worker: FiscalWorker | null): void {
  defaultWorker = worker;
}

export function getDefaultFiscalWorker(): FiscalWorker | null {
  return defaultWorker;
}

/**
 * Fire-and-forget tick on the default worker singleton. Used by
 * `safelyEmitFiscalDocument` after enqueue to drain the new row
 * immediately. When no default worker is registered (test
 * configurations that don't boot one), the call no-ops.
 */
export async function tickDefaultFiscalWorker(tenantId: string): Promise<void> {
  const worker = defaultWorker;
  if (!worker) return;
  await worker.tickOnce(tenantId);
}
