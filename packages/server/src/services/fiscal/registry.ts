/**
 * ENG-020 — fiscal adapter registry.
 *
 * Thin module-level singleton so sale lifecycle hooks (and any future
 * caller) can obtain the active `FiscalAdapter` without wiring the
 * instance through every call site. Fase A ships `MockAdapter` as the
 * default; ENG-021 (Fase B) swaps in `FactureAdapter` / `HkaAdapter`
 * by calling `setFiscalAdapter` once at boot.
 *
 * Tests that need to drive the contingency path can call
 * `setFiscalAdapter(new MockAdapter({ contingencyOracle }))` in a
 * beforeEach and restore the original in afterEach.
 *
 * @module services/fiscal/registry
 */

import type { FiscalAdapter } from './adapter.js';
import { MockAdapter } from './mock-adapter.js';

let activeAdapter: FiscalAdapter = new MockAdapter();

export function getFiscalAdapter(): FiscalAdapter {
  return activeAdapter;
}

export function setFiscalAdapter(adapter: FiscalAdapter): void {
  activeAdapter = adapter;
}

/** Reset back to the default MockAdapter. Useful in test teardown. */
export function resetFiscalAdapter(): void {
  activeAdapter = new MockAdapter();
}
