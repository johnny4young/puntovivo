/**
 * ENG-040a — AI vision barrel.
 *
 * Exposes the provider-invoice OCR pipeline. Slice 1b adds line-to-
 * product matching helpers under the same namespace.
 *
 * @module services/ai/vision
 */
export {
  INVOICE_OCR_MAX_BYTES,
  INVOICE_OCR_MIME_TYPES,
  InvoiceOcrSchema,
  extractInvoiceFromImage,
  type InvoiceOcr,
  type InvoiceOcrInput,
  type InvoiceOcrInvocationContext,
  type InvoiceOcrLine,
  type InvoiceOcrMimeType,
  type InvoiceOcrResult,
  type VisionProviderFactory,
} from './invoice-ocr.js';
