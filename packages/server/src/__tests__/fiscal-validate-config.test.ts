/**
 * ENG-034 — `validateConfig` per-pack tests.
 *
 * The pre-flight readiness check is what the future fiscal-readiness
 * admin card will call to surface a green/red badge per country.
 * Each pack reports its own issue codes:
 *
 * - ColombiaMockAdapter → ok=true, no issues (mock has no real
 *   config; ENG-021 will replace with NIT / certificate / resolution
 *   / environment probes).
 * - MexicoNotImplementedAdapter → ok=false, single
 *   PACK_NOT_AVAILABLE issue referencing ENG-035.
 * - ChileNotImplementedAdapter → ok=false, single
 *   PACK_NOT_AVAILABLE issue referencing ENG-036.
 */

import { describe, expect, it } from 'vitest';
import { ColombiaMockAdapter } from '../services/fiscal/packs/co/mock-adapter.js';
import { MexicoNotImplementedAdapter } from '../services/fiscal/packs/mx/mexico-adapter.js';
import { ChileNotImplementedAdapter } from '../services/fiscal/packs/cl/chile-adapter.js';
import type { FiscalAdapterConfig } from '../services/fiscal/adapter.js';

const baseConfig = (countryCode: string): FiscalAdapterConfig => ({
  tenantId: 'tenant-test',
  countryCode,
  settings: {},
});

describe('validateConfig (ENG-034)', () => {
  it('ColombiaMockAdapter reports ok=true with zero issues', async () => {
    const adapter = new ColombiaMockAdapter();
    const result = await adapter.validateConfig(baseConfig('CO'));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('MexicoNotImplementedAdapter reports PACK_NOT_AVAILABLE referencing ENG-035', async () => {
    const adapter = new MexicoNotImplementedAdapter();
    const result = await adapter.validateConfig(baseConfig('MX'));
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual({
      code: 'PACK_NOT_AVAILABLE',
      field: 'countryCode',
      message: 'Mexico CFDI 4.0 pack lands with ENG-035.',
    });
  });

  it('ChileNotImplementedAdapter reports PACK_NOT_AVAILABLE referencing ENG-036', async () => {
    const adapter = new ChileNotImplementedAdapter();
    const result = await adapter.validateConfig(baseConfig('CL'));
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual({
      code: 'PACK_NOT_AVAILABLE',
      field: 'countryCode',
      message: 'Chile SII pack lands with ENG-036.',
    });
  });

  it('MexicoNotImplementedAdapter throws FISCAL_PACK_NOT_AVAILABLE on issue()', async () => {
    const adapter = new MexicoNotImplementedAdapter();
    // The throwServerError helper wraps with TRPCError; extract the cause.
    let caught: unknown;
    try {
      await adapter.issue();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { errorCode?: string } }).cause;
    expect(cause?.errorCode).toBe('FISCAL_PACK_NOT_AVAILABLE');
  });

  it('ChileNotImplementedAdapter throws FISCAL_PACK_NOT_AVAILABLE on issue()', async () => {
    const adapter = new ChileNotImplementedAdapter();
    let caught: unknown;
    try {
      await adapter.issue();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { errorCode?: string } }).cause;
    expect(cause?.errorCode).toBe('FISCAL_PACK_NOT_AVAILABLE');
  });
});
