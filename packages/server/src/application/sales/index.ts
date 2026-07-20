/**
 * Barrel re-export for the `sales` use-case bundle.
 *
 * Public surface that the tRPC router and tests import from:
 *
 * - `completeSale(ctx, input)` — orchestration entry point covering
 * both the fresh-sale (`mode: 'fresh'`) and draft-completion
 * (`mode: 'fromDraft'`) paths.
 * - `policies` — pure functions invoked by both the use-case and
 * adjacent paths (returnSale / voidSale today,  next).
 * - `types` — input + output + context shapes.
 *
 * @module application/sales
 */

export { completeSale } from './completeSale.js';
export type { CompleteSaleSaleRecord } from './completeSale.js';
export { returnSale, type ReturnSaleInput } from './returnSale.js';
export { voidSale, type VoidSaleInput, type VoidedSaleRecord } from './voidSale.js';
export { discardDraft, type DiscardDraftInput, type DiscardDraftResult } from './discardDraft.js';
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
  buildReturnedSaleNotes,
  buildVoidedSaleNotes,
  getCashCollectedAmount,
  getNormalizedSaleQuantity,
  getPaymentStatus,
  getPersistedCashContribution,
  resolveSalePayments,
  type ResolvedSalePayments,
} from './policies.js';
export {
  reverseSaleItemsStock,
  type ReverseSaleItem,
  type ReverseSaleItemsStockArgs,
  type ReversalKind,
} from './inventory-policy.js';
export { getOriginalDeeCufe } from './fiscal-policy.js';
export { emitCompleteSaleEffects, type JournalEffectInput } from './journal-effects.js';
