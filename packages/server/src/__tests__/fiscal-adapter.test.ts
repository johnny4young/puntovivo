/**
 * `ColombiaMockAdapter` tests (renamed in  from
 * `MockAdapter` when the file moved into `services/fiscal/packs/co/`).
 *
 * The mock is the reference implementation of `FiscalAdapter` for
 * Colombia and the entry point every orchestrator test routes
 * through. Coverage:
 *
 * - `issue()` emits a CUDE (software PIN) for the POS documento
 * equivalente and notes, and a CUFE (technical key) only for the FEV.
 * - The hashed issuer NIT comes from `fiscal.co.nit` without its DV.
 * - Default status is `'sent'`; the contingencyOracle hook can force
 * `'contingency'` for offline-path tests.
 * - `voidDocument()` returns a distinct CUFE from the original so the
 * unique index on `fiscal_documents.cufe` never collides.
 * - `fetchStatus()` returns `'accepted'` (mock terminal state).
 * - `capabilities` are stable.
 */

import { describe, expect, it } from 'vitest';
import { computeCude } from '../services/fiscal/cude.js';
import { computeCufe, type DianDocumentHashFields } from '../services/fiscal/cufe.js';
import { ColombiaMockAdapter } from '../services/fiscal/packs/co/mock-adapter.js';
import type { FiscalAdapterIssueInput } from '../services/fiscal/adapter.js';

const CO_SETTINGS = {
  fiscal: { co: { nit: '900.373.115-3', softwareId: 'sw-1', softwarePin: '12301' } },
};

function buildIssueInput(
  overrides: Partial<FiscalAdapterIssueInput> = {}
): FiscalAdapterIssueInput {
  return {
    tenantId: 'tenant-1',
    tenantSettings: CO_SETTINGS,
    source: 'sale',
    sourceId: 'sale-1',
    kind: 'DEE',
    issueDate: '2026-04-24',
    issueTime: '10:00:00-05:00',
    environment: '2',
    issuerNit: '900100200',
    currencyCode: 'COP',
    localeCode: 'es-CO',
    resolution: {
      id: 'res-1',
      resolutionNumber: '18760000001',
      prefix: 'SETP',
      technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
      consecutive: 1,
      documentNumber: 'SETP9900000001',
    },
    buyer: {
      taxId: '800123456',
      taxIdTypeCode: '31',
      name: 'Test Buyer',
      email: null,
      address: null,
      city: null,
      department: null,
      country: 'CO',
    },
    subtotal: 100,
    ivaAmount: 19,
    incAmount: 0,
    icaAmount: 0,
    discountAmount: 0,
    totalAmount: 119,
    lines: [
      {
        lineNumber: 1,
        productName: 'Sample Product',
        productSku: 'SP-01',
        unitMeasureCode: 'EA',
        quantity: 1,
        unitPrice: 100,
        discountAmount: 0,
        taxRate: 19,
        taxAmount: 19,
        taxCategoryCode: '01',
        lineTotal: 119,
      },
    ],
    ...overrides,
  };
}

function hashFields(input: FiscalAdapterIssueInput, issuerNit: string): DianDocumentHashFields {
  return {
    documentNumber: input.resolution.documentNumber,
    issueDate: input.issueDate,
    issueTime: input.issueTime,
    subtotal: input.subtotal,
    ivaAmount: input.ivaAmount,
    incAmount: input.incAmount,
    icaAmount: input.icaAmount,
    totalAmount: input.totalAmount,
    issuerNit,
    buyerIdNumber: input.buyer.taxId,
    environment: input.environment,
  };
}

