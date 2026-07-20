/**
 * Chile (SII) provider error mapping (placeholder for ).
 *
 * Will dispatch SII rechazo codes once the certificación + XAdES
 * signing flow lands with .
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
