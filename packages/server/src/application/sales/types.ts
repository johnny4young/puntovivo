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

/**
 * Minimal structural log shape accepted by the use-case. Both
 * `PuntovivoLogger` (pino) and Fastify's `FastifyBaseLogger` satisfy
 * it — both pick the same method signatures from `pino.BaseLogger`.
 * Keeping the boundary structural avoids friction at callsites that
 * pass `ctx.req.server.log` (typed as `FastifyBaseLogger`).
 */
export type CompleteSaleLogger = Pick<
  PuntovivoLogger,
  'warn' | 'info' | 'debug' | 'error'
>;

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
  reference?: string | null;
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
  taxRate?: number | null;
}

/**
 * Discriminated union covering both the fresh-sale and draft-completion
 * paths. The two paths share most of the orchestration; the union keeps
 * the input type compact and lets the service narrow once at the entry
 * point.
 */
export type SaleTipMethod = 'percentage' | 'fixed';

export type CompleteSaleInput =
  | {
      mode: 'fresh';
      customerId: string | null | undefined;
      items: CompleteSaleItemInput[];
      payments?: CompleteSaleTender[];
      paymentMethod: SalePaymentMethod;
      amountReceived?: number;
      paymentStatus: SalePaymentStatus;
      discountAmount?: number;
      status: FreshSaleStatus;
      notes?: string | null;
      /**
       * ENG-039d — restaurant tip / propina. Currency amount the
       * operator captured on top of the line totals; rolls into
       * `total` so payment validation stays unchanged. `tipMethod`
       * records how the UI picked it (percentage button vs custom
       * amount) for downstream reporting.
       */
      tipAmount?: number;
      tipMethod?: SaleTipMethod | null;
      /**
       * ENG-039d3 — restaurant service charge / propina sugerida. Auto
       * applied from `tenants.settings.restaurant.serviceChargeRate`;
       * the service re-validates `serviceChargeAmount ≈ subtotal × rate
       * / 100` and rejects drift or amounts on tenants whose rate is
       * zero. Rolls into `total` after tip so multi-tender Σ
       * validation stays unchanged.
       */
      serviceChargeAmount?: number;
      serviceChargeRate?: number | null;
      /**
       * ENG-039c — optional restaurant_tables FK captured at draft open
       * time. Persisted on the new sale row when present. The router
       * validates tenant scope + active flag before invoking the
       * service.
       */
      tableId?: string | null;
    }
  | {
      mode: 'fromDraft';
      saleId: string;
      payments?: CompleteSaleTender[];
      paymentMethod: SalePaymentMethod;
      amountReceived?: number;
      paymentStatus: SalePaymentStatus;
      notes?: string | null;
      /**
       * ENG-039d — tip captured at draft-completion time. Items are
       * already frozen on the draft; the tip is layered onto the
       * existing `total` and persisted alongside.
       */
      tipAmount?: number;
      tipMethod?: SaleTipMethod | null;
      /**
       * ENG-039d3 — service charge captured at draft-completion. The
       * service re-reads the live tenant rate at commit time so a
       * long-suspended draft cannot bypass a rate change.
       */
      serviceChargeAmount?: number;
      serviceChargeRate?: number | null;
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
  user: { id: string; role: string };
  envelope?: { operationId: string } | null;
  deviceId?: string | null;
  log?: CompleteSaleLogger;
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
