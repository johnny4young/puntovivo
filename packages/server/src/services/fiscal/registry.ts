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
 * - Unknown country → THROWS `FISCAL_PACK_NOT_AVAILABLE` (ENG-185).
 *
 * ENG-185 — the registry NO LONGER falls back an unknown country to the
 * Colombia mock. Emitting a Colombia-shaped CUFE for, say, an Argentine
 * tenant is a lie: the document looks real but targets the wrong
 * authority. Instead `getFiscalAdapter` throws a typed error for any
 * country without a pack. Sale-path callers (the orchestrator) guard
 * with `isSupportedFiscalCountry()` BEFORE resolving, so an unsupported
 * country simply skips fiscal emission (the sale still completes,
 * non-fatal) rather than throwing into the lifecycle. The throw is the
 * defensive backstop for any direct misuse.
 *
 * Mirrors the AI provider Strategy/Factory shipped in ENG-030 +
 * ENG-044 (`services/ai/providers/registry.ts`).
 *
 * @module services/fiscal/registry
 */

import type { FiscalAdapter, FiscalAdapterMaturity } from './adapter.js';
import { throwServerError } from '../../lib/errorCodes.js';
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

/** ENG-185 — the ISO codes that have a real pack (no silent fallback). */
export const SUPPORTED_FISCAL_COUNTRIES = Object.keys(
  ADAPTER_FACTORIES
) as readonly SupportedFiscalCountry[];

/**
 * ENG-185 — type guard: does this country have a fiscal pack? Sale-path
 * callers MUST check this before `getFiscalAdapter` so an unsupported
 * country skips emission cleanly instead of throwing into the sale.
 */
export function isSupportedFiscalCountry(
  countryCode: string
): countryCode is SupportedFiscalCountry {
  return Object.prototype.hasOwnProperty.call(ADAPTER_FACTORIES, countryCode);
}

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
 * Resolve the active fiscal adapter for a given country code. ENG-185 —
 * an unsupported country THROWS `FISCAL_PACK_NOT_AVAILABLE` instead of
 * silently returning a Colombia-shaped mock. The no-arg call still
 * defaults to CO. Callers on the sale path guard with
 * `isSupportedFiscalCountry()` first so the sale stays non-fatal.
 */
export function getFiscalAdapter(
  countryCode: string = DEFAULT_FISCAL_COUNTRY
): FiscalAdapter {
  const overridden = TEST_ADAPTER_OVERRIDES.get(countryCode);
  if (overridden) return overridden;
  const factory = (
    ADAPTER_FACTORIES as Record<string, (() => FiscalAdapter) | undefined>
  )[countryCode];
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
  // ENG-179b — explicit `| undefined`.
  availableInTicket?: string | undefined;
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

/**
 * ENG-185 — descriptor lookup for a STORED `providerId` (e.g. `mock-co`
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
    return [
      adapter.providerId,
      { maturity: adapter.maturity, countryCode: code },
    ] as const;
  })
);

export function describeFiscalProvider(
  providerId: string
): { maturity: FiscalAdapterMaturity; countryCode: SupportedFiscalCountry } | null {
  return PROVIDER_DESCRIPTORS.get(providerId) ?? null;
}
