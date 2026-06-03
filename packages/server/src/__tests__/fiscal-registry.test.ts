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
 * - Unsupported country → THROWS FISCAL_PACK_NOT_AVAILABLE (ENG-185 —
 *   no Colombia-shaped fallback; the sale path guards with
 *   `isSupportedFiscalCountry` and skips emission instead).
 * - `listFiscalAdapterCountries()` shape: 3 entries; CO implemented;
 *   MX + CL stubbed with their `availableInTicket` strings.
 * - Each adapter exposes a stable `countryCode` for the orchestrator
 *   to introspect.
 */

import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  DEFAULT_FISCAL_COUNTRY,
  SUPPORTED_FISCAL_COUNTRIES,
  describeFiscalProvider,
  getFiscalAdapter,
  isSupportedFiscalCountry,
  listFiscalAdapterCountries,
} from '../services/fiscal/registry.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
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

  it('returns MexicoCFDIAdapter for "MX" (real CFDI 4.0 emission via ENG-035b)', () => {
    const adapter = getFiscalAdapter('MX');
    expect(adapter).toBeInstanceOf(MexicoCFDIAdapter);
    expect(adapter.countryCode).toBe('MX');
    // ENG-035b promotes MX from a NotImplemented stub to a real
    // adapter — `notImplemented` flag is gone and there is no
    // `availableInTicket` ticket gating.
    expect((adapter as { notImplemented?: boolean }).notImplemented).toBeUndefined();
    expect(
      (adapter as { availableInTicket?: string }).availableInTicket
    ).toBeUndefined();
  });

  it('returns ChileSIIAdapter for "CL" (real DTE 1.0 emission shipped in ENG-036b)', () => {
    const adapter = getFiscalAdapter('CL');
    expect(adapter).toBeInstanceOf(ChileSIIAdapter);
    expect(adapter.countryCode).toBe('CL');
    // ENG-036b lifted the notImplemented stub; the adapter is now a
    // full FiscalAdapter implementation. ENG-036c adds SII transmission
    // and real signing, but the top-level availableInTicket marker is
    // gone now that the adapter serializes valid DTE XML drafts.
    expect(
      (adapter as { availableInTicket?: string }).availableInTicket
    ).toBeUndefined();
  });

  it('THROWS FISCAL_PACK_NOT_AVAILABLE for an unsupported country code (ENG-185)', () => {
    // ENG-185 — no more Colombia fallback. Emitting a Colombia-shaped
    // CUFE for an Argentine tenant is a lie; the registry must fail with
    // a typed error so the sale path can skip emission cleanly instead.
    let caught: unknown;
    try {
      getFiscalAdapter('AR');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe(
      'FISCAL_PACK_NOT_AVAILABLE'
    );
  });

  it('exposes the default country constant', () => {
    expect(DEFAULT_FISCAL_COUNTRY).toBe('CO');
  });
});

describe('isSupportedFiscalCountry + maturity (ENG-185)', () => {
  it('recognises only CO/MX/CL as supported', () => {
    expect(isSupportedFiscalCountry('CO')).toBe(true);
    expect(isSupportedFiscalCountry('MX')).toBe(true);
    expect(isSupportedFiscalCountry('CL')).toBe(true);
    expect(isSupportedFiscalCountry('AR')).toBe(false);
    expect(isSupportedFiscalCountry('US')).toBe(false);
    expect(isSupportedFiscalCountry('')).toBe(false);
    expect([...SUPPORTED_FISCAL_COUNTRIES].sort()).toEqual(['CL', 'CO', 'MX']);
  });

  it('marks CO as mock and MX/CL as draft (no production pack ships yet)', () => {
    expect(getFiscalAdapter('CO').maturity).toBe('mock');
    expect(getFiscalAdapter('MX').maturity).toBe('draft');
    expect(getFiscalAdapter('CL').maturity).toBe('draft');
  });

  it('describeFiscalProvider maps a stored providerId to its maturity', () => {
    expect(describeFiscalProvider('mock-co')).toEqual({
      maturity: 'mock',
      countryCode: 'CO',
    });
    expect(describeFiscalProvider('cfdi-mx')).toEqual({
      maturity: 'draft',
      countryCode: 'MX',
    });
    expect(describeFiscalProvider('sii-cl')).toEqual({
      maturity: 'draft',
      countryCode: 'CL',
    });
    expect(describeFiscalProvider('unknown-provider')).toBeNull();
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
      isImplemented: true,
      availableInTicket: undefined,
    });
    // ENG-036b — Chile is now implemented for unsigned DTE 1.0 emission.
    // The remaining gap (signing + SII transmission) lives on the adapter
    // methods (voidDocument throws ENG-036c) but the top-level marker is
    // unset because the registry's `isImplemented` flag covers "any of the
    // emission API actually works" — and issue() does.
    expect(byCode.get('CL')).toEqual({
      code: 'CL',
      isImplemented: true,
      availableInTicket: undefined,
    });
  });
});
