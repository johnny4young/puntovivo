/**
 * ENG-054 — Barrel re-export for the `sales` use-case bundle.
 *
 * Public surface that the tRPC router and tests import from:
 *
 * - `completeSale(ctx, input)` — orchestration entry point covering
 *   both the fresh-sale (`mode: 'fresh'`) and draft-completion
 *   (`mode: 'fromDraft'`) paths.
 * - `policies` — pure functions invoked by both the use-case and
 *   adjacent paths (returnSale / voidSale today, ENG-055 next).
 * - `types` — input + output + context shapes.
 *
 * @module application/sales
 */

export { completeSale } from './completeSale.js';
export type {
  CompleteSaleContext,
  CompleteSaleInput,
  CompleteSaleItemInput,
  CompleteSaleResult,
  CompleteSaleTender,
  FreshSaleStatus,
  SalePaymentMethod,
  SalePaymentStatus,
} from './types.js';
export {
  getCashCollectedAmount,
  getNormalizedSaleQuantity,
  getPaymentStatus,
  resolveSalePayments,
  type ResolvedSalePayments,
} from './policies.js';
export {
  emitCompleteSaleEffects,
  type JournalEffectInput,
} from './journal-effects.js';
