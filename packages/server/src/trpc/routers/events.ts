/**
 * `events.*` tRPC namespace.
 *
 * Read-only surface for the public events kernel:
 *
 * - `events.getContract` (managerOrAdmin) — returns the manifest
 * + per-event field metadata so an integrator (or a future admin
 * tab) can discover the public payload shapes without reading
 * server source.
 * - `events.peekOutbox` (managerOrAdmin) — paginated tail of
 * `webhook_outbox` ordered by `(priority DESC, createdAt ASC)`
 * for forensics. Mirrors `sync.peekOutbox` () +
 * `peripherals.peekHardwareOutbox` ().
 *
 * No writes.  adds the HTTP delivery worker that drains the
 * outbox; the subscriber URL config UI gets a separate admin tab.
 *
 * @module trpc/routers/events
 */

import { TRPCError } from '@trpc/server';
import { and, desc, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { webhookDeliveries, webhookOutbox, webhookSubscriptions } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { assertPublicWebhookDestination } from '../../services/events/destination-policy.js';
import { buildPublicEventContract } from '../../services/events/manifest.js';
import {
  createWebhookSigningSecret,
  hasWebhookSecretKey,
  sealWebhookSecret,
} from '../../services/events/secret-box.js';
import {
  backfillOperationalAlertsForSubscription,
  isOperationalAlertEventType,
} from '../../services/operations/alerts.js';
import {
  createWebhookSubscriptionInput,
  listWebhookDeliveriesInput,
  peekWebhookOutboxInput,
  retryWebhookDeliveryInput,
  webhookSubscriptionIdInput,
} from '../schemas/events.js';

export const eventsRouter = router({
  /**
   * Public event contract — version + event types + per-event field
   * metadata. Integrators read this to know what to subscribe to.
   * Pure manifest read; no DB.
   */
  getContract: managerOrAdminProcedure.query(() => {
    return buildPublicEventContract();
  }),

  listSubscriptions: managerOrAdminProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: webhookSubscriptions.id,
        name: webhookSubscriptions.name,
        destinationUrl: webhookSubscriptions.destinationUrl,
        eventTypes: webhookSubscriptions.eventTypes,
        enabled: webhookSubscriptions.enabled,
        revokedAt: webhookSubscriptions.revokedAt,
        createdAt: webhookSubscriptions.createdAt,
        updatedAt: webhookSubscriptions.updatedAt,
      })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.tenantId, ctx.tenantId))
      .orderBy(desc(webhookSubscriptions.createdAt))
      .all()
  ),

  createSubscription: adminProcedure
    .input(createWebhookSubscriptionInput)
    .mutation(async ({ ctx, input }) => {
      if (!hasWebhookSecretKey()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Webhook secret custody requires a configured database encryption key',
        });
      }
      let destination: URL;
      try {
        destination = await assertPublicWebhookDestination(input.destinationUrl);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'WEBHOOK_DESTINATION_INVALID',
        });
      }
      const id = nanoid();
      const now = new Date().toISOString();
      const signingSecret = createWebhookSigningSecret();
      try {
        ctx.db.transaction(tx => {
          tx.insert(webhookSubscriptions)
            .values({
              id,
              tenantId: ctx.tenantId,
              name: input.name,
              destinationUrl: destination.toString(),
              eventTypes: [...new Set(input.eventTypes)],
              sealedSecret: sealWebhookSecret(signingSecret),
              enabled: true,
              revokedAt: null,
              createdByUserId: ctx.user!.id,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId: ctx.user!.id,
            action: 'webhook_subscription.create',
            resourceType: 'webhook_subscription',
            resourceId: id,
            after: {
              name: input.name,
              destinationUrl: destination.toString(),
              eventTypes: input.eventTypes,
            },
          });
          if (input.eventTypes.some(isOperationalAlertEventType)) {
            backfillOperationalAlertsForSubscription(tx, {
              tenantId: ctx.tenantId,
              subscriptionId: id,
              eventTypes: input.eventTypes,
              now: new Date(now),
            });
          }
        });
      } catch (error) {
        if (isActiveDestinationConflict(error)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'An active webhook subscription already uses this destination',
          });
        }
        throw error;
      }
      return { id, signingSecret, createdAt: now };
    }),

  disableSubscription: adminProcedure
    .input(webhookSubscriptionIdInput)
    .mutation(({ ctx, input }) => mutateSubscriptionState(ctx, input.id, false)),

  revokeSubscription: adminProcedure
    .input(webhookSubscriptionIdInput)
    .mutation(({ ctx, input }) => revokeSubscription(ctx, input.id)),

  listDeliveries: managerOrAdminProcedure
    .input(listWebhookDeliveriesInput)
    .query(({ ctx, input }) =>
      ctx.db
        .select({
          id: webhookDeliveries.id,
          outboxId: webhookDeliveries.outboxId,
          subscriptionId: webhookDeliveries.subscriptionId,
          subscriptionName: webhookSubscriptions.name,
          destinationUrl: webhookSubscriptions.destinationUrl,
          eventType: webhookOutbox.eventType,
          status: webhookDeliveries.status,
          attempts: webhookDeliveries.attempts,
          responseStatus: webhookDeliveries.responseStatus,
          lastErrorCode: webhookDeliveries.lastErrorCode,
          lastAttemptAt: webhookDeliveries.lastAttemptAt,
          deliveredAt: webhookDeliveries.deliveredAt,
          updatedAt: webhookDeliveries.updatedAt,
        })
        .from(webhookDeliveries)
        .innerJoin(
          webhookSubscriptions,
          and(
            eq(webhookSubscriptions.id, webhookDeliveries.subscriptionId),
            eq(webhookSubscriptions.tenantId, webhookDeliveries.tenantId)
          )
        )
        .innerJoin(
          webhookOutbox,
          and(
            eq(webhookOutbox.id, webhookDeliveries.outboxId),
            eq(webhookOutbox.tenantId, webhookDeliveries.tenantId)
          )
        )
        .where(eq(webhookDeliveries.tenantId, ctx.tenantId))
        .orderBy(desc(webhookDeliveries.updatedAt))
        .limit(input.limit)
        .offset(input.offset)
        .all()
    ),

  retryDelivery: adminProcedure.input(retryWebhookDeliveryInput).mutation(({ ctx, input }) => {
    const row = ctx.db
      .select({ id: webhookOutbox.id, status: webhookOutbox.status })
      .from(webhookOutbox)
      .where(and(eq(webhookOutbox.id, input.outboxId), eq(webhookOutbox.tenantId, ctx.tenantId)))
      .get();
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook event not found' });
    if (row.status !== 'dead_letter') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Only a dead-letter webhook event can be retried manually',
      });
    }
    const now = new Date().toISOString();
    ctx.db.transaction(tx => {
      tx.update(webhookOutbox)
        .set({
          status: 'queued',
          attempts: 0,
          nextRetryAt: null,
          lastError: null,
          claimToken: null,
          lockedAt: null,
          updatedAt: now,
        })
        .where(and(eq(webhookOutbox.id, row.id), eq(webhookOutbox.tenantId, ctx.tenantId)))
        .run();
      tx.update(webhookDeliveries)
        .set({ status: 'pending', responseStatus: null, lastErrorCode: null, updatedAt: now })
        .where(
          and(
            eq(webhookDeliveries.outboxId, row.id),
            eq(webhookDeliveries.tenantId, ctx.tenantId),
            ne(webhookDeliveries.status, 'delivered')
          )
        )
        .run();
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'webhook_delivery.retry',
        resourceType: 'webhook_outbox',
        resourceId: row.id,
        before: { status: row.status },
        after: { status: 'queued' },
      });
    });
    return { id: row.id, status: 'queued' as const };
  }),

  /**
   * Tail of `webhook_outbox` for the active tenant. Operations
   * Center will surface this when the events-as-modules toggle is
   * on. Single indexed read on `(tenant_id, status, next_retry_at)`
   * + secondary order by `priority DESC, createdAt ASC` so the
   * caller sees the highest-priority queued rows first.
   */
  peekOutbox: managerOrAdminProcedure
    .input(peekWebhookOutboxInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: webhookOutbox.id,
          status: webhookOutbox.status,
          eventType: webhookOutbox.eventType,
          eventVersion: webhookOutbox.eventVersion,
          operationEventId: webhookOutbox.operationEventId,
          payloadVersion: webhookOutbox.payloadVersion,
          attempts: webhookOutbox.attempts,
          nextRetryAt: webhookOutbox.nextRetryAt,
          lastError: webhookOutbox.lastError,
          priority: webhookOutbox.priority,
          idempotencyKey: webhookOutbox.idempotencyKey,
          createdAt: webhookOutbox.createdAt,
          updatedAt: webhookOutbox.updatedAt,
        })
        .from(webhookOutbox)
        .where(eq(webhookOutbox.tenantId, ctx.tenantId))
        .orderBy(desc(webhookOutbox.priority), webhookOutbox.createdAt)
        .limit(input.limit)
        .all();
      return rows;
    }),
});

