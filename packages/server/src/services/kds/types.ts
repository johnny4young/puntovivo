/**
 * shared types for the KDS hook helpers.
 *
 * Helpers run as POST-tx best-effort hooks from a handful of sale
 * lifecycle entry points (`sales.suspend`, `sales.changeTable`,
 * `sales.splitDraft`, `completeSale`, `discardDraft`, `voidSale`).
 * They share a structural context shape so the same call site works
 * from both a tRPC procedure (which carries `ctx.req.server.sse`)
 * and an application-service caller (which only carries what its
 * own context interface exposes).
 *
 * The SSE manager is OPTIONAL — when omitted (unit tests, callers
 * outside the HTTP boundary), the helpers do the DB work and skip
 * the broadcast silently. The board still picks up the change on
 * the next `kds.list` refetch.
 *
 * @module services/kds/types
 */

import type { DatabaseInstance } from '../../db/index.js';
import type { PuntovivoLogger } from '../../logging/logger.js';

export interface KdsSseBroadcaster {
  broadcast(eventName: string, data: unknown, tenantId: string): void;
}

export type KdsHookLogger = Pick<PuntovivoLogger, 'warn' | 'info' | 'debug' | 'error'>;

export interface KdsHookContext {
  db: DatabaseInstance;
  tenantId: string;
  /**
   * When present the SSE event names target the originating site so
   * a multi-site tenant does not flash cards on the wrong kitchen.
   * `list` always re-scopes by `ctx.siteId` so the data is safe even
   * when the broadcast crosses sites; this is purely an optimisation.
   */
  // explicit `| undefined` on optional fields satisfies
  // `exactOptionalPropertyTypes`: callers can pass either `field:
  // undefined` (often the case when destructuring a parent context
  // that may not carry the field) or omit the key entirely.
  siteId?: string | null | undefined;
  user?: { id: string } | null | undefined;
  sse?: KdsSseBroadcaster | null | undefined;
  log?: KdsHookLogger | undefined;
}

/**
 * Item snapshot stored as the `items_json` blob. Shape is intentionally
 * minimal — the cook only needs name + quantity + (when present) the
 * inherited sale-level note rendered once at the bottom of the card.
 */
export interface KdsItemSnapshot {
  saleItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  /**
   * per-line modifier ("sin cebolla", "extra queso").
   * Null when no modifier was captured. Optional in the type so
   * snapshots persisted before this field shipped still parse on
   * the board (the renderer treats `notes ?? null` uniformly).
   */
  notes?: string | null;
}

export interface KdsBroadcastPayload {
  type:
    | 'kds.order.created'
    | 'kds.order.updated'
    | 'kds.order.removed'
    | 'kds.order.ready'
    | 'kds.order.recalled';
  saleId: string;
  siteId: string | null;
  station?: string;
}
