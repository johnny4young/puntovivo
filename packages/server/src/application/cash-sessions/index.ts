/**
 * ENG-056 — Barrel re-export for the `cash-sessions` use-case bundle.
 *
 * Public surface that the tRPC router and tests import from:
 *
 * - `openCashSession(ctx, input)` — open shift use-case (replaces the
 *   inline body that lived in `trpc/routers/cashSessions.ts::open`).
 * - `closeCashSession(ctx, input)` — close shift use-case with pending
 *   fiscal/payment enrichment (replaces `cashSessions.close` body).
 * - `recordCashMovement(ctx, input)` — manual movement use-case
 *   (paid_in / paid_out / skim / replenishment); replaces
 *   `cashSessions.recordMovement` body.
 * - `getPendingChecksForSession` — reusable read helper, also surfaced
 *   via the new `cashSessions.pendingChecks` tRPC query.
 *
 * @module application/cash-sessions
 */

export {
  openCashSession,
  type OpenedCashSessionRow,
} from './openCashSession.js';
export {
  closeCashSession,
  type ClosedCashSessionRow,
} from './closeCashSession.js';
export {
  recordCashMovement,
  type RecordedCashMovement,
} from './recordCashMovement.js';
export {
  getPendingChecksForSession,
  getPendingFiscalForSession,
  getPendingPaymentForSession,
} from './pending-checks.js';
export type {
  CashSessionContext,
  CashSessionLogger,
  CloseCashSessionInput,
  CloseCashSessionResult,
  ManualCashMovementType,
  OpenCashSessionInput,
  OpenCashSessionResult,
  PendingChecksResult,
  PendingFiscalSample,
  PendingPaymentSample,
  RecordCashMovementInput,
  RecordCashMovementResult,
} from './types.js';
export {
  emitCashSessionEffects,
  lookupCashSessionJournalEventId,
  type CashSessionJournalEffectInput,
} from './journal-effects.js';
