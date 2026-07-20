/**
 * Public types for the `cash-sessions` application service
 * bundle.
 *
 * Mirrors `application/sales/types.ts` so the two aggregates expose a
 * compatible context shape (the renderer-side hooks build a single
 * envelope-carrying ctx that any critical mutation can consume).
 *
 * @module application/cash-sessions/types
 */

import type { DatabaseInstance } from '../../db/index.js';
import type { PuntovivoLogger } from '../../logging/logger.js';
import type { CashSessionDenomination, CashMovementType } from '../../db/schema.js';

/**
 * Minimal structural log shape accepted by the cash-session use-cases.
 * Both `PuntovivoLogger` (pino) and Fastify's `FastifyBaseLogger`
 * satisfy it.
 */
export type CashSessionLogger = Pick<PuntovivoLogger, 'warn' | 'info' | 'debug' | 'error'>;

/**
 * Subset of the tRPC `Context` that the use-cases actually read.
 *
 * - `db` — Drizzle handle.
 * - `tenantId` / `siteId` / `user` — multi-tenant + auth scope.
 * - `envelope` — when present, carries the `operationId` minted by the
 * renderer; the use-case looks up the matching `operation_events` row
 * and emits effects against it. Absent for tests built without an
 * envelope.
 * - `log` — request-scoped logger; falls back to a module logger.
 */
export interface CashSessionContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  user: { id: string; role: string };
  envelope?: { operationId: string } | null;
  deviceId?: string | null;
  log?: CashSessionLogger;
}

/** Manual cash-movement types — sale / refund flow through the sale
 * lifecycle services and never enter `recordCashMovement`. */
export type ManualCashMovementType = Exclude<CashMovementType, 'sale' | 'refund'>;

export interface OpenCashSessionInput {
  registerName: string;
  openingFloat: number;
  denominations: CashSessionDenomination[];
}

export interface CloseCashSessionInput {
  actualCount: number;
  denominations: CashSessionDenomination[];
}

export interface RecordCashMovementInput {
  type: ManualCashMovementType;
  amount: number;
  note: string;
}

export interface OpenCashSessionResult<TSession = unknown> {
  session: TSession;
  journalEventId: string | null;
  attendanceShiftStarted: boolean;
}

export interface CloseCashSessionResult<TSession = unknown> {
  session: TSession;
  overShort: number;
  pendingFiscalDocuments: number;
  pendingPaymentSales: number;
  journalEventId: string | null;
}

export interface RecordCashMovementResult<TMovement = unknown> {
  movement: TMovement;
  journalEventId: string | null;
}

export interface PendingFiscalSample {
  saleId: string;
  saleNumber: string;
  fiscalDocumentId: string;
  status: string;
}

export interface PendingPaymentSample {
  saleId: string;
  saleNumber: string;
  paymentStatus: string;
}

export interface PendingChecksResult {
  pendingFiscalDocuments: number;
  pendingPaymentSales: number;
  fiscalSamples: PendingFiscalSample[];
  paymentSamples: PendingPaymentSample[];
}
