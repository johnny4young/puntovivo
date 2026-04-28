/**
 * ENG-020 — fiscal adapter registry.
 *
 * Thin module-level singleton so sale lifecycle hooks (and any future
 * caller) can obtain the active `FiscalAdapter` without wiring the
 * instance through every call site. Fase A ships `MockAdapter` as the
 * default; ENG-034 (FISCAL-CORE refactor) will reintroduce the swap
 * surface under the new pluggable adapter contract.
 *
 * @module services/fiscal/registry
 */

import type { FiscalAdapter } from './adapter.js';
import { MockAdapter } from './mock-adapter.js';

const activeAdapter: FiscalAdapter = new MockAdapter();

export function getFiscalAdapter(): FiscalAdapter {
  return activeAdapter;
}
