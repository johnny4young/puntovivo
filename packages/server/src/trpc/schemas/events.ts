/**
 * Schemas for the `events.*` admin router.
 *
 * @module trpc/schemas/events
 */

import { z } from 'zod';
import { PUBLIC_EVENT_TYPES } from '../../services/events/manifest.js';

/**
 * Input for `events.peekOutbox`. Same shape as `sync.peekOutbox`
 * () — a single optional `limit` clamped to a sane window.
 */
export const peekWebhookOutboxInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
});
export type PeekWebhookOutboxInput = z.infer<typeof peekWebhookOutboxInput>;

export const createWebhookSubscriptionInput = z.object({
  name: z.string().trim().min(1).max(80),
  destinationUrl: z.string().trim().url().max(2048),
  eventTypes: z.array(z.enum(PUBLIC_EVENT_TYPES)).min(1).max(PUBLIC_EVENT_TYPES.length),
});

export const webhookSubscriptionIdInput = z.object({ id: z.string().min(1).max(64) });
export const retryWebhookDeliveryInput = z.object({ outboxId: z.string().min(1).max(64) });
export const listWebhookDeliveriesInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().nonnegative().max(10_000).default(0),
});
