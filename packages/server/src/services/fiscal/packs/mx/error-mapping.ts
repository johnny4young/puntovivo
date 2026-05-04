/**
 * ENG-057 — México (CFDI) provider error mapping (placeholder for ENG-035c).
 *
 * Will dispatch SAT response codes (CFDI40103 → MALFORMED_REQUEST,
 * CFDI40110 → INVALID_CERT, etc.) once the PAC integration ships
 * with ENG-035c.
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
