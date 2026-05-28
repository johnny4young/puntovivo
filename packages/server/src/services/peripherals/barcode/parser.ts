/**
 * ENG-061 — Pure barcode parser.
 *
 * Validates EAN-13, EAN-8, and UPC-A checksums and decodes GS1
 * prefix 20-29 weight-embedded and price-embedded labels (the
 * "in-store" prefixes that LATAM grocery and butcher shops emit
 * from their PLU scales).
 *
 * Pure module: zero I/O, zero side effects, deterministic.
 * Mirrors the purity convention of `services/fiscal/qr-builder.ts`.
 *
 * The renderer's `useBarcodeWedgeListener` accumulates raw
 * keystrokes; the SalesPage hands the resulting string to
 * `products.lookupByBarcode`, which calls `parseScan` server-side
 * to decide whether the code is a plain product barcode or
 * carries an embedded weight/price override. The parser never
 * looks at the database — it only inspects the digit pattern.
 *
 * Reference layouts (LATAM grocery convention, "generic" scheme):
 *
 *   2{ITF-5 SKU}{ITF-5 WEIGHT-grams}{CHK}   → kind='gs1-weight'
 *   2{ITF-5 SKU}{ITF-5 PRICE-cents}{CHK}    → kind='gs1-price'
 *
 * Per-country slices (`co`, `mx`, `cl`) currently fall back to the
 * generic layout. When a pilot site shows real-world divergence,
 * a per-country branch lands without contract churn.
 *
 * @module services/peripherals/barcode/parser
 */

export type ScanKind =
  | 'ean13'
  | 'ean8'
  | 'upc-a'
  | 'gs1-weight'
  | 'gs1-price'
  | 'unknown';

export type Gs1Scheme = 'none' | 'generic' | 'co' | 'mx' | 'cl';

export interface ParsedScan {
  kind: ScanKind;
  /** The cleaned numeric code (whitespace stripped). */
  code: string;
  /** SKU prefix to look up in the products table when the scan
   * carries embedded data. For non-GS1 codes this equals `code`. */
  lookupCode: string;
  // ENG-179b — explicit `| undefined` lets builders assign these
  // fields conditionally without violating `exactOptionalPropertyTypes`.
  /** When `kind === 'gs1-weight'`: kilograms. */
  weightKg?: number | undefined;
  /** When `kind === 'gs1-price'`: currency major units (e.g. 19.95). */
  priceMajor?: number | undefined;
  /** Whether the checksum (when one applies) verified. */
  checksumValid: boolean;
}

// =============================================================================
// Checksum validators
// =============================================================================

/**
 * EAN-13 mod-10 checksum. Algorithm: sum digits at even indices
 * (0-based) plus 3× the sum at odd indices; the check digit is
 * `(10 - sum % 10) % 10`.
 */
