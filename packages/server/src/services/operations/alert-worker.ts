/**
 * External operational-alert delivery worker.
 *
 * Reconciles the tenant's in-product attention signals, then drains a dedicated
 * signed-webhook outbox. Every network attempt is retained as bounded metadata;
 * request bodies, credentials, destination IPs, and response bodies are never
 * persisted.
 *
 * @module services/operations/alert-worker
 */
import { and, eq, inArray, isNotNull, isNull, lte, max, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  operationalAlertDeliveries,
  operationalAlertDeliveryAttempts,
  tenants,
  webhookSubscriptions,
  type OperationalAlertDeliveryPayload,
  type OperationalAlertDeliveryStatus,
} from '../../db/schema.js';
import { createOutboxKernel } from '../../lib/outbox/kernel.js';
import { tickOutbox } from '../../lib/outbox/worker.js';
import type { NormalizedOutboxError, OutboxRetryPolicy } from '../../lib/outbox/types.js';
import { createModuleLogger } from '../../logging/logger.js';
import { WorkerActivityTracker } from '../../lib/worker-activity.js';
import {
  resolvePublicWebhookDestination,
  type WebhookAddressResolver,
} from '../events/destination-policy.js';
import { postPinnedWebhook, type WebhookTransport } from '../events/webhook-http.js';
import { openWebhookSecret, signWebhookPayload } from '../events/secret-box.js';
import { pruneOperationalAlertEvidence, reconcileOperationalAlerts } from './alerts.js';

const ALERT_RETRY_POLICY: OutboxRetryPolicy = {
  maxAttempts: 6,
  nextDelayMs(attempts) {
    return [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000][attempts] ?? null;
  },
};
const EVIDENCE_PRUNE_INTERVAL_MS = 24 * 60 * 60_000;

const alertKernel = createOutboxKernel<
  OperationalAlertDeliveryStatus,
  OperationalAlertDeliveryPayload
>({
  table: operationalAlertDeliveries,
  kind: 'operational-alert',
  initialStatus: 'queued',
  processingStatus: 'submitting',
  succeededStatus: 'delivered',
  retryingStatus: 'retrying',
  deadLetterStatus: 'dead_letter',
  terminalStatuses: ['delivered', 'dead_letter'],
  retryPolicy: ALERT_RETRY_POLICY,
});

export interface OperationalAlertWorker {
  start(): void;
  stop(): Promise<void>;
  tickOnce(tenantId: string): Promise<Awaited<ReturnType<typeof tickOutbox>>>;
  tickAll(): Promise<void>;
}

export interface CreateOperationalAlertWorkerOptions {
  db: DatabaseInstance;
  transport?: WebhookTransport;
  resolver?: WebhookAddressResolver;
  intervalMs?: number;
  now?: () => Date;
}

type AttemptEvidence = {
  id: string;
  responseStatus: number | null;
  errorCode: string | null;
};

