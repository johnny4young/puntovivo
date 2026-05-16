/**
 * ENG-040a + sprint-1 OCR — Schemas for legacy image OCR, upload-id
 * extraction, catalog matching, and confirming a reviewed draft.
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
    // ~4/3 expansion: a 10 MB raw payload is roughly 13.4 MB base64.
    // Add 32 KB of slack for the optional data-URL prefix and provider
    // metadata. The service layer re-checks the decoded byte count.
    .max(Math.ceil(INVOICE_OCR_MAX_BYTES * 1.4) + 32 * 1024)
    .transform(value => value.replace(dataUrlPrefix, '')),
  mimeType: z.enum(INVOICE_OCR_MIME_TYPES),
});
export type ExtractInvoiceLinesInput = z.infer<typeof extractInvoiceLinesInput>;

export const extractInvoiceOcrInput = z.object({
  uploadId: z.string().min(1).max(100),
});
export type ExtractInvoiceOcrInput = z.infer<typeof extractInvoiceOcrInput>;

/**
 * ENG-040 slice 1b — input for `ai.matchInvoiceLines`. The shape
 * mirrors `InvoiceOcrLineSchema` so the modal can pass the OCR output
 * verbatim. Description is bounded at 500 chars to prevent abuse — a
 * realistic invoice line is well under 200.
 */
export const matchInvoiceLinesInput = z.object({
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantity: z.number().nullable(),
        unitPrice: z.number().nullable(),
        totalLine: z.number().nullable(),
      })
    )
    // 200 lines covers any realistic provider invoice; the ceiling is
    // a defense-in-depth bound so a malformed OCR response cannot
    // trigger a multi-MB embedding batch.
    .max(200),
});
export type MatchInvoiceLinesInput = z.infer<typeof matchInvoiceLinesInput>;

/**
 * 2026-05-15 — confirm a reviewed PurchaseDraft. The procedure stores
 * an audit-log row (`ai.invoice_ocr.confirm`) so AiConfigPage can
 * surface the operator who approved a given OCR pass. The actual
 * purchase creation is delegated to `purchases.create` via the caller
 * — this RPC stays narrow to keep the audit trail isolated.
 */
export const confirmInvoiceDraftInput = z.object({
  uploadId: z.string().min(1).max(100),
  extractAuditId: z.string().min(1).max(100),
  providerId: z.string().min(1),
  supplier: z.object({
    name: z.string().trim().min(0).max(200),
    nit: z.string().trim().max(50).nullable(),
  }),
  invoiceNumber: z.string().trim().max(80).nullable(),
  totals: z.object({
    subtotal: z.number(),
    iva: z.number(),
    total: z.number(),
    linesSum: z.number(),
  }),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantity: z.number().positive(),
        unitPrice: z.number().min(0),
        matchedProductId: z.string().min(1),
        unitId: z.string().min(1),
      })
    )
    .min(1)
    .max(500),
});
export type ConfirmInvoiceDraftInput = z.infer<typeof confirmInvoiceDraftInput>;
