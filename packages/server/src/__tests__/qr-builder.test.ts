/**
 * ENG-058 — Unit tests for `services/fiscal/qr-builder.ts`.
 *
 * Pure module tests. No DB / no Fastify / no fixtures beyond plain
 * objects.
 */

import { describe, expect, it } from 'vitest';
import {
  buildFiscalQrPayload,
  isPlaceholderCufe,
  type BuildFiscalQrInput,
} from '../services/fiscal/qr-builder.js';

const CO_REAL_CUFE = 'a1b2c3d4'.repeat(12); // 96-char hex-ish stub
const MX_REAL_UUID = '00000000-1111-2222-3333-444444444444';

function buildInput(overrides: Partial<BuildFiscalQrInput> = {}): BuildFiscalQrInput {
  return {
    country: 'CO',
    environment: 'production',
    doc: {
      cufe: CO_REAL_CUFE,
      status: 'accepted',
      documentNumber: 'OB0000000001',
      buyerTaxId: '900123456',
      totalAmount: 119000,
      xmlRef: null,
      providerResponse: null,
    },
    tenant: { taxId: '800123456' },
    ...overrides,
  };
}

describe('isPlaceholderCufe', () => {
  it('flags pending- prefix as placeholder', () => {
    expect(isPlaceholderCufe('pending-abc123')).toBe(true);
  });
  it('treats null/undefined/empty as placeholder', () => {
    expect(isPlaceholderCufe(null)).toBe(true);
    expect(isPlaceholderCufe(undefined)).toBe(true);
    expect(isPlaceholderCufe('')).toBe(true);
  });
  it('accepts a real-looking CUFE', () => {
    expect(isPlaceholderCufe(CO_REAL_CUFE)).toBe(false);
    expect(isPlaceholderCufe(MX_REAL_UUID)).toBe(false);
  });
});

describe('buildFiscalQrPayload — Colombia (DIAN)', () => {
  it('returns the production verification URL for an accepted document', () => {
    const result = buildFiscalQrPayload(buildInput());
    expect(result).toBe(
      `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${CO_REAL_CUFE}`
    );
  });

  it('uses the habilitación host when environment is habilitation', () => {
    const result = buildFiscalQrPayload(buildInput({ environment: 'habilitation' }));
    expect(result).toBe(
      `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${CO_REAL_CUFE}`
    );
  });

  it('returns the same URL for status=sent (provider acknowledged but not finalized)', () => {
    const result = buildFiscalQrPayload(
      buildInput({ doc: { ...buildInput().doc, status: 'sent' } })
    );
    expect(result).toMatch(/^https:\/\/catalogo-vpfe\.dian\.gov\.co\/document\/searchqr\?/);
  });
});

describe('buildFiscalQrPayload — status gate', () => {
  it('returns null for pending', () => {
    expect(
      buildFiscalQrPayload(
        buildInput({ doc: { ...buildInput().doc, status: 'pending', cufe: 'pending-abc' } })
      )
    ).toBeNull();
  });
  it('returns null for contingency', () => {
    expect(
      buildFiscalQrPayload(buildInput({ doc: { ...buildInput().doc, status: 'contingency' } }))
    ).toBeNull();
  });
  it('returns null for rejected', () => {
    expect(
      buildFiscalQrPayload(buildInput({ doc: { ...buildInput().doc, status: 'rejected' } }))
    ).toBeNull();
  });
});

describe('buildFiscalQrPayload — placeholder CUFE gate', () => {
  it('returns null when accepted but cufe is the placeholder (defense-in-depth)', () => {
    const result = buildFiscalQrPayload(
      buildInput({
        doc: {
          ...buildInput().doc,
          status: 'accepted',
          cufe: 'pending-deadbeef',
        },
      })
    );
    expect(result).toBeNull();
  });
});

describe('buildFiscalQrPayload — Mexico (SAT CFDI)', () => {
  it('emits the SAT verification URL with id+re+rr+tt+fe params', () => {
    const result = buildFiscalQrPayload(
      buildInput({
        country: 'MX',
        doc: {
          ...buildInput().doc,
          cufe: MX_REAL_UUID,
          buyerTaxId: 'XAXX010101000',
          totalAmount: 100,
          providerResponse: { sello: 'A'.repeat(344) }, // SAT sello is ~344 chars
        },
        tenant: { taxId: 'AAA010101AAA' },
      })
    );
    expect(result).not.toBeNull();
    const url = new URL(result as string);
    expect(url.host).toBe('verificacfdi.facturaelectronica.sat.gob.mx');
    expect(url.searchParams.get('id')).toBe(MX_REAL_UUID);
    expect(url.searchParams.get('re')).toBe('AAA010101AAA');
    expect(url.searchParams.get('rr')).toBe('XAXX010101000');
    expect(url.searchParams.get('tt')).toBe('0000000100.000000');
    expect(url.searchParams.get('fe')).toBe('A'.repeat(8)); // last 8 of 344 A's
  });

  it('omits the fe segment when sello is missing or too short', () => {
    const result = buildFiscalQrPayload(
      buildInput({
        country: 'MX',
        doc: {
          ...buildInput().doc,
          cufe: MX_REAL_UUID,
          providerResponse: null,
        },
      })
    );
    expect(result).not.toBeNull();
    const url = new URL(result as string);
    expect(url.searchParams.has('fe')).toBe(false);
  });
});

describe('buildFiscalQrPayload — Chile (TODO ENG-036b)', () => {
  it('returns null for CL until the SII pack ships TED', () => {
    const result = buildFiscalQrPayload(
      buildInput({ country: 'CL', tenant: { taxId: '76123456-7' } })
    );
    expect(result).toBeNull();
  });
});

describe('buildFiscalQrPayload — unknown country', () => {
  it('returns null for an unsupported country code', () => {
    const result = buildFiscalQrPayload(buildInput({ country: 'PE' }));
    expect(result).toBeNull();
  });
});
