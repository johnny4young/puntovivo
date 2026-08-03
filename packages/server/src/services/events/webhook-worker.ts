import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  webhookDeliveries,
  webhookOutbox,
  webhookSubscriptions,
  type WebhookOutboxStatus,
} from '../../db/schema.js';
import { createOutboxKernel } from '../../lib/outbox/kernel.js';
import { recordFailure, recordSuccess } from '../../lib/outbox/metadata.js';
import { tickOutbox } from '../../lib/outbox/worker.js';
import type { NormalizedOutboxError, OutboxRetryPolicy } from '../../lib/outbox/types.js';
import { createModuleLogger } from '../../logging/logger.js';
import { resolvePublicWebhookDestination, type WebhookAddressResolver } from './destination-policy.js';
import { postPinnedWebhook, type WebhookTransport } from './webhook-http.js';
import { openWebhookSecret, signWebhookPayload } from './secret-box.js';

const WEBHOOK_RETRY_POLICY: OutboxRetryPolicy = {
  maxAttempts: 6,
  nextDelayMs(attempts) {
    return [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000][attempts] ?? null;
  },
};

const webhookKernel = createOutboxKernel<WebhookOutboxStatus, Record<string, unknown>>({
  table: webhookOutbox,
  kind: 'webhook',
  initialStatus: 'queued',
  processingStatus: 'submitting',
  succeededStatus: 'delivered',
  retryingStatus: 'retrying',
  deadLetterStatus: 'dead_letter',
  terminalStatuses: ['delivered', 'dead_letter'],
  retryPolicy: WEBHOOK_RETRY_POLICY,
});

export interface WebhookWorker {
  start(): void;
  stop(): Promise<void>;
  tickOnce(tenantId: string): Promise<Awaited<ReturnType<typeof tickOutbox>>>;
  tickAll(): Promise<void>;
}

export interface CreateWebhookWorkerOptions {
  db: DatabaseInstance;
  transport?: WebhookTransport;
  resolver?: WebhookAddressResolver;
  intervalMs?: number;
}

