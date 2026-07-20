/**
 * Receipt renderer barrel.
 *
 * preserves the public surface of the former single-file
 * `services/receipt-renderer.ts` (1204 LOC), decomposed by render concern
 * during the megafile wave (types / labels / escape-resolve / format-helpers /
 * scanner-urls / html-blocks / escpos / render). The renderer stays a pure
 * function; this barrel re-exports the exact symbols the two importers
 * (trpc/routers/receiptTemplates.ts + the receipt-templates test) already use,
 * so their import path is the only thing that changes.
 *
 * @module services/receipt-renderer
 */
export { renderReceipt, buildPreviewData } from './render.js';
export { escapeHtml, resolveAndEscape } from './escape-resolve.js';
export { APP_FOOTER_METADATA, DEFAULT_RECEIPT_RENDER_LABELS } from './labels.js';
export type {
  RenderCompany,
  RenderSaleItem,
  RenderTender,
  RenderSale,
  RenderFiscal,
  RenderData,
  ReceiptRenderLocale,
  ReceiptRenderLabels,
  RenderResult,
} from './types.js';
