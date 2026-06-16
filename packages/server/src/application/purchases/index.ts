/**
 * Purchase use-case barrel.
 *
 * ENG-178 — public surface of the `application/purchases/` layer extracted
 * from the former monolithic `trpc/routers/purchases.ts`. The thin router and
 * the AI invoice-upload flow import the use-cases + the read model from here.
 *
 * @module application/purchases
 */
export { createPurchase } from './createPurchase.js';
export { createPurchaseFromOrder } from './receiveFromOrder.js';
export { returnPurchase } from './returnPurchase.js';
export { voidPurchase } from './voidPurchase.js';
export { createOcrDraftPurchase } from './createOcrDraftPurchase.js';
export { getPurchaseRecord } from './purchase-read.js';
export type {
  CreateOcrDraftPurchaseInput,
  PurchaseContext,
  PurchaseSequentialContext,
  PurchaseSiteContext,
  ResolvedOrderReceiptItem,
  ResolvedPurchaseItem,
  ResolvedPurchaseReturnItem,
} from './types.js';
