/**
 * ENG-034 + ENG-035a + ENG-036a — Tests de `validateConfig` por pack.
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
 * - ChileSIIAdapter (ENG-036a) → ok=false con MISSING_RUT /
 *   MISSING_RESOLUTION / MISSING_CERTIFICATE cuando los settings
 *   están vacíos; ok=true cuando RUT válido + giro CIIU.cl +
 *   casa matriz + comuna SUBDERE válida.
 */

import { describe, expect, it } from 'vitest';
import { ColombiaMockAdapter } from '../services/fiscal/packs/co/mock-adapter.js';
import { MexicoCFDIAdapter } from '../services/fiscal/packs/mx/mexico-adapter.js';
import { ChileSIIAdapter } from '../services/fiscal/packs/cl/chile-adapter.js';
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

});

describe('ChileSIIAdapter.validateConfig (ENG-036a)', () => {
  it('settings vacíos → ok=false con MISSING_RUT + MISSING_RESOLUTION + MISSING_CERTIFICATE (×2)', async () => {
    const adapter = new ChileSIIAdapter();
    const result = await adapter.validateConfig(baseConfig('CL'));
    expect(result.ok).toBe(false);
    const codes = result.issues.map(issue => issue.code).sort();
    // Casa matriz + comuna ambos faltan → 2 issues con
    // MISSING_CERTIFICATE; RUT y giro 1 issue cada uno.
    expect(codes).toEqual([
      'MISSING_CERTIFICATE',
      'MISSING_CERTIFICATE',
      'MISSING_RESOLUTION',
      'MISSING_RUT',
    ]);
  });

  it('settings completos y válidos → ok=true sin issues', async () => {
    const adapter = new ChileSIIAdapter();
    const result = await adapter.validateConfig(
      baseConfig('CL', {
        fiscal: {
          cl: {
            enabled: true,
            // RUT genérico extranjero — el SII lo acepta sin
            // checksum estricto.
            rut: '55555555-5',
            giroCode: '4711',
            comunaCode: 13101,
            casaMatriz: 'Av Apoquindo 4500',
            environment: 'certificacion',
          },
        },
      })
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('RUT inválido → ok=false con MISSING_RUT apuntando a fiscal.cl.rut', async () => {
    const adapter = new ChileSIIAdapter();
    const result = await adapter.validateConfig(
      baseConfig('CL', {
        fiscal: {
          cl: {
            enabled: true,
            rut: 'BAD123',
            giroCode: '4711',
            comunaCode: 13101,
            casaMatriz: 'Av Apoquindo 4500',
            environment: 'certificacion',
          },
        },
      })
    );
    expect(result.ok).toBe(false);
    const rutIssue = result.issues.find(issue => issue.code === 'MISSING_RUT');
    expect(rutIssue).toBeDefined();
    expect(rutIssue?.field).toBe('fiscal.cl.rut');
  });

  it('giro fuera del catálogo CIIU.cl → MISSING_RESOLUTION', async () => {
    const adapter = new ChileSIIAdapter();
    const result = await adapter.validateConfig(
      baseConfig('CL', {
        fiscal: {
          cl: {
            enabled: true,
            rut: '55555555-5',
            giroCode: '9999', // no existe
            comunaCode: 13101,
            casaMatriz: 'Av Apoquindo 4500',
            environment: 'certificacion',
          },
        },
      })
    );
    expect(result.ok).toBe(false);
    const giroIssue = result.issues.find(
      issue => issue.code === 'MISSING_RESOLUTION'
    );
    expect(giroIssue).toBeDefined();
    expect(giroIssue?.field).toBe('fiscal.cl.giroCode');
  });

  it('comuna fuera del catálogo SUBDERE → MISSING_CERTIFICATE', async () => {
    const adapter = new ChileSIIAdapter();
    const result = await adapter.validateConfig(
      baseConfig('CL', {
        fiscal: {
          cl: {
            enabled: true,
            rut: '55555555-5',
            giroCode: '4711',
            comunaCode: 99999, // no existe
            casaMatriz: 'Av Apoquindo 4500',
            environment: 'certificacion',
          },
        },
      })
    );
    expect(result.ok).toBe(false);
    const comunaIssue = result.issues.find(
      issue =>
        issue.code === 'MISSING_CERTIFICATE' &&
        issue.field === 'fiscal.cl.comunaCode'
    );
    expect(comunaIssue).toBeDefined();
  });

  it('issue() con settings vacíos tira FISCAL_PACK_NOT_AVAILABLE (ENG-036b shipped real emission)', async () => {
    // ENG-036b lifted the unconditional stub: issue() now serializes
    // a real DTE 1.0 XML draft when settings + chileAllocation are
    // populated. With empty settings the adapter still surfaces
    // FISCAL_PACK_NOT_AVAILABLE so the orchestrator skips emission.
    const adapter = new ChileSIIAdapter();
    let caught: unknown;
    try {
      await adapter.issue({
        tenantId: 't1',
        source: 'sale',
        sourceId: 's1',
        kind: 'DEE',
        issueDate: '2026-05-07',
        issueTime: '10:00:00',
        environment: '2',
        issuerNit: 't1',
        currencyCode: 'CLP',
        localeCode: 'es-CL',
        resolution: {
          id: 'r1',
          resolutionNumber: 'R-001',
          prefix: 'B',
          technicalKey: 't',
          consecutive: 1,
          documentNumber: 'B0000000001',
        },
        buyer: {
          taxId: '222222222222',
          taxIdTypeCode: 'NIT',
          name: 'Consumidor final',
          email: null,
          address: null,
          city: null,
          department: null,
          country: 'CL',
        },
        subtotal: 0,
        ivaAmount: 0,
        incAmount: 0,
        icaAmount: 0,
        discountAmount: 0,
        totalAmount: 0,
        lines: [],
        // tenantSettings missing → adapter falls back to defaults
        // (enabled=false) and trips the FISCAL_PACK_NOT_AVAILABLE
        // branch before the allocation check.
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as {
      cause?: { errorCode?: string; details?: { countryCode?: string } };
    }).cause;
    expect(cause?.errorCode).toBe('FISCAL_PACK_NOT_AVAILABLE');
    expect(cause?.details?.countryCode).toBe('CL');
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

  // ENG-035b promovió `issue()` de stub a emisión real. La cobertura
  // exhaustiva del happy path + edge cases vive en
  // `fiscal-mx-adapter.test.ts`. Aquí solo verificamos que cuando los
  // settings están incompletos (RFC ausente) el adapter levanta
  // `FISCAL_PACK_NOT_AVAILABLE` con el mensaje guía.
  it('issue() rechaza cuando settings MX están vacíos (sin RFC)', async () => {
    const adapter = new MexicoCFDIAdapter();
    let caught: unknown;
    try {
      await adapter.issue({
        tenantId: 't1',
        source: 'sale',
        sourceId: 's1',
        kind: 'DEE',
        issueDate: '2026-05-01',
        issueTime: '10:00:00Z',
        environment: '2',
        issuerNit: 't1',
        currencyCode: 'MXN',
        localeCode: 'es-MX',
        resolution: {
          id: 'r1',
          resolutionNumber: 'R-001',
          prefix: 'F',
          technicalKey: 'k1',
          consecutive: 1,
          documentNumber: 'F0000000001',
        },
        buyer: {
          taxId: '222222222222',
          taxIdTypeCode: '31',
          name: 'Consumidor final',
          email: null,
          address: null,
          city: null,
          department: null,
          country: null,
        },
        subtotal: 100,
        ivaAmount: 16,
        incAmount: 0,
        icaAmount: 0,
        discountAmount: 0,
        totalAmount: 116,
        lines: [],
        // tenantSettings vacío → readMxFiscalSettings devuelve defaults
        // → adapter levanta FISCAL_PACK_NOT_AVAILABLE.
        tenantSettings: {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as {
      cause?: { errorCode?: string; details?: { missingSettings?: boolean } };
    }).cause;
    expect(cause?.errorCode).toBe('FISCAL_PACK_NOT_AVAILABLE');
    expect(cause?.details?.missingSettings).toBe(true);
  });
});
