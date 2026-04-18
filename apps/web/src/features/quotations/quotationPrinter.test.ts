import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildQuotationReceiptHtml,
  printQuotationReceipt,
  QuotationPrintError,
} from './quotationPrinter';
import type { QuotationDetail } from '@/types';

function buildQuotation(
  overrides: Partial<QuotationDetail> = {}
): QuotationDetail {
  return {
    id: 'q-1',
    quotationNumber: 'COT-000042',
    status: 'sent',
    customerId: 'c-1',
    customerName: 'Ana & Co',
    siteId: 'site-1',
    siteName: 'Main <Site>',
    subtotal: 100,
    taxAmount: 19,
    discountAmount: 5,
    total: 114,
    validUntil: '2026-05-15T23:59:59.000Z',
    notes: 'Includes <free> shipping',
    createdAt: '2026-04-15T10:00:00.000Z',
    createdBy: 'user-1',
    createdByName: 'Administrator',
    statusChangedAt: '2026-04-15T10:05:00.000Z',
    statusChangedBy: 'user-1',
    statusChangedByName: 'Administrator',
    updatedAt: '2026-04-15T10:05:00.000Z',
    items: [
      {
        id: 'line-1',
        productId: 'product-1',
        productName: 'Coffee Beans',
        productSku: 'COF-001',
        quantity: 2,
        unitPrice: 59.5,
        discount: 0,
        taxRate: 19,
        taxAmount: 19,
        total: 119,
      },
    ],
    ...overrides,
  };
}

describe('quotationPrinter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.electron;
  });

  it('renders escaped quotation details with validity and tax rate', () => {
    const html = buildQuotationReceiptHtml(buildQuotation());

    expect(html).toContain('COT-000042');
    expect(html).toContain('Ana &amp; Co');
    expect(html).toContain('Main &lt;Site&gt;');
    expect(html).toContain('Includes &lt;free&gt; shipping');
    // Tax rate shown per line when > 0.
    expect(html).toContain('19%');
    // Validity line + footer both carry the formatted date.
    expect(html).toContain('Valid until');
  });

  it('renders an em-dash for validity when validUntil is null', () => {
    const html = buildQuotationReceiptHtml(
      buildQuotation({ validUntil: null, notes: null })
    );

    // Validity row falls back to the em-dash placeholder.
    expect(html).toContain('Validity</span>\n                <span>—');
    // Footer omits the "Valid until" line and emits the neutral fallback.
    expect(html).toContain('Please confirm validity with the vendor.');
    // No "Valid until" copy when no date is set.
    expect(html).not.toContain('Valid until ');
  });

  it('renders an em-dash for per-line tax when rate is zero', () => {
    const html = buildQuotationReceiptHtml(
      buildQuotation({
        items: [
          {
            id: 'line-0',
            productId: 'p',
            productName: 'Free sample',
            productSku: 'FREE',
            quantity: 1,
            unitPrice: 0,
            discount: 0,
            taxRate: 0,
            taxAmount: 0,
            total: 0,
          },
        ],
        taxAmount: 0,
        subtotal: 0,
        total: 0,
        discountAmount: 0,
      })
    );

    // The per-line tax column shows — when rate is 0; it does not emit a
    // literal "0%" inside the item-tax cell.
    expect(html).toContain('<td class="item-tax">—</td>');
    expect(html).not.toContain('<td class="item-tax">0%</td>');
  });

  it('omits the Discount row when the aggregate discount is zero', () => {
    const html = buildQuotationReceiptHtml(
      buildQuotation({ discountAmount: 0 })
    );
    expect(html).not.toContain('>Discount<');
  });

  it('falls back to Walk-in when no customer name is set', () => {
    const html = buildQuotationReceiptHtml(
      buildQuotation({ customerName: null })
    );
    expect(html).toContain('Walk-in');
  });

  it('includes the auto-print script only when autoPrint is true', () => {
    const withAutoPrint = buildQuotationReceiptHtml(buildQuotation(), {
      autoPrint: true,
    });
    const withoutAutoPrint = buildQuotationReceiptHtml(buildQuotation(), {
      autoPrint: false,
    });

    expect(withAutoPrint).toContain('window.print()');
    expect(withoutAutoPrint).not.toContain('window.print()');
  });

  it('throws a typed popupBlocked error when the browser blocks the print window', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:quotation');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await expect(printQuotationReceipt(buildQuotation())).rejects.toMatchObject({
      name: 'QuotationPrintError',
      code: 'popupBlocked',
    } satisfies Partial<QuotationPrintError>);
  });

  it('throws a typed desktopBridgeFailed error when Electron printReceipt fails', async () => {
    window.electron = {
      printReceipt: vi.fn(async () => ({
        success: false,
        error: 'printer offline',
      })),
    } as unknown as typeof window.electron;

    await expect(printQuotationReceipt(buildQuotation())).rejects.toMatchObject({
      name: 'QuotationPrintError',
      code: 'desktopBridgeFailed',
    } satisfies Partial<QuotationPrintError>);
  });
});
