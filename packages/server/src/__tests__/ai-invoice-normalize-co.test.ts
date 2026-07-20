/**
 * Colombian invoice normalizer (services/ai/invoice/normalize-co).
 *
 * Pure-function tests — no DB, no network. Covers the NIT regex
 * fallback path (digs the NIT out of the supplier name when the
 * provider mis-columned it), IVA detection across the 3 legal rates
 * and the linesSum reconciliation surface that the review form
 * warns on.
 *
 * Added 2026-05-15 alongside  / AI Núcleo initial iteration OCR.
 */
import { describe, expect, it } from 'vitest';

import {
  detectColombianIvaRate,
  extractNit,
  normalizeColombianInvoice,
  normalizeInvoiceNumber,
} from '../services/ai/invoice/normalize-co.js';

describe('extractNit', () => {
  it('returns a clean NIT with hyphen check digit when supplied', () => {
    expect(extractNit('900123456-7')).toBe('900123456-7');
  });

  it('strips dots and spaces before matching', () => {
    expect(extractNit('900.123.456-7')).toBe('900123456-7');
    expect(extractNit('900 123 456 7')).toBe('9001234567');
  });

  it('returns null when no 9-or-10-digit run is present', () => {
    expect(extractNit('Sin NIT visible')).toBeNull();
    expect(extractNit(null)).toBeNull();
    expect(extractNit('')).toBeNull();
  });

  it('matches a NIT embedded inside a supplier-name blob', () => {
    expect(extractNit('Distribuciones del Caribe SAS NIT 900123456-7')).toBe('900123456-7');
  });
});

describe('detectColombianIvaRate', () => {
  it('returns 19 for a standard rate', () => {
    expect(detectColombianIvaRate(100, 19)).toBe(19);
  });

  it('returns 5 when the proportion fits the reduced rate', () => {
    expect(detectColombianIvaRate(100, 5)).toBe(5);
  });

  it('returns 0 when the invoice is tax-exempt', () => {
    expect(detectColombianIvaRate(100, 0)).toBe(0);
  });

  it('returns null when subtotal or tax is missing', () => {
    expect(detectColombianIvaRate(null, 19)).toBeNull();
    expect(detectColombianIvaRate(100, null)).toBeNull();
    expect(detectColombianIvaRate(0, 19)).toBeNull();
  });
});

describe('normalizeInvoiceNumber', () => {
  it('uppercases and strips non-alphanumeric punctuation', () => {
    expect(normalizeInvoiceNumber('fact-001/2025')).toBe('FACT-0012025');
  });

  it('returns null when the cleaned value is empty', () => {
    expect(normalizeInvoiceNumber('!!!')).toBeNull();
    expect(normalizeInvoiceNumber(null)).toBeNull();
  });
});

describe('normalizeColombianInvoice', () => {
  it('lifts a NIT out of the supplier name when the provider missed the column', () => {
    const out = normalizeColombianInvoice({
      supplierName: 'Distribuciones SAS NIT 900123456-7',
      supplierTaxId: null,
      invoiceNumber: 'FACT-001',
      subtotal: 100,
      taxAmount: 19,
      lines: [{ totalLine: 50 }, { totalLine: 70 }],
    });
    expect(out.supplier.nit).toBe('900123456-7');
    expect(out.ivaRate).toBe(19);
    expect(out.linesSum).toBe(120);
    expect(out.invoiceNumber).toBe('FACT-001');
  });

  it('sums only lines whose totalLine is present', () => {
    const out = normalizeColombianInvoice({
      supplierName: 'Proveedor',
      supplierTaxId: '900123456-7',
      invoiceNumber: 'X',
      subtotal: null,
      taxAmount: null,
      lines: [{ totalLine: null }, { totalLine: 25 }, { totalLine: 75 }],
    });
    expect(out.linesSum).toBe(100);
    expect(out.ivaRate).toBeNull();
  });

  it.each([
    {
      name: 'standard 19% grocery invoice',
      input: {
        supplierName: 'Lacteos El Campo S.A.S.',
        supplierTaxId: '900.421.118-3',
        invoiceNumber: 'fac-001-2026',
        subtotal: 164_600,
        taxAmount: 31_274,
        lines: [{ totalLine: 84_000 }, { totalLine: 56_400 }, { totalLine: 24_200 }],
      },
      expected: {
        nit: '900421118-3',
        ivaRate: 19,
        invoiceNumber: 'FAC-001-2026',
        linesSum: 164_600,
      },
    },
    {
      name: 'reduced 5% cleaning supplies invoice',
      input: {
        supplierName: 'Aseo Andino S.A.S.',
        supplierTaxId: '901222333-4',
        invoiceNumber: 'se-778',
        subtotal: 200_000,
        taxAmount: 10_000,
        lines: [{ totalLine: 120_000 }, { totalLine: 80_000 }],
      },
      expected: { nit: '901222333-4', ivaRate: 5, invoiceNumber: 'SE-778', linesSum: 200_000 },
    },
    {
      name: 'tax-exempt market invoice',
      input: {
        supplierName: 'Mercado Exento Ltda.',
        supplierTaxId: '830123456-7',
        invoiceNumber: 'FE 9944',
        subtotal: 120_000,
        taxAmount: 0,
        lines: [{ totalLine: 45_000 }, { totalLine: 75_000 }],
      },
      expected: { nit: '830123456-7', ivaRate: 0, invoiceNumber: 'FE9944', linesSum: 120_000 },
    },
    {
      name: 'supplier name carries NIT when tax field is empty',
      input: {
        supplierName: 'Distribuciones Norte NIT 900777888-5',
        supplierTaxId: null,
        invoiceNumber: 'A/445',
        subtotal: 50_000,
        taxAmount: 9_500,
        lines: [{ totalLine: 50_000 }],
      },
      expected: { nit: '900777888-5', ivaRate: 19, invoiceNumber: 'A445', linesSum: 50_000 },
    },
    {
      name: 'space-separated ten-digit NIT with 5% IVA',
      input: {
        supplierName: 'Drogueria Santa Ana',
        supplierTaxId: '901 555 777 8',
        invoiceNumber: 'pos-0099',
        subtotal: 75_000,
        taxAmount: 3_750,
        lines: [{ totalLine: 30_000 }, { totalLine: 45_000 }],
      },
      expected: { nit: '9015557778', ivaRate: 5, invoiceNumber: 'POS-0099', linesSum: 75_000 },
    },
  ])('normalizes fixture-like data: $name', ({ input, expected }) => {
    const out = normalizeColombianInvoice(input);
    expect(out.supplier.nit).toBe(expected.nit);
    expect(out.ivaRate).toBe(expected.ivaRate);
    expect(out.invoiceNumber).toBe(expected.invoiceNumber);
    expect(out.linesSum).toBe(expected.linesSum);
  });
});
