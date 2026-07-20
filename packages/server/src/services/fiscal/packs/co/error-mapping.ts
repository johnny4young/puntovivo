/**
 * Colombia provider error mapping (placeholder for ).
 *
 * The Colombia mock adapter does not throw on its own; this mapper
 * is wired so the registry stays symmetric with MX / CL packs and
 * so future Facture / HKA / Gosocket integrations have a single
 * landing module to extend.
 *
 * Returns `null` when the raw error does not match a known Colombia
 * provider shape — the normalizer's default heuristic takes over.
 *
 * @module services/fiscal/packs/co/error-mapping
 */

import type { NormalizedFiscalError } from '../../errors.js';

export function mapColombiaProviderError(_err: unknown): NormalizedFiscalError | null {
  // will populate the Facture / HKA / Gosocket code dispatch
  // (e.g. AAB10 → MALFORMED_REQUEST, GS-503 → PROVIDER_5XX). The
  // current mock adapter never reaches this path because it does not
  // throw; the placeholder stays so the file path is registered in
  // the per-pack mapper table.
  return null;
}