export function createWebhookWorker(options: CreateWebhookWorkerOptions): WebhookWorker {
  const { db, transport = postPinnedWebhook, resolver, intervalMs = 15_000 } = options;
  const workerId = `webhook:${process.pid}`;
  const log = createModuleLogger('services/events/webhook-worker');
  let timer: NodeJS.Timeout | null = null;
  let active: Promise<void> | null = null;

  async function processRow(rowId: string): Promise<{ ok: true } | { ok: false; error: NormalizedOutboxError }> {
    const event = await db.select().from(webhookOutbox).where(eq(webhookOutbox.id, rowId)).get();
    if (!event) {
      return failure('WEBHOOK_EVENT_MISSING', false);
    }
    const subscriptions = await db
      .select()
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.tenantId, event.tenantId),
          eq(webhookSubscriptions.enabled, true),
          isNull(webhookSubscriptions.revokedAt)
        )
      )
      .all();
    const targets = subscriptions.filter(subscription => subscription.eventTypes.includes(event.eventType));
    let recoverableFailure: string | null = null;
    let permanentFailure: string | null = null;
    for (const subscription of targets) {
      const prior = await db
        .select()
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.outboxId, event.id),
            eq(webhookDeliveries.subscriptionId, subscription.id),
            eq(webhookDeliveries.tenantId, event.tenantId)
          )
        )
        .get();
      if (prior?.status === 'delivered') continue;
      if (prior?.status === 'dead_letter') {
        permanentFailure ??= prior.lastErrorCode ?? 'WEBHOOK_DELIVERY_FAILED';
        continue;
      }

      const now = new Date().toISOString();
      try {
        const destination = await resolvePublicWebhookDestination(subscription.destinationUrl, resolver);
        if (!subscription.sealedSecret) throw new Error('WEBHOOK_SECRET_REVOKED');
        const secret = openWebhookSecret(subscription.sealedSecret);
        const body = JSON.stringify({
          id: event.id,
          type: event.eventType,
          version: event.eventVersion,
          occurredAt: event.createdAt,
          data: event.payload,
        });
        const signature = signWebhookPayload(secret, now, body);
        const response = await transport({
          url: destination.url,
          pinnedAddress: destination.addresses[0]!,
          timeoutMs: 10_000,
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Puntovivo-Webhooks/1.0',
            'idempotency-key': `${event.id}:${subscription.id}`,
            'x-puntovivo-event-id': event.id,
            'x-puntovivo-event-type': event.eventType,
            'x-puntovivo-timestamp': now,
            'x-puntovivo-signature': signature,
          },
          body,
        });
        const responseOk = response.status >= 200 && response.status < 300;
        if (!responseOk) {
          const recoverable = response.status === 408 || response.status === 429 || response.status >= 500;
          await upsertDelivery(db, event.tenantId, event.id, subscription.id, {
            status: recoverable ? 'retrying' : 'dead_letter',
            responseStatus: response.status,
            errorCode: `WEBHOOK_HTTP_${response.status}`,
            now,
          });
          if (recoverable) recoverableFailure ??= `WEBHOOK_HTTP_${response.status}`;
          else permanentFailure ??= `WEBHOOK_HTTP_${response.status}`;
          continue;
        }
        await upsertDelivery(db, event.tenantId, event.id, subscription.id, {
          status: 'delivered',
          responseStatus: response.status,
          errorCode: null,
          now,
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'WEBHOOK_DELIVERY_FAILED';
        const permanent = code.includes('PRIVATE') || code.includes('HTTPS_REQUIRED') || code.includes('INVALID') || code.includes('REVOKED');
        await upsertDelivery(db, event.tenantId, event.id, subscription.id, {
          status: permanent ? 'dead_letter' : 'retrying',
          responseStatus: null,
          errorCode: normalizeErrorCode(code),
          now,
        });
        if (permanent) permanentFailure ??= normalizeErrorCode(code);
        else recoverableFailure ??= normalizeErrorCode(code);
      }
    }
    // Always attempt every destination. A failing subscriber must not prevent
    // independent subscribers from receiving the same immutable event.
    if (recoverableFailure) return failure(recoverableFailure, true);
    if (permanentFailure) return failure(permanentFailure, false);
    return { ok: true };
  }

  async function tickOnce(tenantId: string) {
    const result = await tickOutbox(db, tenantId, {
      kernel: webhookKernel,
      workerId,
      loggerLabel: 'webhook-worker',
      process: ({ row }) => processRow(row.id),
    });
    if (result.processed) {
      if (result.outcome === 'completed') await recordSuccess(db, { tenantId, outboxKind: 'webhook' });
      if (result.outcome === 'dead_letter') await recordFailure(db, { tenantId, outboxKind: 'webhook' });
    }
    return result;
  }

  async function tickAll(): Promise<void> {
    if (active) return active;
    active = (async () => {
      const rows = await db
        .selectDistinct({ tenantId: webhookOutbox.tenantId })
        .from(webhookOutbox)
        .where(or(eq(webhookOutbox.status, 'queued'), eq(webhookOutbox.status, 'retrying')))
        .all();
      for (const row of rows) await tickOnce(row.tenantId);
    })().finally(() => {
      active = null;
    });
    return active;
  }

  return {
    start() {
      if (timer) return;
      void tickAll().catch(error => log.warn({ error: normalizeErrorCode(String(error)) }, 'webhook tick failed'));
      timer = setInterval(() => {
        void tickAll().catch(error => log.warn({ error: normalizeErrorCode(String(error)) }, 'webhook tick failed'));
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await active;
    },
    tickOnce,
    tickAll,
  };
}

function failure(errorCode: string, recoverable: boolean): { ok: false; error: NormalizedOutboxError } {
  return {
    ok: false,
    error: { errorCode, providerMessage: errorCode, recoverable, details: null },
  };
}

function normalizeErrorCode(value: string): string {
  const known = value.match(/WEBHOOK_[A-Z0-9_]+/)?.[0];
  return known ?? 'WEBHOOK_DELIVERY_FAILED';
}

async function upsertDelivery(
  db: DatabaseInstance,
  tenantId: string,
  outboxId: string,
  subscriptionId: string,
  result: {
    status: 'delivered' | 'retrying' | 'dead_letter';
    responseStatus: number | null;
    errorCode: string | null;
    now: string;
  }
): Promise<void> {
  await db
    .insert(webhookDeliveries)
    .values({
      id: nanoid(),
      tenantId,
      outboxId,
      subscriptionId,
      status: result.status,
      attempts: 1,
      responseStatus: result.responseStatus,
      lastErrorCode: result.errorCode,
      lastAttemptAt: result.now,
      deliveredAt: result.status === 'delivered' ? result.now : null,
      createdAt: result.now,
      updatedAt: result.now,
    })
    .onConflictDoUpdate({
      target: [webhookDeliveries.outboxId, webhookDeliveries.subscriptionId],
      set: {
        status: result.status,
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        responseStatus: result.responseStatus,
        lastErrorCode: result.errorCode,
        lastAttemptAt: result.now,
        deliveredAt: result.status === 'delivered' ? result.now : null,
        updatedAt: result.now,
      },
    })
    .run();
}