export function createOperationalAlertWorker(
  options: CreateOperationalAlertWorkerOptions
): OperationalAlertWorker {
  const {
    db,
    transport = postPinnedWebhook,
    resolver,
    intervalMs = 15_000,
    now = () => new Date(),
  } = options;
  const workerId = `operational-alert:${process.pid}`;
  const log = createModuleLogger('services/operations/alert-worker');
  let timer: NodeJS.Timeout | null = null;
  let active: Promise<void> | null = null;
  let lastEvidencePruneAt = 0;
  let stopped = false;
  const activity = new WorkerActivityTracker();

  async function reclaimStaleClaims(tenantId: string): Promise<void> {
    const cutoff = new Date(now().getTime() - 5 * 60_000).toISOString();
    const stale = await db
      .select({ id: operationalAlertDeliveries.id })
      .from(operationalAlertDeliveries)
      .where(
        and(
          eq(operationalAlertDeliveries.tenantId, tenantId),
          eq(operationalAlertDeliveries.status, 'submitting'),
          isNotNull(operationalAlertDeliveries.lockedAt),
          lte(operationalAlertDeliveries.lockedAt, cutoff)
        )
      )
      .all();
    if (stale.length === 0) return;
    const reclaimedAt = now().toISOString();
    const deliveryIds = stale.map(row => row.id);
    db.transaction(tx => {
      const reclaimed = tx
        .update(operationalAlertDeliveries)
        .set({
          status: 'retrying',
          claimToken: null,
          lockedAt: null,
          nextRetryAt: null,
          updatedAt: reclaimedAt,
        })
        .where(
          and(
            eq(operationalAlertDeliveries.tenantId, tenantId),
            inArray(operationalAlertDeliveries.id, deliveryIds),
            eq(operationalAlertDeliveries.status, 'submitting'),
            isNotNull(operationalAlertDeliveries.lockedAt),
            lte(operationalAlertDeliveries.lockedAt, cutoff)
          )
        )
        .returning({ id: operationalAlertDeliveries.id })
        .all();
      if (reclaimed.length === 0) return;
      tx.update(operationalAlertDeliveryAttempts)
        .set({
          outcome: 'retrying',
          errorCode: 'OPERATIONAL_ALERT_WORKER_INTERRUPTED',
          completedAt: reclaimedAt,
        })
        .where(
          and(
            eq(operationalAlertDeliveryAttempts.tenantId, tenantId),
            inArray(
              operationalAlertDeliveryAttempts.deliveryId,
              reclaimed.map(row => row.id)
            ),
            eq(operationalAlertDeliveryAttempts.outcome, 'attempting'),
            isNull(operationalAlertDeliveryAttempts.completedAt)
          )
        )
        .run();
    });
  }

  async function beginAttempt(tenantId: string, deliveryId: string): Promise<AttemptEvidence> {
    const previous = await db
      .select({ value: max(operationalAlertDeliveryAttempts.attemptNumber) })
      .from(operationalAlertDeliveryAttempts)
      .where(
        and(
          eq(operationalAlertDeliveryAttempts.tenantId, tenantId),
          eq(operationalAlertDeliveryAttempts.deliveryId, deliveryId)
        )
      )
      .get();
    const id = nanoid();
    await db
      .insert(operationalAlertDeliveryAttempts)
      .values({
        id,
        tenantId,
        deliveryId,
        attemptNumber: Number(previous?.value ?? 0) + 1,
        outcome: 'attempting',
        responseStatus: null,
        errorCode: null,
        startedAt: now().toISOString(),
        completedAt: null,
      })
      .run();
    return { id, responseStatus: null, errorCode: null };
  }

  async function processDelivery(
    rowId: string,
    tenantId: string,
    payload: OperationalAlertDeliveryPayload,
    signal: AbortSignal
  ): Promise<{
    result: { ok: true } | { ok: false; error: NormalizedOutboxError };
    attempt: AttemptEvidence;
  }> {
    const attempt = await beginAttempt(tenantId, rowId);
    const delivery = await db
      .select({
        id: operationalAlertDeliveries.id,
        transition: operationalAlertDeliveries.transition,
        subscriptionId: operationalAlertDeliveries.subscriptionId,
        subscriptionTenantId: webhookSubscriptions.tenantId,
        destinationUrl: webhookSubscriptions.destinationUrl,
        eventTypes: webhookSubscriptions.eventTypes,
        sealedSecret: webhookSubscriptions.sealedSecret,
        enabled: webhookSubscriptions.enabled,
        revokedAt: webhookSubscriptions.revokedAt,
      })
      .from(operationalAlertDeliveries)
      .innerJoin(
        webhookSubscriptions,
        and(
          eq(webhookSubscriptions.id, operationalAlertDeliveries.subscriptionId),
          eq(webhookSubscriptions.tenantId, operationalAlertDeliveries.tenantId)
        )
      )
      .where(
        and(
          eq(operationalAlertDeliveries.id, rowId),
          eq(operationalAlertDeliveries.tenantId, tenantId)
        )
      )
      .get();
    if (!delivery) {
      attempt.errorCode = 'OPERATIONAL_ALERT_DELIVERY_MISSING';
      return { result: failure(attempt.errorCode, false), attempt };
    }

    const eventType = `operational_alert.${delivery.transition}`;
    if (
      delivery.subscriptionTenantId !== tenantId ||
      !delivery.enabled ||
      delivery.revokedAt ||
      !delivery.eventTypes.includes(eventType)
    ) {
      attempt.errorCode = 'OPERATIONAL_ALERT_CHANNEL_INACTIVE';
      return { result: failure(attempt.errorCode, false), attempt };
    }
    if (!delivery.sealedSecret) {
      attempt.errorCode = 'OPERATIONAL_ALERT_CREDENTIAL_MISSING';
      return { result: failure(attempt.errorCode, false), attempt };
    }

    try {
      const destination = await resolvePublicWebhookDestination(delivery.destinationUrl, resolver);
      const timestamp = now().toISOString();
      const body = JSON.stringify({
        id: rowId,
        type: eventType,
        version: 1,
        occurredAt: payload.occurredAt,
        data: payload,
      });
      const signature = signWebhookPayload(
        openWebhookSecret(delivery.sealedSecret),
        timestamp,
        body
      );
      const response = await transport({
        url: destination.url,
        pinnedAddress: destination.addresses[0]!,
        timeoutMs: 10_000,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Puntovivo-Operational-Alerts/1.0',
          'idempotency-key': rowId,
          'x-puntovivo-alert-id': payload.alertId,
          'x-puntovivo-event-id': rowId,
          'x-puntovivo-event-type': eventType,
          'x-puntovivo-timestamp': timestamp,
          'x-puntovivo-signature': signature,
        },
        body,
        signal,
      });
      attempt.responseStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        return { result: { ok: true }, attempt };
      }
      const recoverable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      attempt.errorCode = `OPERATIONAL_ALERT_HTTP_${response.status}`;
      return { result: failure(attempt.errorCode, recoverable), attempt };
    } catch (error) {
      const code = normalizeErrorCode(error);
      attempt.errorCode = code;
      const permanent =
        code.includes('PRIVATE') ||
        code.includes('HTTPS_REQUIRED') ||
        code.includes('INVALID') ||
        code.includes('REVOKED') ||
        code.includes('CREDENTIAL');
      return { result: failure(code, !permanent), attempt };
    }
  }

  async function tickOnceRaw(tenantId: string, signal: AbortSignal) {
    if (stopped) return { processed: false as const, reason: 'idle' as const };
    await reclaimStaleClaims(tenantId);
    let attempt: AttemptEvidence | null = null;
    const result = await tickOutbox(db, tenantId, {
      kernel: alertKernel,
      workerId,
      loggerLabel: 'operational-alert-worker',
      process: async ({ row }) => {
        const processed = await processDelivery(row.id, tenantId, row.payload, signal);
        attempt = processed.attempt;
        return processed.result;
      },
    });
    if (!result.processed || !attempt) return result;

    const completedAt = now().toISOString();
    db.transaction(tx => {
      tx.update(operationalAlertDeliveryAttempts)
        .set({
          outcome: result.outcome === 'completed' ? 'delivered' : result.outcome,
          responseStatus: attempt!.responseStatus,
          errorCode: attempt!.errorCode,
          completedAt,
        })
        .where(
          and(
            eq(operationalAlertDeliveryAttempts.id, attempt!.id),
            eq(operationalAlertDeliveryAttempts.tenantId, tenantId)
          )
        )
        .run();
      tx.update(operationalAlertDeliveries)
        .set({
          attempts:
            result.outcome === 'completed'
              ? sql`${operationalAlertDeliveries.attempts} + 1`
              : undefined,
          responseStatus: attempt!.responseStatus,
          deliveredAt: result.outcome === 'completed' ? completedAt : null,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(operationalAlertDeliveries.id, result.rowId),
            eq(operationalAlertDeliveries.tenantId, tenantId)
          )
        )
        .run();
    });
    return result;
  }

  function tickOnce(tenantId: string): ReturnType<OperationalAlertWorker['tickOnce']> {
    return (
      activity.tryRun(signal => tickOnceRaw(tenantId, signal)) ??
      Promise.resolve({ processed: false as const, reason: 'idle' as const })
    );
  }

  async function tickAll(): Promise<void> {
    if (active) return active;
    const run = activity.tryRun(async signal => {
      if (stopped) return;
      const tickNow = now();
      const shouldPruneEvidence =
        tickNow.getTime() - lastEvidencePruneAt >= EVIDENCE_PRUNE_INTERVAL_MS;
      const tenantRows = await db.select({ id: tenants.id }).from(tenants).all();
      for (const tenant of tenantRows) {
        if (stopped) return;
        await reconcileOperationalAlerts(db, tenant.id, tickNow);
        if (shouldPruneEvidence) pruneOperationalAlertEvidence(db, tenant.id, tickNow);
      }
      if (shouldPruneEvidence) lastEvidencePruneAt = tickNow.getTime();
      const queuedTenants = await db
        .selectDistinct({ tenantId: operationalAlertDeliveries.tenantId })
        .from(operationalAlertDeliveries)
        .where(
          or(
            eq(operationalAlertDeliveries.status, 'queued'),
            eq(operationalAlertDeliveries.status, 'retrying')
          )
        )
        .all();
      for (const tenant of queuedTenants) {
        if (stopped) return;
        for (let index = 0; index < 25; index += 1) {
          const result = await tickOnceRaw(tenant.tenantId, signal);
          if (!result.processed) break;
        }
      }
    });
    if (!run) return;
    active = run;
    void run.then(
      () => {
        active = null;
      },
      () => {
        active = null;
      }
    );
    return active;
  }

  return {
    start() {
      if (timer) return;
      activity.reopen();
      stopped = false;
      void tickAll().catch(error =>
        log.warn({ error: normalizeErrorCode(error) }, 'operational alert tick failed')
      );
      timer = setInterval(() => {
        void tickAll().catch(error =>
          log.warn({ error: normalizeErrorCode(error) }, 'operational alert tick failed')
        );
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      await activity.stop();
    },
    tickOnce,
    tickAll,
  };
}

function failure(errorCode: string, recoverable: boolean) {
  return {
    ok: false as const,
    error: { errorCode, providerMessage: errorCode, recoverable, details: null },
  };
}

function normalizeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const known = raw.match(/(?:OPERATIONAL_ALERT|WEBHOOK)_[A-Z0-9_]+/)?.[0];
  return known ?? 'OPERATIONAL_ALERT_DELIVERY_FAILED';
}
