/**
 * ENG-020 — fiscal adapter registry.
 * ENG-034 — promoted from implicit singleton (`new MockAdapter()`)
 * to a typed factory keyed by ISO 3166-1 alpha-2 `countryCode`.
 *
 * Dispatch:
 *
 * - `'CO'` → `ColombiaMockAdapter` (real PT swap lands with ENG-021).
 * - `'MX'` → `MexicoCFDIAdapter` (real CFDI 4.0 lands with
 *   ENG-035).
 * - `'CL'` → `ChileSIIAdapter` (real SII boleta/factura
 *   lands with ENG-036).
 * - Unknown country → falls back to `ColombiaMockAdapter`.
 *
 * The fallback is **defensive** rather than throwing. Reasoning: the
 * orchestrator already gates fiscal emission on the
 * `tenants.settings.fiscal_dian_enabled` flag — fiscal is opt-in
 * per tenant. If an admin opts in for a country that is not in the
 * matrix yet, the fallback emits a Colombia-shaped CUFE (wrong but
 * non-breaking). The operator sees the document in the admin
 * `/reports/fiscal-documents` page and can disable fiscal until the
 * pack ships. A throw would silently fail the sale lifecycle path,
 * which is worse for pilot.
 *
 * Mirrors the AI provider Strategy/Factory shipped in ENG-030 +
 * ENG-044 (`services/ai/providers/registry.ts`).
 *
 * @module services/fiscal/registry
 */

import type { FiscalAdapter } from './adapter.js';
import {
  ChileSIIAdapter,
  ColombiaMockAdapter,
  MexicoCFDIAdapter,
} from './packs/index.js';

/**
 * ISO 3166-1 alpha-2 codes the registry knows how to dispatch.
 * Adding a new country = drop a pack under `packs/<code>/` and
 * register its factory here.
 */
export type SupportedFiscalCountry = 'CO' | 'MX' | 'CL';

const ADAPTER_FACTORIES: Record<SupportedFiscalCountry, () => FiscalAdapter> = {
  CO: () => new ColombiaMockAdapter(),
  MX: () => new MexicoCFDIAdapter(),
  CL: () => new ChileSIIAdapter(),
};

/** Default country code when the caller does not supply one. */
export const DEFAULT_FISCAL_COUNTRY: SupportedFiscalCountry = 'CO';

/**
 * ENG-057 — Test-only override map. Production code MUST NEVER write
 * here; the `__` prefix + JSDoc warning + the `as never` cast on the
 * test seam below enforce this by convention. Tests inject a stub
 * adapter via `__setFiscalAdapterForTest('CO', stub)` so the fiscal
 * worker reaches a controllable adapter without touching the
 * registry singleton.
 */
const TEST_ADAPTER_OVERRIDES: Map<string, FiscalAdapter> = new Map();

/**
 * Resolve the active fiscal adapter for a given country code. Falls
 * back to the default country (CO) when the input is unknown or
 * empty — keeps the sale lifecycle non-fatal during the rollout
 * window before all packs ship.
 */
export function getFiscalAdapter(
  countryCode: string = DEFAULT_FISCAL_COUNTRY
): FiscalAdapter {
  const overridden = TEST_ADAPTER_OVERRIDES.get(countryCode);
  if (overridden) return overridden;
  const factory =
    (ADAPTER_FACTORIES as Record<string, () => FiscalAdapter>)[countryCode] ??
    ADAPTER_FACTORIES[DEFAULT_FISCAL_COUNTRY];
  return factory();
}

/**
 * ENG-057 — TEST-ONLY adapter override seam. The double-underscore
 * prefix marks it as never-call-from-production; integration tests
 * use it to inject a stub adapter (typically with a `throwOracle`
 * for outage simulation) without monkey-patching the registry.
 *
 * Pass `null` to clear the override and revert to the default
 * factory for the country code.
 */
export function __setFiscalAdapterForTest(
  countryCode: string,
  adapter: FiscalAdapter | null
): void {
  if (adapter === null) {
    TEST_ADAPTER_OVERRIDES.delete(countryCode);
  } else {
    TEST_ADAPTER_OVERRIDES.set(countryCode, adapter);
  }
}

/**
 * ENG-057 — TEST-ONLY: clear every override. Useful in `afterEach`
 * to keep tests isolated.
 */
export function __clearFiscalAdapterOverridesForTest(): void {
  TEST_ADAPTER_OVERRIDES.clear();
}

/**
 * Discovery surface for an admin UI: lists every country code the
 * registry knows about plus whether the pack is implemented or
 * stubbed (with the gating ticket id). Mirrors
 * `listProviders()` from the AI provider registry so the future
 * fiscal-readiness card can render the same shape.
 */
export function listFiscalAdapterCountries(): ReadonlyArray<{
  code: SupportedFiscalCountry;
  isImplemented: boolean;
  availableInTicket?: string;
}> {
  return (Object.keys(ADAPTER_FACTORIES) as SupportedFiscalCountry[]).map(code => {
    const adapter = ADAPTER_FACTORIES[code]();
    const stubbed = (adapter as { availableInTicket?: string }).availableInTicket;
    return {
      code,
      isImplemented: !stubbed,
      availableInTicket: stubbed,
    };
  });
}
