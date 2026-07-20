/**
 * México (CFDI) provider error mapping (placeholder for ).
 *
 * Will dispatch SAT response codes (CFDI40103 → MALFORMED_REQUEST,
 * CFDI40110 → INVALID_CERT, etc.) once the PAC integration ships
 * with .
 *
 * Returns `null` so the normalizer falls back to its default
 * heuristic.
 *
 * @module services/fiscal/packs/mx/error-mapping
 */

import type { NormalizedFiscalError } from '../../errors.js';

export function mapMexicoProviderError(_err: unknown): NormalizedFiscalError | null {
  return null;
}
