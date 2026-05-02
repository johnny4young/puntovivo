/**
 * ENG-035b — Tests del MexicoCFDIAdapter post-promoción a real.
 *
 * Cubren:
 * - issue() con settings completos retorna shape correcta + XML.
 * - issue() para source='return' incluye CfdiRelacionados.
 * - issue() para source='void' también emite Egreso (NO llama PAC).
 * - issue() rechaza con FISCAL_PACK_NOT_AVAILABLE cuando faltan
 *   settings.
 * - voidDocument() (cancelación SAT explícita) sigue parqueado.
 * - fetchStatus() retorna 'pending'.
 * - validateConfig() funciona como en ENG-035a.
 */
import { describe, expect, it } from 'vitest';
import type { FiscalAdapterIssueInput } from '../services/fiscal/adapter.js';
import { MexicoCFDIAdapter } from '../services/fiscal/packs/mx/mexico-adapter.js';

const completedMxSettings = {
  fiscal: {
    mx: {
      enabled: true,
      rfc: 'AAA010101AAA',
      regimenFiscalCode: '601',
      lugarExpedicion: '06700',
      environment: 'sandbox',
    },
  },
};

function baseIssueInput(
  overrides: Partial<FiscalAdapterIssueInput> = {}
): FiscalAdapterIssueInput {
  return {
    tenantId: 'tenant-1',
    source: 'sale',
    sourceId: 'sale-1',
    kind: 'DEE',
    issueDate: '2026-05-01',
    issueTime: '10:30:00Z',
    environment: '2',
    issuerNit: 'tenant-1',
    issuerName: 'Empresa Demo SA',
    currencyCode: 'MXN',
    localeCode: 'es-MX',
    paymentMethod: 'cash',
    resolution: {
      id: 'r1',
      resolutionNumber: 'R-001',
      prefix: 'F',
      technicalKey: 'k',
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
    lines: [
      {
        lineNumber: 1,
        productName: 'Producto demo',
        productSku: 'SKU-001',
        unitMeasureCode: 'unit',
        quantity: 1,
        unitPrice: 116,
        discountAmount: 0,
        taxRate: 16,
        taxAmount: 16,
        taxCategoryCode: '01',
        lineTotal: 116,
      },
    ],
    tenantSettings: completedMxSettings,
    ...overrides,
  };
}

describe('MexicoCFDIAdapter.issue (ENG-035b)', () => {
  it('settings completos → retorna cufe (uuid), status pending, xmlRef poblado', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.issue(baseIssueInput());

    expect(result.cufe).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.status).toBe('pending');
    expect(result.providerId).toBe('cfdi-mx');
    expect(result.xmlRef).toBeTruthy();
    expect(result.xmlRef!.startsWith('<?xml')).toBe(true);
    expect(result.xmlRef!.length).toBeGreaterThan(200);
  });

  it('providerResponse expone metadata útil para auditoría', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.issue(baseIssueInput());

    expect(result.providerResponse).toMatchObject({
      kind: 'unsigned-draft',
      emisorRfc: 'AAA010101AAA',
      receptorRfc: 'XAXX010101000', // consumidor final
      tipoComprobante: 'I',
    });
    expect(typeof (result.providerResponse as Record<string, unknown>).xmlSize).toBe(
      'number'
    );
  });

  it('source=return + originalCufe → tipoComprobante=E con CfdiRelacionados', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.issue(
      baseIssueInput({
        source: 'return',
        kind: 'NC',
        originalCufe: '11111111-1111-4111-8111-111111111111',
      })
    );

    const meta = result.providerResponse as Record<string, unknown>;
    expect(meta.tipoComprobante).toBe('E');
    expect(result.xmlRef).toContain('CfdiRelacionados');
    expect(result.xmlRef).toContain('TipoRelacion="01"');
    expect(result.xmlRef).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('source=void + originalCufe → también emite Egreso con CfdiRelacionados', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.issue(
      baseIssueInput({
        source: 'void',
        kind: 'ND',
        originalCufe: '22222222-2222-4222-8222-222222222222',
      })
    );

    const meta = result.providerResponse as Record<string, unknown>;
    expect(meta.tipoComprobante).toBe('E');
    expect(result.xmlRef).toContain('22222222-2222-4222-8222-222222222222');
  });

  it('settings vacíos (sin RFC) → throw FISCAL_PACK_NOT_AVAILABLE', async () => {
    const adapter = new MexicoCFDIAdapter();
    let caught: unknown;
    try {
      await adapter.issue(baseIssueInput({ tenantSettings: {} }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as {
      cause?: {
        errorCode?: string;
        details?: { missingSettings?: boolean; disabled?: boolean };
      };
    }).cause;
    expect(cause?.errorCode).toBe('FISCAL_PACK_NOT_AVAILABLE');
    expect(cause?.details?.disabled).toBe(true);
    expect(cause?.details?.missingSettings).toBe(true);
  });

  it('settings completos pero disabled → throw FISCAL_PACK_NOT_AVAILABLE', async () => {
    const adapter = new MexicoCFDIAdapter();
    let caught: unknown;
    try {
      await adapter.issue(
        baseIssueInput({
          tenantSettings: {
            fiscal: {
              mx: {
                enabled: false,
                rfc: 'AAA010101AAA',
                regimenFiscalCode: '601',
                lugarExpedicion: '06700',
                environment: 'sandbox',
              },
            },
          },
        })
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as {
      cause?: { errorCode?: string; details?: { disabled?: boolean } };
    }).cause;
    expect(cause?.errorCode).toBe('FISCAL_PACK_NOT_AVAILABLE');
    expect(cause?.details?.disabled).toBe(true);
  });

  it('settings con RFC pero sin lugarExpedicion → throw FISCAL_PACK_NOT_AVAILABLE', async () => {
    const adapter = new MexicoCFDIAdapter();
    let caught: unknown;
    try {
      await adapter.issue(
        baseIssueInput({
          tenantSettings: {
            fiscal: {
              mx: {
                enabled: true,
                rfc: 'AAA010101AAA',
                regimenFiscalCode: '601',
                // lugarExpedicion ausente
                environment: 'sandbox',
              },
            },
          },
        })
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
  });

  it('emisorName se inyecta en cfdi:Emisor.Nombre cuando llega via input.issuerName', async () => {
    const adapter = new MexicoCFDIAdapter();
    const result = await adapter.issue(
      baseIssueInput({ issuerName: 'Tienda Polanco SA de CV' })
    );
    expect(result.xmlRef).toContain('Tienda Polanco SA de CV');
  });
});

describe('MexicoCFDIAdapter.voidDocument (ENG-035b)', () => {
  it('cancelación SAT explícita sigue parqueada apuntando a ENG-035c', async () => {
    const adapter = new MexicoCFDIAdapter();
    let caught: unknown;
    try {
      await adapter.voidDocument({
        tenantId: 'tenant-1',
        cufe: 'some-uuid',
        reasonCode: '01',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as {
      cause?: { errorCode?: string; details?: { availableInTicket?: string } };
    }).cause;
    expect(cause?.errorCode).toBe('FISCAL_PACK_NOT_AVAILABLE');
    expect(cause?.details?.availableInTicket).toBe('ENG-035c');
  });
});

describe('MexicoCFDIAdapter.fetchStatus (ENG-035b)', () => {
  it('retorna pending sin PAC', async () => {
    const adapter = new MexicoCFDIAdapter();
    const status = await adapter.fetchStatus('whatever-cufe');
    expect(status).toBe('pending');
  });
});

describe('MexicoCFDIAdapter capabilities (ENG-035b)', () => {
  it('reporta capabilities consistentes con el ticket de cierre', () => {
    const adapter = new MexicoCFDIAdapter();
    expect(adapter.countryCode).toBe('MX');
    expect(adapter.providerId).toBe('cfdi-mx');
    expect(adapter.capabilities).toMatchObject({
      supportsVoid: false,
      supportsDebitNote: false,
      supportsFetchStatus: false,
    });
  });
});
