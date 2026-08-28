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
      taxKind: 'iva',
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

  it('separates IVA and INC from the frozen sale-line snapshots', async () => {
    const html = await buildSaleReceiptHtml({
      ...sale,
      taxAmount: 27,
      items: [
        { ...sale.items![0]!, taxKind: 'iva', taxAmount: 19 },
        {
          ...sale.items![0]!,
          id: 'item_2',
          productId: 'product_2',
          productName: 'Prepared meal',
          taxKind: 'inc',
          taxRate: 8,
          taxAmount: 8,
        },
      ],
    });

    expect(html).toContain('>IVA<');
    expect(html).toContain('>INC<');
    expect(html).not.toContain('>VAT<');
  });

  it('prefers sale-time display snapshots in the legacy HTML fallback', async () => {
    const html = await buildSaleReceiptHtml({
      ...sale,
      customerName: 'Renamed customer',
      customerNameSnapshot: 'Original customer',
      items: (sale.items ?? []).map(item => ({
        ...item,
        productName: 'Renamed product',
        productSku: 'RENAMED-001',
        productNameSnapshot: 'Original product',
        productSkuSnapshot: 'ORIGINAL-001',
      })),
    });

    expect(html).toContain('Original customer');
    expect(html).toContain('Original product');
    expect(html).not.toContain('Renamed customer');
    expect(html).not.toContain('Renamed product');
  });

  it('renders sale-time company and customer identity in the legacy HTML fallback', async () => {
    const html = await buildSaleReceiptHtml({
      ...sale,
      receiptIdentitySnapshotVersion: 1,
      companyNameSnapshot: 'Comercial <Original> S.A.S.',
      companyTaxIdSnapshot: '900&123',
      companyAddressSnapshot: 'Calle 1 < Local 2',
      companyPhoneSnapshot: '+57 300 111 2233',
      companyEmailSnapshot: 'ventas@example.test',
      customerTaxIdSnapshot: 'CC-123&456',
    });

    expect(html).toContain('Comercial &lt;Original&gt; S.A.S.');
    expect(html).toContain('Tax ID 900&amp;123');
    expect(html).toContain('Calle 1 &lt; Local 2');
    expect(html).toContain('+57 300 111 2233');
    expect(html).toContain('ventas@example.test');
    expect(html).toContain('CC-123&amp;456');
    expect(html).not.toContain('>Puntovivo<');
  });

  it('ignores identity fields when the snapshot version is not supported', async () => {
    const html = await buildSaleReceiptHtml({
      ...sale,
      receiptIdentitySnapshotVersion: 0,
      companyNameSnapshot: 'Incomplete historical snapshot',
      customerTaxIdSnapshot: 'SHOULD-NOT-PRINT',
    });

    expect(html).toContain('>Puntovivo<');
    expect(html).not.toContain('Incomplete historical snapshot');
    expect(html).not.toContain('SHOULD-NOT-PRINT');
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

  it('prints the server-rendered active template in the browser fallback', async () => {
    let captured: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((src: Blob | MediaSource) => {
      captured = src as Blob;
      return 'blob:template-receipt';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(window, 'open').mockReturnValue({} as Window);

    await printSaleReceipt(sale, {
      htmlProvider: async () => '<html><body><main>ACTIVE TEMPLATE</main></body></html>',
    });

    expect(captured).not.toBeNull();
    const html = await captured!.text();
    expect(html).toContain('ACTIVE TEMPLATE');
    expect(html).toContain('window.print()');
    expect(html).not.toContain('POS-000123');
  });

  it('prints the server-rendered active template through Electron', async () => {
    const printReceipt = vi.fn(async () => ({ success: true }));
    (window as unknown as { electron: { printReceipt: typeof printReceipt } }).electron = {
      printReceipt,
    };

    await printSaleReceipt(sale, {
      htmlProvider: async () => '<html><body>ACTIVE ELECTRON TEMPLATE</body></html>',
    });

    expect(printReceipt).toHaveBeenCalledWith('<html><body>ACTIVE ELECTRON TEMPLATE</body></html>');
  });

  it('keeps the legacy receipt when the tenant has no active template', async () => {
    let captured: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((src: Blob | MediaSource) => {
      captured = src as Blob;
      return 'blob:legacy-receipt';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(window, 'open').mockReturnValue({} as Window);

    await printSaleReceipt(sale, { htmlProvider: async () => null });

    expect(captured).not.toBeNull();
    await expect(captured!.text()).resolves.toContain('POS-000123');
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

  // fiscal proof block (CUFE / status / QR).
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
          maturity: 'certified',
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

  // A certified provider may return status='sent' before the authority's
  // final acknowledgement. Its finalized identifier and QR remain printable.
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
          maturity: 'certified',
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
          maturity: 'mock',
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
          maturity: 'mock',
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
          maturity: 'certified',
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

  it('prints mock evidence as local-only and suppresses an authority QR defensively', async () => {
    const localIdentifier = 'cafe1234'.repeat(12);
    const html = await buildSaleReceiptHtml({
      ...sale,
      fiscalDocuments: [
        {
          id: 'fd_mock',
          source: 'sale',
          kind: 'DEE',
          cufe: localIdentifier,
          documentNumber: 'OB0000000010',
          status: 'accepted',
          maturity: 'mock',
          // Defense in depth: even a stale caller cannot turn demo evidence
          // into a scannable authority claim.
          qrPayload: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${localIdentifier}`,
          xmlRef: null,
          resolution: '18760000001 | OB 1-1000000 | 2026-01-01 - 2027-01-01',
          emittedAt: sale.createdAt,
          countryCode: 'CO',
        },
      ],
    });

    expect(html).toContain('Local fiscal identifier');
    expect(html).toContain(localIdentifier);
    expect(html).toContain('Demo only');
    expect(html).toContain('18760000001');
    expect(html).not.toContain('class="receipt-fiscal-qr"');
    expect(html).not.toContain('Scan to verify on DIAN');
  });
});
