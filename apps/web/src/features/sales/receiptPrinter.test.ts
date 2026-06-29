import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSaleReceiptHtml, printSaleReceipt } from '@/features/sales/receiptPrinter';
import type { Sale } from '@/types';

const sale: Sale = {
  id: 'sale_1',
  tenantId: 'tenant_1',
  saleNumber: 'POS-000123',
  customerId: 'customer_1',
  customerName: 'Ana & Co',
  subtotal: 100,
  taxAmount: 19,
  discountAmount: 5,
  total: 114,
  paymentMethod: 'cash',
  paymentStatus: 'paid',
  status: 'completed',
  notes: 'Deliver to <front desk>',
  createdBy: 'user_1',
  createdAt: '2026-04-07T15:00:00.000Z',
  updatedAt: '2026-04-07T15:00:00.000Z',
  items: [
    {
      id: 'item_1',
      saleId: 'sale_1',
      productId: 'product_1',
      productName: 'Coffee Beans',
      productSku: 'COF-001',
      quantity: 2,
      unitPrice: 59.5,
      unitId: 'unit_1',
      unitEquivalence: 1,
      unitName: 'Bag',
      unitAbbreviation: 'bg',
      discount: 0,
      taxRate: 19,
      taxAmount: 19,
      costAtSale: 35,
      total: 119,
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('receiptPrinter', () => {
  it('renders escaped receipt details', async () => {
    const html = await buildSaleReceiptHtml(sale);

    expect(html).toContain('POS-000123');
    expect(html).toContain('Ana &amp; Co');
    expect(html).toContain('Deliver to &lt;front desk&gt;');
    expect(html).toContain('Coffee Beans (bg)');
    expect(html).toContain('$114.00');
  });

  it('includes auto print script only when requested', async () => {
    const autoPrintHtml = await buildSaleReceiptHtml(sale, { autoPrint: true });
    const regularHtml = await buildSaleReceiptHtml(sale, { autoPrint: false });

    expect(autoPrintHtml).toContain('window.print()');
    expect(regularHtml).not.toContain('window.print()');
  });

  it('opens the browser fallback through a Blob URL print window', async () => {
    vi.useFakeTimers();
    let captured: Blob | null = null;
    const createUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((src: Blob | MediaSource) => {
        captured = src as Blob;
        return 'blob:sale-receipt';
      });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);

    await printSaleReceipt(sale);

    expect(createUrlSpy).toHaveBeenCalledOnce();
    expect(openSpy).toHaveBeenCalledWith(
      'blob:sale-receipt',
      '_blank',
      'noopener,noreferrer,width=420,height=720'
    );
    expect(captured).not.toBeNull();
    await expect(captured!.text()).resolves.toContain('window.print()');
    expect(revokeSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(revokeSpy).toHaveBeenCalledWith('blob:sale-receipt');
  });

  it('skips the Tenders section for a single-tender sale', async () => {
    const html = await buildSaleReceiptHtml({
      ...sale,
      payments: [
        {
          id: 'pay_1',
          method: 'cash',
          amount: 114,
          reference: null,
          createdAt: sale.createdAt,
        },
      ],
    });

    // The `.tender-*` classes are unconditionally defined inside the static
    // <style> block, so assert on the actual section markup instead — that's
    // what gates whether tender rows render at all.
    expect(html).not.toContain('<section class="tenders">');
    expect(html).not.toContain('>Method<');
  });

  it('prints one row per tender and escapes references for a split sale', async () => {
    const html = await buildSaleReceiptHtml({
      ...sale,
      payments: [
        {
          id: 'pay_1',
          method: 'cash',
          amount: 50,
          // Contains HTML-like characters on purpose — escapeHtml must fire.
          reference: 'Petty <cash>',
          createdAt: sale.createdAt,
        },
        {
          id: 'pay_2',
          method: 'card',
          amount: 64,
          reference: null,
          createdAt: sale.createdAt,
        },
      ],
    });

    expect(html).toContain('Tenders');
    expect(html).toContain('$50.00');
    expect(html).toContain('$64.00');
    expect(html).toContain('Petty &lt;cash&gt;');
    // Null-reference row must still show something — the dash placeholder.
    expect(html).toContain('&mdash;');
  });

  // ENG-058 — fiscal proof block (CUFE / status / QR).
  it('omits the fiscal section for a non-fiscal sale', async () => {
    const html = await buildSaleReceiptHtml(sale);
    expect(html).not.toContain('class="receipt-fiscal"');
  });

  it('renders the fiscal section with full CUFE and QR for an accepted document', async () => {
    const realCufe = 'a1b2c3d4'.repeat(12); // 96 chars
    const html = await buildSaleReceiptHtml({
      ...sale,
      fiscalDocuments: [
        {
          id: 'fd_1',
          source: 'sale',
          kind: 'DEE',
          cufe: realCufe,
          documentNumber: 'OB0000000001',
          status: 'accepted',
          qrPayload: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${realCufe}`,
          xmlRef: null,
          resolution: null,
          emittedAt: sale.createdAt,
          countryCode: 'CO',
        },
      ],
    });
    expect(html).toContain('class="receipt-fiscal"');
    expect(html).toContain(realCufe);
    expect(html).toContain('OB0000000001');
    expect(html).toContain('class="receipt-fiscal-qr"');
    expect(html).toContain('data:image/'); // QR data URL
  });

  // ENG-058 — Live-smoke regression: MockAdapter (and DIAN happy path)
  // returns status='sent', not 'accepted'. The fiscal section must render
  // the real CUFE and QR for sent documents, not "(Pendiente)".
  it('renders the fiscal section with full CUFE and QR for a sent document', async () => {
    const realCufe = 'b' + 'cdef0123'.repeat(11) + 'ab1234567'; // 96 chars, no pending- prefix
    const html = await buildSaleReceiptHtml({
      ...sale,
      fiscalDocuments: [
        {
          id: 'fd_sent',
          source: 'sale',
          kind: 'DEE',
          cufe: realCufe,
          documentNumber: 'SM0000000001',
          status: 'sent',
          qrPayload: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${realCufe}`,
          xmlRef: null,
          resolution: null,
          emittedAt: sale.createdAt,
          countryCode: 'CO',
        },
      ],
    });
    expect(html).toContain('class="receipt-fiscal"');
    expect(html).toContain(realCufe);
    expect(html).toContain('class="receipt-fiscal-qr"');
    // The status copy still appears — but the CUFE row is the real CUFE,
    // not the "(Pendiente)" placeholder text.
    expect(html).not.toContain('(Pending)');
    expect(html).not.toContain('(Pendiente)');
  });

  it('hides the placeholder CUFE and the QR for a contingency document', async () => {
    const html = await buildSaleReceiptHtml({
      ...sale,
      fiscalDocuments: [
        {
          id: 'fd_2',
          source: 'sale',
          kind: 'DEE',
          cufe: 'pending-deadbeef0123456789abcdef0123456789abcdef',
          documentNumber: 'OB0000000002',
          status: 'contingency',
          qrPayload: null,
          xmlRef: null,
          resolution: null,
          emittedAt: sale.createdAt,
          countryCode: 'CO',
        },
      ],
    });
    expect(html).toContain('class="receipt-fiscal"');
    expect(html).not.toContain('pending-deadbeef');
    expect(html).not.toContain('class="receipt-fiscal-qr"');
    // Acceptance: contingency must NEVER render as accepted.
    // Status copy comes from fiscal:status.contingency = "Contingency".
    expect(html).toContain('Contingency');
    // Negative regex: the receipt MUST NOT contain "Accepted" anywhere
    // in the fiscal section when status is contingency.
    expect(html).not.toMatch(/receipt-fiscal[\s\S]*Accepted/);
  });

  it('shows a rejected status copy without a QR or full CUFE', async () => {
    const html = await buildSaleReceiptHtml({
      ...sale,
      fiscalDocuments: [
        {
          id: 'fd_3',
          source: 'sale',
          kind: 'DEE',
          cufe: 'pending-rejected-pinky',
          documentNumber: 'OB0000000003',
          status: 'rejected',
          qrPayload: null,
          xmlRef: null,
          resolution: null,
          emittedAt: sale.createdAt,
          countryCode: 'CO',
        },
      ],
    });
    expect(html).toContain('Rejected');
    expect(html).not.toContain('class="receipt-fiscal-qr"');
  });

  it('uses country-aware fiscal labels for a Mexican CFDI', async () => {
    const uuid = '00000000-1111-2222-3333-444444444444';
    const html = await buildSaleReceiptHtml({
      ...sale,
      fiscalDocuments: [
        {
          id: 'fd_mx',
          source: 'sale',
          kind: 'FEV',
          cufe: uuid,
          documentNumber: 'A-100',
          status: 'accepted',
          qrPayload:
            'https://verificacfdi.facturaelectronica.sat.gob.mx/?id=00000000-1111-2222-3333-444444444444',
          xmlRef: null,
          resolution: null,
          emittedAt: sale.createdAt,
          countryCode: 'MX',
        },
      ],
    });

    expect(html).toContain('Fiscal folio (UUID)');
    expect(html).toContain('Scan to verify on SAT');
    expect(html).not.toContain('Scan to verify on DIAN');
  });
});
