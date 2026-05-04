/**
 * ENG-057 — Chile (SII) provider error mapping (placeholder for ENG-036c).
 *
 * Will dispatch SII rechazo codes once the certificación + XAdES
 * signing flow lands with ENG-036c.
 *
 * Returns `null` so the normalizer falls back to its default
 * heuristic.
 *
 * @module services/fiscal/packs/cl/error-mapping
 */

import type { NormalizedFiscalError } from '../../errors.js';

export function mapChileProviderError(_err: unknown): NormalizedFiscalError | null {
  return null;
}
