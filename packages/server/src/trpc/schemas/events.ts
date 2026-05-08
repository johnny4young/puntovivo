/**
 * ENG-070 — Schemas for the `events.*` admin router.
 *
 * @module trpc/schemas/events
 */

import { z } from 'zod';

/**
 * Input for `events.peekOutbox`. Same shape as `sync.peekOutbox`
 * (ENG-064) — a single optional `limit` clamped to a sane window.
 */
export const peekWebhookOutboxInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
});
export type PeekWebhookOutboxInput = z.infer<typeof peekWebhookOutboxInput>;
