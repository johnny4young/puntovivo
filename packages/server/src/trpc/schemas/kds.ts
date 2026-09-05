/**
 * Bounded kitchen reads and observed-generation preparation transitions.
 * Mutations address ticket/line identities, never mutable sale destinations.
 * @module trpc/schemas/kds
 */

import { z } from 'zod';

export const listKdsOrdersInput = z.object({
  /**
   * When omitted, the router falls back to `ctx.siteId` so the
   * board always renders the active site's queue. The board supplies its
   * selected site explicitly; the router validates tenant ownership.
   */
  siteId: z.string().min(1).max(128).optional(),
  station: z.string().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
/** Site/station filters and a bounded ticket page. */
export type ListKdsOrdersInput = z.infer<typeof listKdsOrdersInput>;

export const markKdsOrderReadyInput = z.object({
  id: z.string().min(1).max(128),
  expectedVersion: z.number().int().positive(),
});
/** Whole-ticket ready transition guarded by its displayed generation. */
export type MarkKdsOrderReadyInput = z.infer<typeof markKdsOrderReadyInput>;

export const recallKdsOrderInput = z.object({
  id: z.string().min(1).max(128),
  expectedVersion: z.number().int().positive(),
});
/** Whole-ticket recall guarded against stale or repeated actions. */
export type RecallKdsOrderInput = z.infer<typeof recallKdsOrderInput>;

/** A single observed line generation; the header is resolved under the writer. */
export const transitionKdsLineInput = z.object({
  orderId: z.string().min(1).max(128),
  lineId: z.string().min(1).max(128),
  expectedVersion: z.number().int().positive(),
  status: z.enum(['pending', 'preparing', 'ready']),
});
