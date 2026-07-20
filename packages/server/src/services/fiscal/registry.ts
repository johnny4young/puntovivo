/**
 * Fiscal adapter registry keyed by ISO 3166-1 alpha-2 `countryCode`.
 *
 * Dispatch:
 *
 * - `'CO'` → deterministic `ColombiaMockAdapter`.
 * - `'MX'` → draft `MexicoCFDIAdapter` for CFDI 4.0.
 * - `'CL'` → draft `ChileSIIAdapter` for DTE 1.0.
 * - Unknown country → `FISCAL_PACK_NOT_AVAILABLE`.
 *
 * the registry NO LONGER falls back an unknown country to the
 * Colombia mock. Emitting a Colombia-shaped CUFE for, say, an Argentine
 * tenant is a lie: the document looks real but targets the wrong
 * authority. Instead `getFiscalAdapter` throws a typed error for any
 * country without a pack. Sale-path callers (the orchestrator) guard
 * with `isSupportedFiscalCountry()` BEFORE resolving, so an unsupported
 * country simply skips fiscal emission (the sale still completes,
 * non-fatal) rather than throwing into the lifecycle. The throw is the
 * defensive backstop for any direct misuse.
 *
 * Mirrors the AI provider Strategy/Factory.
 *
 * @module services/fiscal/registry
 */

import type { FiscalAdapter, FiscalAdapterMaturity } from './adapter.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { ChileSIIAdapter, ColombiaMockAdapter, MexicoCFDIAdapter } from './packs/index.js';

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

/** the ISO codes that have a real pack (no silent fallback). */
export const SUPPORTED_FISCAL_COUNTRIES = Object.keys(
  ADAPTER_FACTORIES
) as readonly SupportedFiscalCountry[];

/**
 * type guard: does this country have a fiscal pack? Sale-path
 * callers MUST check this before `getFiscalAdapter` so an unsupported
 * country skips emission cleanly instead of throwing into the sale.
 */
export function isSupportedFiscalCountry(
  countryCode: string
): countryCode is SupportedFiscalCountry {
  return Object.prototype.hasOwnProperty.call(ADAPTER_FACTORIES, countryCode);
}

/**
 * Test-only override map. Production code MUST NEVER write
 * here; the `__` prefix + JSDoc warning + the `as never` cast on the
 * test seam below enforce this by convention. Tests inject a stub
 * adapter via `__setFiscalAdapterForTest('CO', stub)` so the fiscal
 * worker reaches a controllable adapter without touching the
 * registry singleton.
 */
const TEST_ADAPTER_OVERRIDES: Map<string, FiscalAdapter> = new Map();

/**
 * Resolve the active fiscal adapter for a given country code.
 * an unsupported country THROWS `FISCAL_PACK_NOT_AVAILABLE` instead of
 * silently returning a Colombia-shaped mock. The no-arg call still
 * defaults to CO. Callers on the sale path guard with
 * `isSupportedFiscalCountry()` first so the sale stays non-fatal.
 */
export function getFiscalAdapter(countryCode: string = DEFAULT_FISCAL_COUNTRY): FiscalAdapter {
  const overridden = TEST_ADAPTER_OVERRIDES.get(countryCode);
  if (overridden) return overridden;
  const factory = (ADAPTER_FACTORIES as Record<string, (() => FiscalAdapter) | undefined>)[
    countryCode
  ];
  if (!factory) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `No fiscal pack is available for country "${countryCode}".`,
      details: { countryCode, field: 'fiscal.country' },
    });
  }
  return factory();
}

/**
 * TEST-ONLY adapter override seam. The double-underscore
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
 * TEST-ONLY: clear every override. Useful in `afterEach`
 * to keep tests isolated.
 */
export function __clearFiscalAdapterOverridesForTest(): void {
  TEST_ADAPTER_OVERRIDES.clear();
}

/**
 * Discovery surface for an admin UI: lists every country code the
 * registry knows about plus the adapter maturity used by product
 * surfaces to distinguish mock, draft, and certified packs.
 */
export function listFiscalAdapterCountries(): ReadonlyArray<{
  code: SupportedFiscalCountry;
  maturity: FiscalAdapterMaturity;
}> {
  return (Object.keys(ADAPTER_FACTORIES) as SupportedFiscalCountry[]).map(code => {
    const adapter = ADAPTER_FACTORIES[code]();
    return {
      code,
      maturity: adapter.maturity,
    };
  });
}

/**
 * descriptor lookup for a STORED `providerId` (e.g. `mock-co`
 * on a `fiscal_documents` row). Lets document views + diagnostics label a
 * historical document's maturity without re-resolving by country. Built
 * once from the registry, so adding a real (`certified`) pack registers
 * its provider id automatically. Returns `null` for an unknown provider
 * id (legacy / removed pack) — callers default such rows to demo.
 */
const PROVIDER_DESCRIPTORS: ReadonlyMap<
  string,
  { maturity: FiscalAdapterMaturity; countryCode: SupportedFiscalCountry }
> = new Map(
  (Object.keys(ADAPTER_FACTORIES) as SupportedFiscalCountry[]).map(code => {
    const adapter = ADAPTER_FACTORIES[code]();
    return [adapter.providerId, { maturity: adapter.maturity, countryCode: code }] as const;
  })
);

export function describeFiscalProvider(
  providerId: string
): { maturity: FiscalAdapterMaturity; countryCode: SupportedFiscalCountry } | null {
  return PROVIDER_DESCRIPTORS.get(providerId) ?? null;
}
