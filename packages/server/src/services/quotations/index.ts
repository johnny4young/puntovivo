/**
 * Quotation Service ().
 *
 * A quotation is a non-binding pre-sale document. Creating, updating status,
 * or deleting a draft quotation never touches `inventory_balances` (the
 * single source of truth for stock).
 *
 * decomposed into per-concern modules (types / pricing / create /
 * updateStatus / delete / read). This barrel re-exports the original public
 * surface while the tRPC router points at this index module.
 *
 * @module services/quotations
 */
export type {
  QuotationItemInput,
  CreateQuotationArgs,
  ResolvedQuotationLine,
  QuotationTotals,
  CreatedQuotation,
  UpdateQuotationStatusArgs,
  DeleteQuotationArgs,
  QuotationListEntry,
  ListQuotationsOptions,
  QuotationDetailLine,
  QuotationDetail,
} from './types.js';
export { computeQuotationTotals } from './pricing.js';
export { createQuotation } from './create.js';
export { updateQuotationStatus } from './updateStatus.js';
export { deleteQuotation } from './delete.js';
export { listQuotations, getQuotationById } from './read.js';
