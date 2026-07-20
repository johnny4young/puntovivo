/**
 * Colombian invoice normalizer.
 *
 * Cleans up the raw output from `extractInvoiceFromImage` for the
 * Colombian-tax regime — finds a NIT in the supplier-tax-id field (or
 * digs it out of the supplier name when the provider missed the column),
 * tags the IVA rate (19 / 5 / 0), and trims the invoice number to its
 * canonical form. Pure functions, no I/O — easy to unit-test in
 * __tests__/ai-invoice-ocr.test.ts.
 *
 * Added 2026-05-15 per AI feature contract — invoice OCR initial iteration.
 */

const NIT_DIGITS_RE = /(?<!\d)(\d{9,10})(?:-(\d))?(?!\d)/;

const COLOMBIAN_IVA_RATES = [0, 5, 19] as const;
export type ColombianIvaRate = (typeof COLOMBIAN_IVA_RATES)[number];

export interface NormalizedSupplier {
  name: string;
  nit: string | null;
}

export interface NormalizedInvoice {
  supplier: NormalizedSupplier;
  invoiceNumber: string | null;
  ivaRate: ColombianIvaRate | null;
  linesSum: number;
}

export function extractNit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[.\s]/g, '');
  const match = NIT_DIGITS_RE.exec(cleaned);
  if (!match) return null;
  // The regex `NIT_DIGITS_RE` has group 1 as a required capture
  // `(\d{9,10})`, so when `match` is truthy `match[1]` is guaranteed.
  // Group 2 `(\d)` is inside an optional group `(?:-(\d))?` so the
  // truthy check before `${...}` is enough.  — narrow for
  // `noUncheckedIndexedAccess` without weakening the contract.
  const base = match[1] ?? null;
  return match[2] && base ? `${base}-${match[2]}` : base;
}

export function detectColombianIvaRate(
  subtotal: number | null | undefined,
  taxAmount: number | null | undefined
): ColombianIvaRate | null {
  if (subtotal == null || taxAmount == null || subtotal <= 0) return null;
  const observed = (taxAmount / subtotal) * 100;
  let best: ColombianIvaRate | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const rate of COLOMBIAN_IVA_RATES) {
    const delta = Math.abs(observed - rate);
    if (delta < bestDelta) {
      best = rate;
      bestDelta = delta;
    }
  }
  return bestDelta <= 1 ? best : null;
}

export function normalizeInvoiceNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

interface NormalizeInput {
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  lines: ReadonlyArray<{ totalLine: number | null }>;
}

export function normalizeColombianInvoice(input: NormalizeInput): NormalizedInvoice {
  const name = (input.supplierName ?? '').trim();
  const nit = extractNit(input.supplierTaxId) ?? extractNit(name);
  const ivaRate = detectColombianIvaRate(input.subtotal, input.taxAmount);
  const linesSum = input.lines.reduce((acc, line) => {
    if (line.totalLine == null) return acc;
    return acc + line.totalLine;
  }, 0);
  return {
    supplier: { name, nit },
    invoiceNumber: normalizeInvoiceNumber(input.invoiceNumber),
    ivaRate,
    linesSum,
  };
}