export function validateEan13Checksum(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(code[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(code[12]);
}

/**
 * EAN-8 mod-10 checksum. Algorithm: 3× the sum at even indices
 * plus the sum at odd indices; the check digit is
 * `(10 - sum % 10) % 10`.
 */
export function validateEan8Checksum(code: string): boolean {
  if (!/^\d{8}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i += 1) {
    const digit = Number(code[i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(code[7]);
}

/**
 * UPC-A mod-10 checksum. UPC-A is 12 digits (essentially EAN-13
 * with a leading zero). Algorithm: 3× sum at even indices plus
 * sum at odd indices; check is `(10 - sum % 10) % 10`.
 */
export function validateUpcAChecksum(code: string): boolean {
  if (!/^\d{12}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i += 1) {
    const digit = Number(code[i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(code[11]);
}

// =============================================================================
// GS1 prefix 20-29 helpers
// =============================================================================

/**
 * Decode a 13-digit GS1 prefix-2x label into a weight or price
 * payload. Returns `null` when the layout does not match the
 * scheme, so the caller can fall back to plain SKU lookup.
 *
 * The layout assumed for the `generic` scheme:
 *
 *   position 0:    '2'                       (GS1 in-store flag)
 *   position 1:    role digit
 *                    even (0/2/4/6/8) → weight-embedded
 *                    odd  (1/3/5/7/9) → price-embedded
 *   positions 2-6: SKU (5 digits)
 *   positions 7-11: payload (5 digits, grams or cents)
 *   position 12:   EAN-13 check digit
 *
 * This is the most common LATAM butcher/produce/bulk layout.
 * Per-country schemes can override later without contract churn.
 */
export function parseGs1WeightOrPrice(args: {
  code: string;
  scheme?: Gs1Scheme;
}): { kind: 'gs1-weight' | 'gs1-price'; sku: string; weightKg?: number; priceMajor?: number } | null {
  const { code } = args;
  const scheme = args.scheme ?? 'generic';
  if (scheme === 'none') return null;
  if (!/^2\d{12}$/.test(code)) return null;

  // co/mx/cl currently piggyback on `generic`. Future: per-country
  // branches when real-world layouts diverge.
  if (scheme !== 'generic' && scheme !== 'co' && scheme !== 'mx' && scheme !== 'cl') {
    return null;
  }

  const roleDigit = Number(code[1]);
  const sku = code.slice(2, 7); // 5-digit ITF SKU
  const payload = Number(code.slice(7, 12)); // 5-digit ITF payload
  if (Number.isNaN(payload)) return null;

  const isWeight = roleDigit % 2 === 0;
  if (isWeight) {
    // payload is grams; convert to kg (3-decimal precision)
    return {
      kind: 'gs1-weight',
      sku,
      weightKg: Math.round((payload / 1000) * 1000) / 1000,
    };
  }
  // payload is currency cents (minor units)
  return {
    kind: 'gs1-price',
    sku,
    priceMajor: Math.round((payload / 100) * 100) / 100,
  };
}

// =============================================================================
// Top-level parseScan
// =============================================================================

/**
 * Parse a raw scanned code into a discriminated union. The caller
 * uses `lookupCode` to query the database and `weightKg` /
 * `priceMajor` to override the cart line when present.
 *
 * Strict callers (default) reject codes whose checksum fails by
 * returning `kind: 'unknown'`; permissive callers can still try
 * the lookup since the parser also exposes `code` verbatim.
 */
export function parseScan(
  rawCode: string,
  options?: { gs1Scheme?: Gs1Scheme }
): ParsedScan {
  const code = rawCode.trim();
  const scheme = options?.gs1Scheme ?? 'generic';

  // Reject anything that is not pure digits — alphanumeric Code 128
  // and other symbologies are out of ENG-061 scope.
  if (!/^\d+$/.test(code)) {
    return { kind: 'unknown', code, lookupCode: code, checksumValid: false };
  }

  if (code.length === 8) {
    const ok = validateEan8Checksum(code);
    return { kind: ok ? 'ean8' : 'unknown', code, lookupCode: code, checksumValid: ok };
  }

  if (code.length === 12) {
    const ok = validateUpcAChecksum(code);
    return { kind: ok ? 'upc-a' : 'unknown', code, lookupCode: code, checksumValid: ok };
  }

  if (code.length === 13) {
    const ean13Ok = validateEan13Checksum(code);
    if (code.startsWith('2') && scheme !== 'none') {
      const gs1 = parseGs1WeightOrPrice({ code, scheme });
      if (gs1) {
        return {
          kind: gs1.kind,
          code,
          lookupCode: gs1.sku,
          weightKg: gs1.weightKg,
          priceMajor: gs1.priceMajor,
          checksumValid: ean13Ok,
        };
      }
    }
    return { kind: ean13Ok ? 'ean13' : 'unknown', code, lookupCode: code, checksumValid: ean13Ok };
  }

  // ENG-061 ships EAN-13 / EAN-8 / UPC-A only. GS1-128 (length 14+)
  // and other symbologies fall through as unknown so the caller can
  // still attempt a verbatim DB lookup.
  return { kind: 'unknown', code, lookupCode: code, checksumValid: false };
}
