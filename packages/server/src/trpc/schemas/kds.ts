/**
 * ENG-098 — input schemas for the `kds.*` router.
 *
 * Surface is intentionally tiny: a read for the board, a transition
 * to "Listo", and a recall affordance for the cook who misclicked.
 * Every mutation keys on the `kds_orders.id` (NOT the saleId) so a
 * future per-station split keeps the same call shape.
 *
 * @module trpc/schemas/kds
 */

import { z } from 'zod';

export const listKdsOrdersInput = z.object({
  /**
   * When omitted, the router falls back to `ctx.siteId` so the
   * board always renders the active site's queue. Operators with
   * cross-site visibility (admin viewing another store) can pass
   * an explicit site id once we expose the picker; v1 keeps it
   * implicit so the kitchen TV does not need to negotiate state.
   */
  siteId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export type ListKdsOrdersInput = z.infer<typeof listKdsOrdersInput>;

export const markKdsOrderReadyInput = z.object({
  id: z.string().min(1),
});
export type MarkKdsOrderReadyInput = z.infer<typeof markKdsOrderReadyInput>;

export const recallKdsOrderInput = z.object({
  id: z.string().min(1),
});
export type RecallKdsOrderInput = z.infer<typeof recallKdsOrderInput>;
