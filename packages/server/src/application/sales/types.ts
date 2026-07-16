/**
 * ENG-054 — Public types for the `completeSale` application service.
 *
 * Two responsibilities:
 *
 * 1. `CompleteSaleInput` — discriminated union that covers both the
 *    fresh-sale path (formerly `sales.create`) and the draft-completion
 *    path (formerly `sales.completeDraft`). The router narrows tRPC
 *    input into this shape; tests construct it directly.
 * 2. `CompleteSaleContext` — minimal subset of the tRPC `Context` that
 *    the use-case actually reads. Tests pass a hand-built object;
 *    procedures pass `ctx` (the field shape is compatible with
 *    `tRPC Context + envelope`).
 *
 * @module application/sales/types
 */

import type { DatabaseInstance } from '../../db/index.js';
import type { PuntovivoLogger } from '../../logging/logger.js';
import type { CheckoutApprovalAction } from '@puntovivo/shared/checkout-approval';
import type { UserRole } from '@puntovivo/shared/roles';

/**
 * Minimal structural log shape accepted by the use-case. Both
 * `PuntovivoLogger` (pino) and Fastify's `FastifyBaseLogger` satisfy
 * it — both pick the same method signatures from `pino.BaseLogger`.
 * Keeping the boundary structural avoids friction at callsites that
 * pass `ctx.req.server.log` (typed as `FastifyBaseLogger`).
 */
export type CompleteSaleLogger = Pick<PuntovivoLogger, 'warn' | 'info' | 'debug' | 'error'>;

export type SalePaymentMethod = 'cash' | 'card' | 'transfer' | 'credit' | 'other';
export type SalePaymentStatus = 'pending' | 'paid' | 'partial' | 'refunded';
/**
 * Sale `status` accepted at creation time. Mirrors the Zod enum on
 * `sales.create` (which allows `cancelled` / `voided` for legacy
 * imports / synthetic test setup, even though the UI only ever
 * produces `draft` or `completed`).
 */
export type FreshSaleStatus = 'draft' | 'completed' | 'cancelled' | 'voided';

/**
 * One tender line captured at the front-end. Multi-tender carries an
 * array; single-tender drops the array and sets `paymentMethod` +
 * `amountReceived` instead.
 */
export interface CompleteSaleTender {
  method: SalePaymentMethod;
  amount: number;
  // ENG-179b — explicit `| undefined` on Zod-optional field.
  reference?: string | null | undefined;
}

export interface CompleteSaleApprovalReference {
  action: CheckoutApprovalAction;
  requestId: string;
}

/**
 * One product line in a fresh sale. Drafts already have line items in
 * the DB so the `fromDraft` path does NOT carry them.
 */
export interface CompleteSaleItemInput {
  productId: string;
  unitId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  // ENG-179b — explicit `| undefined` on Zod-optional fields.
  taxRate?: number | null | undefined;
  notes?: string | null | undefined;
  serialIds?: string[] | undefined;
}

/**
 * Discriminated union covering both the fresh-sale and draft-completion
 * paths. The two paths share most of the orchestration; the union keeps
 * the input type compact and lets the service narrow once at the entry
 * point.
 */
export type SaleTipMethod = 'percentage' | 'fixed';

// ENG-179b — explicit `| undefined` on every optional field across
// both union variants so Zod-decoded input shapes (which carry
// explicit-undefined for unset optionals) assign cleanly.
export type CompleteSaleInput =
  | {
      mode: 'fresh';
      customerId: string | null | undefined;
      items: CompleteSaleItemInput[];
      payments?: CompleteSaleTender[] | undefined;
      paymentMethod: SalePaymentMethod;
      amountReceived?: number | undefined;
      paymentStatus: SalePaymentStatus;
      discountAmount?: number | undefined;
      status: FreshSaleStatus;
      notes?: string | null | undefined;
      tipAmount?: number | undefined;
      tipMethod?: SaleTipMethod | null | undefined;
      serviceChargeAmount?: number | undefined;
      serviceChargeRate?: number | null | undefined;
      tableId?: string | null | undefined;
      creditOverride?: boolean | undefined;
      approvalRequests?: CompleteSaleApprovalReference[] | undefined;
      checkoutStartedAt?: string | undefined;
    }
  | {
      mode: 'fromDraft';
      saleId: string;
      payments?: CompleteSaleTender[] | undefined;
      paymentMethod: SalePaymentMethod;
      amountReceived?: number | undefined;
      paymentStatus: SalePaymentStatus;
      notes?: string | null | undefined;
      tipAmount?: number | undefined;
      tipMethod?: SaleTipMethod | null | undefined;
      serviceChargeAmount?: number | undefined;
      serviceChargeRate?: number | null | undefined;
      creditOverride?: boolean | undefined;
      approvalRequests?: CompleteSaleApprovalReference[] | undefined;
      checkoutStartedAt?: string | undefined;
    };

/**
 * Subset of the tRPC `Context` that the use-case actually reads.
 *
 * - `db` — the Drizzle handle. The procedure passes `ctx.db`; tests
 *   build their own in-memory DB and pass it through.
 * - `tenantId` / `siteId` / `user` — multi-tenant + auth scope. Never
 *   resolved inside the service.
 * - `envelope` — when the call comes from `criticalCommandProcedure`,
 *   this carries the `operationId` minted by the renderer. The
 *   service uses it to look up the corresponding `operation_events`
 *   row and emit `operation_effects` against it. When absent (test
 *   call without an envelope, future internal worker call) effects
 *   are skipped silently.
 * - `log` — request-scoped logger; falls back to a module logger if
 *   the caller did not provide one.
 */
export interface CompleteSaleContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  user: { id: string; role: UserRole };
  envelope?: { operationId: string } | null;
  deviceId?: string | null;
  log?: CompleteSaleLogger;
  /**
   * ENG-098 — optional SSE broadcaster used by the KDS post-tx hook
   * to notify the kitchen surface live. When omitted (unit tests,
   * internal callers without an HTTP boundary), the helper writes
   * the `kds_orders` row but skips the broadcast — the board picks
   * up the change on the next `kds.list` refetch.
   */
  sse?: {
    broadcast(eventName: string, data: unknown, tenantId: string): void;
  } | null;
}

/**
 * Resolved sale row + items + payments returned by the service. Shape
 * matches what `getSaleRecord(...)` already returned to callers, so the
 * tRPC procedures (and downstream renderer code) stay binary-compatible.
 *
 * The concrete type is the awaited return of `getSaleRecord`, declared
 * inline at the call boundary so we don't re-export Drizzle row shapes
 * from this module. The router's tRPC inference still resolves the
 * full structure (id, total, items[], payments[], etc.).
 */
export interface CompleteSaleResult<TSaleRecord = unknown> {
  /** Full sale record matching the legacy `getSaleRecord` shape. */
  sale: TSaleRecord;
  /** Cash overage when paid in cash; 0 otherwise. */
  change: number;
  /**
   * Journal `operation_events` row id when the call carried an
   * envelope; null otherwise. Tests assert on this to verify the
   * effects path ran (or was deliberately skipped).
   */
  journalEventId: string | null;
}
