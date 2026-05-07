/**
 * ENG-036a / ENG-036b — Tests del ChileSIIAdapter.
 *
 * Cobertura:
 *   - validateConfig: probes individuales (RUT, giro, comuna,
 *     casa matriz, ambiente) — heredados de ENG-036a.
 *   - issue: emite DTE estructural cuando settings + allocation OK;
 *     levanta FISCAL_PACK_NOT_AVAILABLE cuando settings o allocation
 *     faltan.
 *   - voidDocument + fetchStatus: stubs apuntando a ENG-036c.
 */

import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import type {
  FiscalAdapterConfig,
  FiscalAdapterIssueInput,
  FiscalAdapterLine,
} from '../../../adapter.js';
import { ServerErrorWithCode } from '../../../../../lib/errorCodes.js';
import type { ChileFolioAllocation } from '../caf-allocator.js';
import { ChileSIIAdapter } from '../chile-adapter.js';

const baseLine: FiscalAdapterLine = {
  lineNumber: 1,
  productName: 'Producto demo',
  productSku: 'SKU-001',
  unitMeasureCode: 'unit',
  quantity: 1,
  unitPrice: 1190,
  discountAmount: 0,
  taxRate: 19,
  taxAmount: 190,
  taxCategoryCode: '01',
  lineTotal: 1190,
};

const baseAllocation: ChileFolioAllocation = {
  cafId: 'caf-1',
  folio: 7,
  tipoDte: '39',
  rutEmisor: '76123456-0',
  rawCafXml:
    '<AUTORIZACION><CAF version="1.0"><DA><RE>76123456-0</RE><RS>DEMO</RS></DA></CAF></AUTORIZACION>',
  rangeRemaining: 93,
};

const validClSettings = {
  fiscal: {
    cl: {
      enabled: true,
      rut: '76123456-0',
      giroCode: '4711',
      comunaCode: 13101,
      casaMatriz: 'Av. Principal 123, Santiago',
      environment: 'certificacion',
    },
  },
};

function buildIssueInput(
  overrides: Partial<FiscalAdapterIssueInput> = {}
): FiscalAdapterIssueInput {
  return {
    tenantId: 'tenant-1',
    source: 'sale',
    sourceId: 'sale-1',
    kind: 'DEE',
    issueDate: '2026-05-07',
    issueTime: '10:30:00',
    environment: '2',
    issuerNit: 'tenant-1',
    issuerName: 'Empresa Demo SA',
    currencyCode: 'CLP',
    localeCode: 'es-CL',
    paymentMethod: 'cash',
    tenantSettings: validClSettings,
    chileAllocation: baseAllocation,
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
    subtotal: 1000,
    ivaAmount: 190,
    incAmount: 0,
    icaAmount: 0,
    discountAmount: 0,
    totalAmount: 1190,
    lines: [baseLine],
    ...overrides,
  };
}

describe('ChileSIIAdapter.validateConfig (ENG-036a regression)', () => {
  it('returns ok=true when every setting is captured', async () => {
    const adapter = new ChileSIIAdapter();
    const cfg: FiscalAdapterConfig = {
      tenantId: 't1',
      countryCode: 'CL',
      settings: validClSettings,
    };
    const result = await adapter.validateConfig(cfg);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('reports MISSING_RUT when rut is empty', async () => {
    const adapter = new ChileSIIAdapter();
    const result = await adapter.validateConfig({
      tenantId: 't1',
      countryCode: 'CL',
      settings: {
        fiscal: { cl: { ...validClSettings.fiscal.cl, rut: null } },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'MISSING_RUT')).toBe(true);
  });

  it('reports MISSING_RESOLUTION when giroCode is invalid', async () => {
    const adapter = new ChileSIIAdapter();
    const result = await adapter.validateConfig({
      tenantId: 't1',
      countryCode: 'CL',
      settings: {
        fiscal: { cl: { ...validClSettings.fiscal.cl, giroCode: '9999' } },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.code === 'MISSING_RESOLUTION')).toBe(true);
  });
});

describe('ChileSIIAdapter.issue (ENG-036b)', () => {
  it('emits a DTE 1.0 XML draft with status=pending and a sii-cl cufe', async () => {
    const adapter = new ChileSIIAdapter();
    const result = await adapter.issue(buildIssueInput());

    expect(result.status).toBe('pending');
    expect(result.cufe).toBe('sii-cl:76123456-0:39:7');
    expect(result.providerId).toBe('sii-cl');
    expect(result.xmlRef).not.toBeNull();
    expect(result.xmlRef!.length).toBeGreaterThan(500);
    expect(result.xmlRef).toContain('<DTE');
    expect(result.xmlRef).toContain('xmlns="http://www.sii.cl/SiiDte"');

    // providerResponse carries observability metadata.
    const pr = result.providerResponse as Record<string, unknown>;
    expect(pr.kind).toBe('unsigned-draft');
    expect(pr.cafId).toBe('caf-1');
    expect(pr.folio).toBe(7);
    expect(pr.tipoDte).toBe('39');
  });

  it('throws FISCAL_PACK_NOT_AVAILABLE when settings are missing', async () => {
    const adapter = new ChileSIIAdapter();
    try {
      await adapter.issue(
        buildIssueInput({
          tenantSettings: { fiscal: { cl: { enabled: false } } },
        })
      );
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const cause = (err as TRPCError).cause;
      expect(cause).toBeInstanceOf(ServerErrorWithCode);
      expect((cause as ServerErrorWithCode).errorCode).toBe(
        'FISCAL_PACK_NOT_AVAILABLE'
      );
    }
  });

  it('throws FISCAL_PACK_NOT_AVAILABLE when chileAllocation is missing', async () => {
    const adapter = new ChileSIIAdapter();
    try {
      await adapter.issue(buildIssueInput({ chileAllocation: undefined }));
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const cause = (err as TRPCError).cause;
      expect(cause).toBeInstanceOf(ServerErrorWithCode);
      expect((cause as ServerErrorWithCode).errorCode).toBe(
        'FISCAL_PACK_NOT_AVAILABLE'
      );
    }
  });
});

describe('ChileSIIAdapter.voidDocument + fetchStatus (ENG-036c stubs)', () => {
  it('voidDocument throws FISCAL_PACK_NOT_AVAILABLE pointing to ENG-036c', async () => {
    const adapter = new ChileSIIAdapter();
    try {
      await adapter.voidDocument({
        tenantId: 't1',
        cufe: 'sii-cl:76123456-0:39:7',
        reasonCode: 'CANCEL',
      });
      throw new Error('expected to throw');
    } catch (err) {
      const cause = (err as TRPCError).cause;
      expect((cause as ServerErrorWithCode).errorCode).toBe('FISCAL_PACK_NOT_AVAILABLE');
      expect((cause as ServerErrorWithCode).details).toMatchObject({
        availableInTicket: 'ENG-036c',
      });
    }
  });

  it('fetchStatus returns "pending" until ENG-036c lands the SII poller', async () => {
    const adapter = new ChileSIIAdapter();
    const status = await adapter.fetchStatus('sii-cl:76123456-0:39:7');
    expect(status).toBe('pending');
  });
});
