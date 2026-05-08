/**
 * ENG-070 — `events.*` tRPC namespace.
 *
 * Read-only surface for the public events kernel:
 *
 *   - `events.getContract` (managerOrAdmin) — returns the manifest
 *     + per-event field metadata so an integrator (or a future admin
 *     tab) can discover the public payload shapes without reading
 *     server source.
 *   - `events.peekOutbox` (managerOrAdmin) — paginated tail of
 *     `webhook_outbox` ordered by `(priority DESC, createdAt ASC)`
 *     for forensics. Mirrors `sync.peekOutbox` (ENG-064) +
 *     `peripherals.peekHardwareOutbox` (ENG-062).
 *
 * No writes. ENG-070b adds the HTTP delivery worker that drains the
 * outbox; the subscriber URL config UI gets a separate admin tab.
 *
 * @module trpc/routers/events
 */

import { desc, eq } from 'drizzle-orm';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { webhookOutbox } from '../../db/schema.js';
import { buildPublicEventContract } from '../../services/events/manifest.js';
import { peekWebhookOutboxInput } from '../schemas/events.js';

export const eventsRouter = router({
  /**
   * Public event contract — version + event types + per-event field
   * metadata. Integrators read this to know what to subscribe to.
   * Pure manifest read; no DB.
   */
  getContract: managerOrAdminProcedure.query(() => {
    return buildPublicEventContract();
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

export type EventsRouter = typeof eventsRouter;