type EventContext = {
  db: Parameters<typeof writeAuditLog>[0]['tx'];
  tenantId: string;
  user: { id: string } | null;
};

function mutateSubscriptionState(ctx: EventContext, id: string, enabled: boolean) {
  const row = ctx.db
    .select()
    .from(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.tenantId, ctx.tenantId)))
    .get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook subscription not found' });
  if (row.revokedAt)
    throw new TRPCError({ code: 'CONFLICT', message: 'Webhook subscription is revoked' });
  const now = new Date().toISOString();
  ctx.db.transaction(tx => {
    tx.update(webhookSubscriptions)
      .set({ enabled, updatedAt: now })
      .where(and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.tenantId, ctx.tenantId)))
      .run();
    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user!.id,
      action: 'webhook_subscription.disable',
      resourceType: 'webhook_subscription',
      resourceId: id,
      before: { enabled: row.enabled },
      after: { enabled },
    });
  });
  return { id, enabled, updatedAt: now };
}

function revokeSubscription(ctx: EventContext, id: string) {
  const row = ctx.db
    .select()
    .from(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.tenantId, ctx.tenantId)))
    .get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook subscription not found' });
  if (row.revokedAt) return { id, revokedAt: row.revokedAt };
  const now = new Date().toISOString();
  ctx.db.transaction(tx => {
    tx.update(webhookSubscriptions)
      .set({ enabled: false, sealedSecret: null, revokedAt: now, updatedAt: now })
      .where(and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.tenantId, ctx.tenantId)))
      .run();
    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user!.id,
      action: 'webhook_subscription.revoke',
      resourceType: 'webhook_subscription',
      resourceId: id,
      before: { enabled: row.enabled, revokedAt: row.revokedAt },
      after: { enabled: false, revokedAt: now },
    });
  });
  return { id, revokedAt: now };
}

function isActiveDestinationConflict(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  return (
    (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT') &&
    /webhook_subscriptions.*(?:tenant_id.*destination_url|destination_url.*tenant_id)/i.test(
      message
    )
  );
}

export type EventsRouter = typeof eventsRouter;