describe('ColombiaMockAdapter.issue', () => {
  it('keys the POS documento equivalente by the software PIN (CUDE)', async () => {
    const adapter = new ColombiaMockAdapter();
    const input = buildIssueInput({ tenantSettings: CO_SETTINGS });
    const result = await adapter.issue(input);

    expect(result.cufe).toBe(
      computeCude({ ...hashFields(input, '900373115'), softwarePin: '12301' })
    );
    expect(result.cufe).not.toBe(
      computeCufe({
        ...hashFields(input, '900373115'),
        technicalKey: input.resolution.technicalKey,
      })
    );
    expect(result.xmlRef).toContain('<cbc:InvoiceTypeCode>20</cbc:InvoiceTypeCode>');
    expect(result.xmlRef).toContain(
      `<cbc:UUID schemeID="2" schemeName="CUDE-SHA384">${result.cufe}</cbc:UUID>`
    );
  });

  it('keys the sales invoice by the resolution technical key (CUFE)', async () => {
    const adapter = new ColombiaMockAdapter();
    const input = buildIssueInput({ kind: 'FEV', tenantSettings: CO_SETTINGS });
    const result = await adapter.issue(input);

    expect(result.cufe).toBe(
      computeCufe({
        ...hashFields(input, '900373115'),
        technicalKey: input.resolution.technicalKey,
      })
    );
    expect(result.xmlRef).toContain('<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>');
    expect(result.xmlRef).toContain(
      `<cbc:UUID schemeID="2" schemeName="CUFE-SHA384">${result.cufe}</cbc:UUID>`
    );
  });

  it('keys credit and debit notes by the software PIN (CUDE)', async () => {
    const adapter = new ColombiaMockAdapter();
    const adjustmentCodes = {
      NC: '<cbc:CreditNoteTypeCode>94</cbc:CreditNoteTypeCode>',
      ND: '<cbc:DebitNoteTypeCode>93</cbc:DebitNoteTypeCode>',
    };
    for (const kind of ['NC', 'ND'] as const) {
      const input = buildIssueInput({ kind, tenantSettings: CO_SETTINGS });
      const result = await adapter.issue(input);
      expect(result.xmlRef).toContain(adjustmentCodes[kind]);
      expect(result.cufe).toBe(
        computeCude({ ...hashFields(input, '900373115'), softwarePin: '12301' })
      );
    }
  });

  it('hashes the buyer NIT without separators or verification digit', async () => {
    const adapter = new ColombiaMockAdapter();
    const plain = await adapter.issue(buildIssueInput({ tenantSettings: CO_SETTINGS }));
    const base = buildIssueInput();
    const formatted = await adapter.issue(
      buildIssueInput({
        tenantSettings: CO_SETTINGS,
        buyer: { ...base.buyer, taxId: '800.123.456-5' },
      })
    );
    expect(formatted.cufe).toBe(plain.cufe);

    // A stored NIT with a wrong DV must not glue the DV onto the number.
    const wrongDv = await adapter.issue(
      buildIssueInput({
        tenantSettings: CO_SETTINGS,
        buyer: { ...base.buyer, taxId: '800123456-0' },
      })
    );
    expect(wrongDv.cufe).toBe(plain.cufe);
  });

  it('writes the hashed issuer and buyer ids into the draft XML', async () => {
    const adapter = new ColombiaMockAdapter();
    const base = buildIssueInput();
    const result = await adapter.issue(
      buildIssueInput({
        tenantSettings: CO_SETTINGS,
        buyer: { ...base.buyer, taxId: '800.123.456-5' },
      })
    );
    expect(result.xmlRef).toContain('<cbc:CompanyID>900373115</cbc:CompanyID>');
    expect(result.xmlRef).toContain('<cbc:CompanyID>800123456</cbc:CompanyID>');
    expect(result.xmlRef).not.toContain('900100200');
  });

  it('emits the unsigned local draft shape', async () => {
    const result = await new ColombiaMockAdapter().issue(buildIssueInput());
    expect(result.status).toBe('sent');
    expect(result.providerId).toBe('mock-co');
    expect(result.xmlRef).toContain('local-unsigned-draft');
    expect(result.xmlRef).toContain('<cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity>');
    expect(result.providerResponse).toMatchObject({
      kind: 'local-unsigned-untransmitted-ubl-draft',
      signed: false,
      transmitted: false,
      certified: false,
    });
  });

  it('falls back to the orchestrator issuer id when no NIT is configured', async () => {
    const input = buildIssueInput({
      tenantSettings: { fiscal: { co: { softwareId: 'sw-1', softwarePin: '12301' } } },
    });
    const result = await new ColombiaMockAdapter().issue(input);
    expect(result.cufe).toBe(
      computeCude({ ...hashFields(input, input.issuerNit), softwarePin: '12301' })
    );
  });

  it('refuses a CUDE without a software PIN instead of hashing an empty one', async () => {
    const adapter = new ColombiaMockAdapter();
    await expect(adapter.issue(buildIssueInput({ tenantSettings: {} }))).rejects.toMatchObject({
      name: 'FiscalProviderError',
      normalizedKind: 'MALFORMED_REQUEST',
      providerCode: 'MISSING_SOFTWARE',
    });
    // The sales invoice is keyed by the resolution technical key instead.
    await expect(
      adapter.issue(buildIssueInput({ kind: 'FEV', tenantSettings: {} }))
    ).resolves.toMatchObject({ status: 'sent' });
  });

  it('routes the contingencyOracle hook to the emitted status', async () => {
    const adapter = new ColombiaMockAdapter({
      contingencyOracle: () => 'contingency',
    });
    const result = await adapter.issue(buildIssueInput());
    expect(result.status).toBe('contingency');
  });

  it('emits the frozen UN/ECE unit code in the local UBL draft without changing maturity', async () => {
    const adapter = new ColombiaMockAdapter();
    const input = buildIssueInput({
      lines: [{ ...buildIssueInput().lines[0]!, unitMeasureCode: 'KGM', quantity: 1.25 }],
    });
    const result = await adapter.issue(input);
    expect(result.xmlRef).toContain(
      '<cbc:InvoicedQuantity unitCode="KGM">1.25</cbc:InvoicedQuantity>'
    );
    expect(adapter.maturity).toBe('mock');
  });

  it('serializes frozen IVA and INC components from the same Colombian line', async () => {
    const adapter = new ColombiaMockAdapter();
    const baseLine = buildIssueInput().lines[0]!;
    const result = await adapter.issue(
      buildIssueInput({
        subtotal: 100,
        ivaAmount: 19,
        incAmount: 8,
        totalAmount: 127,
        lines: [
          {
            ...baseLine,
            unitPrice: 127,
            taxRate: 27,
            taxAmount: 27,
            lineTotal: 127,
            taxComponents: [
              {
                componentKey: 'vat:iva',
                taxKind: 'iva',
                taxRate: 19,
                taxableAmount: 100,
                taxAmount: 19,
                taxCategoryCode: '01',
                position: 0,
              },
              {
                componentKey: 'vat:inc',
                taxKind: 'inc',
                taxRate: 8,
                taxableAmount: 100,
                taxAmount: 8,
                taxCategoryCode: '04',
                position: 1,
              },
            ],
          },
        ],
      })
    );
    expect(result.xmlRef?.match(/<cac:TaxSubtotal>/g)).toHaveLength(2);
    expect(result.xmlRef).toContain('<cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name>');
    expect(result.xmlRef).toContain('<cbc:ID>04</cbc:ID><cbc:Name>INC</cbc:Name>');
    expect(result.xmlRef).toContain('<cbc:TaxAmount currencyID="COP">8.00</cbc:TaxAmount>');
  });

  it('keeps the legacy UBL tax when a compatibility caller supplies an empty component array', async () => {
    const adapter = new ColombiaMockAdapter();
    const baseLine = buildIssueInput().lines[0]!;
    const result = await adapter.issue(
      buildIssueInput({
        lines: [{ ...baseLine, taxComponents: [] }],
      })
    );

    expect(result.xmlRef?.match(/<cac:TaxSubtotal>/g)).toHaveLength(1);
    expect(result.xmlRef).toContain('<cbc:TaxAmount currencyID="COP">19.00</cbc:TaxAmount>');
    expect(result.xmlRef).toContain('<cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name>');
  });

  it('is deterministic across runs with the same input', async () => {
    const adapter = new ColombiaMockAdapter();
    const input = buildIssueInput();
    const first = await adapter.issue(input);
    const second = await adapter.issue(input);
    expect(first.cufe).toBe(second.cufe);
  });

  it('produces distinct CUFEs when any field changes', async () => {
    const adapter = new ColombiaMockAdapter();
    const base = await adapter.issue(buildIssueInput());
    const mutated = await adapter.issue(buildIssueInput({ totalAmount: 119.01 }));
    expect(mutated.cufe).not.toBe(base.cufe);
  });

  it('voidDocument returns a distinct CUFE that does not collide with the original', async () => {
    const adapter = new ColombiaMockAdapter();
    const original = await adapter.issue(buildIssueInput());
    const voided = await adapter.voidDocument({
      tenantId: 'tenant-1',
      cufe: original.cufe,
      reasonCode: 'ERR-01',
    });
    expect(voided.cufe).not.toBe(original.cufe);
    expect(voided.status).toBe('sent');
    expect(voided.providerId).toBe('mock-co');
  });

  it('fetchStatus reports the mock terminal state', async () => {
    const adapter = new ColombiaMockAdapter();
    await expect(adapter.fetchStatus('deadbeef'.repeat(12))).resolves.toBe('accepted');
  });

  it('exposes stable capability flags', () => {
    const adapter = new ColombiaMockAdapter();
    expect(adapter.capabilities).toEqual({
      supportsVoid: true,
      supportsDebitNote: true,
      supportsFetchStatus: true,
    });
    expect(adapter.providerId).toBe('mock-co');
  });
});
