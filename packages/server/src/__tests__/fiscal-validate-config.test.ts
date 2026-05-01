/**
 * ENG-034 + ENG-035a — Tests de `validateConfig` por pack.
 *
 * El probe de pre-flight es lo que la futura card de readiness
 * fiscal va a consumir para pintar el badge verde/rojo por país.
 * Cada pack reporta sus propios issue codes:
 *
 * - ColombiaMockAdapter → ok=true, sin issues (mock no tiene config
 *   real; ENG-021 lo reemplaza con probe de NIT / certificado /
 *   resolución / ambiente).
 * - MexicoCFDIAdapter (ENG-035a) → ok=false con MISSING_RFC /
 *   MISSING_RESOLUTION / MISSING_CERTIFICATE cuando los settings
 *   están vacíos; ok=true cuando RFC válido + régimen válido +
 *   lugar de expedición de 5 dígitos.
 * - ChileNotImplementedAdapter → ok=false, single
 *   PACK_NOT_AVAILABLE issue apuntando a ENG-036.
 */

import { describe, expect, it } from 'vitest';
import { ColombiaMockAdapter } from '../services/fiscal/packs/co/mock-adapter.js';
import { MexicoCFDIAdapter } from '../services/fiscal/packs/mx/mexico-adapter.js';
import { ChileNotImplementedAdapter } from '../services/fiscal/packs/cl/chile-adapter.js';
import type { FiscalAdapterConfig } from '../services/fiscal/adapter.js';

const baseConfig = (
  countryCode: string,
  settings: Record<string, unknown> = {}
): FiscalAdapterConfig => ({
  tenantId: 'tenant-test',
  countryCode,
  settings,
});

describe('validateConfig (ENG-034 + ENG-035a)', () => {
  it('ColombiaMockAdapter reporta ok=true sin issues', async () => {
    const adapter = new ColombiaMockAdapter();
    const result = await adapter.validateConfig(baseConfig('CO'));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('ChileNotImplementedAdapter reporta PACK_NOT_AVAILABLE apuntando a ENG-036', async () => {
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

  it('ChileNotImplementedAdapter tira FISCAL_PACK_NOT_AVAILABLE en issue()', async () => {
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

describe('MexicoCFDIAdapter.validateConfig (ENG-035a)', () => {
  it('settings vacíos → ok=false con MISSING_RFC + MISSING_RESOLUTION + MISSING_CERTIFICATE', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.validateConfig(baseConfig('MX'));
    expect(result.ok).toBe(false);
    const codes = result.issues.map(issue => issue.code).sort();
    expect(codes).toEqual([
      'MISSING_CERTIFICATE',
      'MISSING_RESOLUTION',
      'MISSING_RFC',
    ]);
  });

  it('settings completos y válidos → ok=true sin issues', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.validateConfig(
      baseConfig('MX', {
        fiscal: {
          mx: {
            enabled: true,
            // RFC genérico extranjero — el SAT lo acepta como
            // fixture de prueba sin homoclave estricta.
            rfc: 'XEXX010101000',
            regimenFiscalCode: '601',
            lugarExpedicion: '06700',
            environment: 'sandbox',
          },
        },
      })
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('RFC inválido → ok=false con MISSING_RFC apuntando a fiscal.mx.rfc', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.validateConfig(
      baseConfig('MX', {
        fiscal: {
          mx: {
            enabled: true,
            rfc: 'BAD123', // longitud incorrecta
            regimenFiscalCode: '601',
            lugarExpedicion: '06700',
            environment: 'sandbox',
          },
        },
      })
    );
    expect(result.ok).toBe(false);
    const rfcIssue = result.issues.find(issue => issue.code === 'MISSING_RFC');
    expect(rfcIssue).toBeDefined();
    expect(rfcIssue?.field).toBe('fiscal.mx.rfc');
  });

  it('régimen fiscal no presente en catálogo → MISSING_RESOLUTION', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.validateConfig(
      baseConfig('MX', {
        fiscal: {
          mx: {
            enabled: true,
            rfc: 'XEXX010101000',
            regimenFiscalCode: '999', // no existe
            lugarExpedicion: '06700',
            environment: 'sandbox',
          },
        },
      })
    );
    expect(result.ok).toBe(false);
    const regimenIssue = result.issues.find(
      issue => issue.code === 'MISSING_RESOLUTION'
    );
    expect(regimenIssue).toBeDefined();
    expect(regimenIssue?.field).toBe('fiscal.mx.regimenFiscalCode');
  });

  it('lugar de expedición que no es 5 dígitos → MISSING_CERTIFICATE', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.validateConfig(
      baseConfig('MX', {
        fiscal: {
          mx: {
            enabled: true,
            rfc: 'XEXX010101000',
            regimenFiscalCode: '601',
            lugarExpedicion: '12', // 2 dígitos
            environment: 'sandbox',
          },
        },
      })
    );
    expect(result.ok).toBe(false);
    const lugarIssue = result.issues.find(
      issue => issue.code === 'MISSING_CERTIFICATE'
    );
    expect(lugarIssue).toBeDefined();
    expect(lugarIssue?.field).toBe('fiscal.mx.lugarExpedicion');
  });

  it('issue() tira FISCAL_PACK_NOT_AVAILABLE apuntando a ENG-035b', async () => {
    const adapter = new MexicoCFDIAdapter();
    let caught: unknown;
    try {
      await adapter.issue();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as {
      cause?: { errorCode?: string; details?: { availableInTicket?: string } };
    }).cause;
    expect(cause?.errorCode).toBe('FISCAL_PACK_NOT_AVAILABLE');
    expect(cause?.details?.availableInTicket).toBe('ENG-035b');
  });
});
