/**
 * Shared types for the invoice OCR feature.
 *
 * Mirror of the server-side `ai.invoiceOcr.extract` projection. Kept
 * here so client-only helpers (`bandConfidence`, the form, the dialog)
 * have a stable contract without having to import the inferred tRPC
 * type — which would couple the UI to the router's internal Zod
 * machinery.
 *
 * Added 2026-05-15 per AI Núcleo handoff §5.
 */

export type MatchSource = 'sku' | 'embedding' | 'manual' | null;

export interface DraftLine {
  description: string;
  quantity: number;
  unitPrice: number;
  matchedProductId: string | null;
  matchedProductName: string | null;
  matchedProductSku: string | null;
  unitId: string | null;
  unitName: string | null;
  unitEquivalence: number | null;
  matchedBy: MatchSource;
  /** 0..1 — surfaced as a colored chip next to the line description. */
  confidence: number;
}

export interface PurchaseDraft {
  supplier: {
    name: string;
    nit: string | null;
    confidence: number;
  };
  providerId: string | null;
  invoiceNumber: { value: string; confidence: number };
  lines: DraftLine[];
  totals: {
    subtotal: number;
    iva: number;
    total: number;
    /** Σ(line totals); review form warns when |total - linesSum| > 100. */
    linesSum: number;
  };
  warnings: string[];
  meta: {
    costUsd: number;
    latencyMs: number;
    provider: string;
  };
  /** Audit log id returned by the server; passed back on `confirm`. */
  uploadAuditId: string;
  /** Upload id returned by `upload.uploadInvoice`; used by confirm for audit correlation. */
  uploadId: string;
  /** AI provider audit id returned by `ai.invoiceOcr.extract`. */
  extractAuditId: string;
}

export type Confidence = 'high' | 'mid' | 'low';

export function bandConfidence(c: number): Confidence {
  if (c >= 0.85) return 'high';
  if (c >= 0.6) return 'mid';
  return 'low';
}
