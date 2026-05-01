/**
 * ENG-034 — fiscal adapter registry dispatch tests.
 *
 * The registry is the entry point that the sale lifecycle calls
 * once per fiscal emission with the tenant's `countryCode`. These
 * tests pin:
 *
 * - Default-arg path (no country) → ColombiaMockAdapter.
 * - Known country dispatch (CO / MX / CL) → correct concrete adapter
 *   with the right `countryCode` field.
 * - Unknown country fallback → ColombiaMockAdapter (defensive: keeps
 *   the sale lifecycle non-fatal during the rollout window before
 *   all packs ship).
 * - `listFiscalAdapterCountries()` shape: 3 entries; CO implemented;
 *   MX + CL stubbed with their `availableInTicket` strings.
 * - Each adapter exposes a stable `countryCode` for the orchestrator
 *   to introspect.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FISCAL_COUNTRY,
  getFiscalAdapter,
  listFiscalAdapterCountries,
} from '../services/fiscal/registry.js';
import { ColombiaMockAdapter } from '../services/fiscal/packs/co/mock-adapter.js';
import { MexicoCFDIAdapter } from '../services/fiscal/packs/mx/mexico-adapter.js';
import { ChileSIIAdapter } from '../services/fiscal/packs/cl/chile-adapter.js';

describe('getFiscalAdapter (ENG-034)', () => {
  it('returns ColombiaMockAdapter when called with no argument', () => {
    const adapter = getFiscalAdapter();
    expect(adapter).toBeInstanceOf(ColombiaMockAdapter);
    expect(adapter.countryCode).toBe('CO');
  });

  it('returns ColombiaMockAdapter for "CO"', () => {
    const adapter = getFiscalAdapter('CO');
    expect(adapter).toBeInstanceOf(ColombiaMockAdapter);
    expect(adapter.providerId).toBe('mock-co');
  });

  it('returns MexicoCFDIAdapter for "MX" (stub for ENG-035)', () => {
    const adapter = getFiscalAdapter('MX');
    expect(adapter).toBeInstanceOf(MexicoCFDIAdapter);
    expect(adapter.countryCode).toBe('MX');
    // The stub flag is a discriminant for the future admin UI.
    expect((adapter as { notImplemented?: boolean }).notImplemented).toBe(true);
    expect(
      (adapter as { availableInTicket?: string }).availableInTicket
    ).toBe('ENG-035b');
  });

  it('returns ChileSIIAdapter for "CL" (stub for ENG-036b)', () => {
    const adapter = getFiscalAdapter('CL');
    expect(adapter).toBeInstanceOf(ChileSIIAdapter);
    expect(adapter.countryCode).toBe('CL');
    expect(
      (adapter as { availableInTicket?: string }).availableInTicket
    ).toBe('ENG-036b');
  });

  it('falls back to ColombiaMockAdapter for an unknown country code', () => {
    // Defensive: orchestrator's `fiscal_dian_enabled` flag is the
    // gate that activates fiscal at all; the fallback keeps the sale
    // lifecycle non-fatal during the rollout window before all
    // packs ship. Documented in services/fiscal/registry.ts.
    const adapter = getFiscalAdapter('AR');
    expect(adapter).toBeInstanceOf(ColombiaMockAdapter);
  });

  it('exposes the default country constant', () => {
    expect(DEFAULT_FISCAL_COUNTRY).toBe('CO');
  });
});

describe('listFiscalAdapterCountries (ENG-034)', () => {
  it('returns one entry per registered country with isImplemented + availableInTicket', () => {
    const list = listFiscalAdapterCountries();
    expect(list).toHaveLength(3);

    const byCode = new Map(list.map(entry => [entry.code, entry]));
    expect(byCode.get('CO')).toEqual({
      code: 'CO',
      isImplemented: true,
      availableInTicket: undefined,
    });
    expect(byCode.get('MX')).toEqual({
      code: 'MX',
      isImplemented: false,
      availableInTicket: 'ENG-035b',
    });
    expect(byCode.get('CL')).toEqual({
      code: 'CL',
      isImplemented: false,
      availableInTicket: 'ENG-036b',
    });
  });
});
