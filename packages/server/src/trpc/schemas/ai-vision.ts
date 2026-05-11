/**
 * ENG-040a — Schemas for `ai.extractInvoiceLines`.
 *
 * @module trpc/schemas/ai-vision
 */
import { z } from 'zod';

import {
  INVOICE_OCR_MAX_BYTES,
  INVOICE_OCR_MIME_TYPES,
} from '../../services/ai/vision/invoice-ocr.js';

const dataUrlPrefix = /^data:[^;]+;base64,/;

export const extractInvoiceLinesInput = z.object({
  /**
   * Base64-encoded image bytes. Accepts both the raw payload and a
   * `data:image/...;base64,` URL — the prefix is stripped server-side
   * so the rest of the pipeline sees a clean base64 string. Max raw
   * decoded size: `INVOICE_OCR_MAX_BYTES` (enforced after decode in the
   * service layer; the Zod ceiling here is a defense-in-depth byte
   * length to bound payload growth at the transport).
   */
  imageBase64: z
    .string()
    .min(1)
    // ~4/3 expansion: a 5 MB raw payload is roughly 6.7 MB base64. Add
    // 32 KB of slack for the optional data-URL prefix and provider
    // metadata. The service layer re-checks the decoded byte count.
    .max(Math.ceil(INVOICE_OCR_MAX_BYTES * 1.4) + 32 * 1024)
    .transform(value => value.replace(dataUrlPrefix, '')),
  mimeType: z.enum(INVOICE_OCR_MIME_TYPES),
});
export type ExtractInvoiceLinesInput = z.infer<typeof extractInvoiceLinesInput>;
