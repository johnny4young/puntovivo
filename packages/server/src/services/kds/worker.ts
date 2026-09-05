/** Durable, bounded kitchen invalidation delivery. Tickets never depend on connected screens. */
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { DatabaseInstance } from '../../db/index.js';
import {
  kdsOrderEvents,
  kdsOrders,
  kdsOutbox,
  type KdsInvalidationPayload,
  type KdsOutboxStatus,
} from '../../db/schema.js';
import {
  createOutboxKernel,
  BOUNDED_EXPONENTIAL_BACKOFF,
  type OutboxRow,
} from '../../lib/outbox/index.js';
import { WorkerActivityTracker } from '../../lib/worker-activity.js';
import { createModuleLogger } from '../../logging/logger.js';
import type { KdsSseBroadcaster } from './types.js';

const STALE_CLAIM_MS = 5 * 60_000;
const TENANTS_PER_CYCLE = 50;
const ROWS_PER_TENANT = 100;
const payloadSchema = z
  .object({
    eventId: z.string().min(1).max(128),
    orderId: z.string().min(1).max(128),
    siteId: z.string().min(1).max(128),
  })
  .strict();

/** The generic shared kernel owns admission/claim; synchronous delivery owns fenced completion. */
export function createKitchenOutboxKernel() {
  return createOutboxKernel<KdsOutboxStatus, KdsInvalidationPayload>({
    table: kdsOutbox,
    kind: 'kds',
    initialStatus: 'queued',
    processingStatus: 'submitting',
    succeededStatus: 'delivered',
    retryingStatus: 'retrying',
    deadLetterStatus: 'dead_letter',
    terminalStatuses: ['delivered', 'dead_letter'],
    retryPolicy: BOUNDED_EXPONENTIAL_BACKOFF,
  });
}
/** No timers until start; stop rejects admission and awaits all database users. */
export interface KitchenWorker {
  tickOnce(tenantId: string): Promise<{ processed: boolean }>;
  drainOnce(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}
/** A synchronous invalidation broadcaster cannot perform awaited hardware or network work. */
export interface KitchenWorkerOptions {
  db: DatabaseInstance;
  broadcaster: KdsSseBroadcaster;
  intervalMs?: number;
}

export function createKitchenWorker({
  db,
  broadcaster,
  intervalMs = 2_000,
}: KitchenWorkerOptions): KitchenWorker {
  const kernel = createKitchenOutboxKernel();
  const workerId = `kds:${process.pid}:${nanoid()}`;
  const activity = new WorkerActivityTracker();
  const log = createModuleLogger('kds-worker');
  let timer: ReturnType<typeof setInterval> | null = null;
  let cycle: Promise<void> | null = null;
  let tenantCursor: string | null = null;
  const inFlight = new Map<string, Promise<{ processed: boolean }>>();

  /** Reclaim only old processing rows, in bounded tenant-local batches. */
  function recoverStaleClaims(tenantId: string): void {
    const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const rows = db
      .select({ id: kdsOutbox.id })
      .from(kdsOutbox)
      .where(
        and(
          eq(kdsOutbox.tenantId, tenantId),
          eq(kdsOutbox.status, 'submitting'),
          lte(kdsOutbox.lockedAt, cutoff)
        )
      )
      .orderBy(asc(kdsOutbox.lockedAt), asc(kdsOutbox.id))
      .limit(ROWS_PER_TENANT)
      .all();
    if (!rows.length) return;
    db.update(kdsOutbox)
      .set({
        status: 'queued',
        claimToken: null,
        lockedAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(kdsOutbox.tenantId, tenantId),
          eq(kdsOutbox.status, 'submitting'),
          lte(kdsOutbox.lockedAt, cutoff),
          inArray(
            kdsOutbox.id,
            rows.map(row => row.id)
          )
        )
      )
      .run();
  }

  /**
   * Drizzle decodes JSON during SELECT, before domain validation can run.
   * Inspect only scalar ids and SQLite JSON predicates first; retain the raw
   * poisoned payload for forensics while removing it from claim admission.
   */
  function quarantinePoisonRows(tenantId: string): void {
    const invalid = sql`json_valid(${kdsOutbox.payload}) = 0 OR length(CAST(${kdsOutbox.payload} AS BLOB)) > 1024 OR (${kdsOutbox.lastError} IS NOT NULL AND (json_valid(${kdsOutbox.lastError}) = 0 OR length(CAST(${kdsOutbox.lastError} AS BLOB)) > 4096))`;
    const scope = and(
      eq(kdsOutbox.tenantId, tenantId),
      inArray(kdsOutbox.status, ['queued', 'retrying']),
      isNull(kdsOutbox.claimToken),
      sql`(${invalid})`
    );
    const rows = db
      .select({ id: kdsOutbox.id })
      .from(kdsOutbox)
      .where(scope)
      .orderBy(asc(kdsOutbox.createdAt), asc(kdsOutbox.id))
      .limit(ROWS_PER_TENANT)
      .all();
    if (!rows.length) return;
    db.update(kdsOutbox)
      .set({
        status: 'dead_letter',
        lastError: {
          errorCode: 'KDS_SNAPSHOT_INVALID',
          providerMessage: 'KDS_SNAPSHOT_INVALID',
          recoverable: false,
        },
        nextRetryAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          scope,
          inArray(
            kdsOutbox.id,
            rows.map(row => row.id)
          )
        )
      )
      .run();
  }

  /**
   * Recheck ownership, broadcast and finish without an await under the same
   * writer. A recovered/stale worker cannot finish someone else's claim. SSE
   * is deliberately at-least-once: a crash after broadcast may invalidate twice,
   * but can never create another preparation ticket or lose the persisted one.
   */
  function deliver(
    claimed: OutboxRow<KdsInvalidationPayload, KdsOutboxStatus>,
    signal: AbortSignal
  ): boolean {
    return db.transaction(
      tx => {
        const fence = and(
          eq(kdsOutbox.id, claimed.id),
          eq(kdsOutbox.tenantId, claimed.tenantId),
          eq(kdsOutbox.status, 'submitting'),
          eq(kdsOutbox.claimToken, claimed.claimToken!)
        );
        const row = tx.select().from(kdsOutbox).where(fence).get();
        if (!row) return false;
        if (signal.aborted) {
          tx.update(kdsOutbox)
            .set({ status: 'queued', claimToken: null, lockedAt: null })
            .where(fence)
            .run();
          return false;
        }
        const parsed = payloadSchema.safeParse(row.payload);
        const event = tx
          .select({
            id: kdsOrderEvents.id,
            orderId: kdsOrderEvents.orderId,
            siteId: kdsOrderEvents.siteId,
          })
          .from(kdsOrderEvents)
          .innerJoin(
            kdsOrders,
            and(
              eq(kdsOrders.id, kdsOrderEvents.orderId),
              eq(kdsOrders.tenantId, claimed.tenantId),
              eq(kdsOrders.siteId, kdsOrderEvents.siteId)
            )
          )
          .where(
            and(eq(kdsOrderEvents.id, row.eventId), eq(kdsOrderEvents.tenantId, claimed.tenantId))
          )
          .get();
        let errorCode: string | null = null;
        let recoverable = false;
        if (
          row.payloadVersion !== 1 ||
          !parsed.success ||
          !event ||
          parsed.data.eventId !== event.id ||
          parsed.data.orderId !== event.orderId ||
          parsed.data.siteId !== event.siteId
        ) {
          errorCode = 'KDS_SNAPSHOT_INVALID';
        } else {
          try {
            broadcaster.broadcast(
              'kds.order.updated',
              { eventId: event.id, orderId: event.orderId, siteId: event.siteId },
              claimed.tenantId
            );
          } catch {
            errorCode = 'KDS_NOTIFICATION_UNAVAILABLE';
            recoverable = true;
          }
        }
        const now = new Date().toISOString();
        if (errorCode) {
          const delay = recoverable ? BOUNDED_EXPONENTIAL_BACKOFF.nextDelayMs(row.attempts) : null;
          const retry =
            delay !== null && row.attempts + 1 < BOUNDED_EXPONENTIAL_BACKOFF.maxAttempts;
          tx.update(kdsOutbox)
            .set({
              status: retry ? 'retrying' : 'dead_letter',
              attempts: row.attempts + 1,
              claimToken: null,
              lockedAt: null,
              nextRetryAt: retry ? new Date(Date.now() + delay!).toISOString() : null,
              lastError: { errorCode, providerMessage: errorCode, recoverable },
              updatedAt: now,
            })
            .where(fence)
            .run();
        } else {
          tx.update(kdsOutbox)
            .set({
              status: 'delivered',
              claimToken: null,
              lockedAt: null,
              nextRetryAt: null,
              lastError: null,
              updatedAt: now,
            })
            .where(fence)
            .run();
        }
        return true;
      },
      { behavior: 'immediate' }
    );
  }

  function tickOnce(tenantId: string): Promise<{ processed: boolean }> {
    const existing = inFlight.get(tenantId);
    if (existing) return existing;
    const running = activity.tryRun(async signal => {
      if (signal.aborted) return { processed: false };
      recoverStaleClaims(tenantId);
      quarantinePoisonRows(tenantId);
      const claimed = await kernel.claimNext(db, { tenantId, workerId });
      return { processed: claimed ? deliver(claimed, signal) : false };
    });
    if (!running) return Promise.resolve({ processed: false });
    inFlight.set(tenantId, running);
    void running
      .finally(() => {
        if (inFlight.get(tenantId) === running) inFlight.delete(tenantId);
      })
      .catch(() => {});
    return running;
  }

  function drainOnce(): Promise<void> {
    if (cycle) return cycle;
    const running = activity.tryRun(async signal => {
      const now = new Date().toISOString();
      const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
      const due = or(
        and(
          inArray(kdsOutbox.status, ['queued', 'retrying']),
          or(isNull(kdsOutbox.nextRetryAt), lte(kdsOutbox.nextRetryAt, now))
        ),
        and(eq(kdsOutbox.status, 'submitting'), lte(kdsOutbox.lockedAt, cutoff))
      );
      const load = (cursor: string | null) =>
        db
          .selectDistinct({ tenantId: kdsOutbox.tenantId })
          .from(kdsOutbox)
          .where(and(due, cursor ? gt(kdsOutbox.tenantId, cursor) : undefined))
          .orderBy(asc(kdsOutbox.tenantId))
          .limit(TENANTS_PER_CYCLE)
          .all();
      let tenants = load(tenantCursor);
      if (!tenants.length && tenantCursor !== null) tenants = load(null);
      tenantCursor = tenants.at(-1)?.tenantId ?? null;
      for (const tenant of tenants) {
        try {
          for (let index = 0; index < ROWS_PER_TENANT && !signal.aborted; index++) {
            const result = await tickOnce(tenant.tenantId);
            if (!result.processed) break;
          }
        } catch (err) {
          // A damaged or busy tenant must not starve the rest of this batch.
          log.warn(
            { err, tenantId: tenant.tenantId },
            'Kitchen tenant drain failed; continuing other kitchens'
          );
        }
        if (signal.aborted) break;
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    });
    if (!running) return Promise.resolve();
    cycle = running;
    void running
      .finally(() => {
        if (cycle === running) cycle = null;
      })
      .catch(() => {});
    return running;
  }

  function schedule(): void {
    void drainOnce().catch(err =>
      log.warn({ err }, 'Kitchen invalidation drain failed; persisted work will retry')
    );
  }
  return {
    tickOnce,
    drainOnce,
    start() {
      if (timer) return;
      activity.reopen();
      timer = setInterval(schedule, intervalMs);
      timer.unref();
      schedule();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      return activity.stop();
    },
  };
}
