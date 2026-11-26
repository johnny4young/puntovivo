import { afterEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import type { Order } from '@/types';
import {
  buildOrderDocumentHtml,
  canPrintOrder,
  OrderPrintError,
  printOrderDocument,
} from './orderPrinter';

function parseDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * Text of every matching cell, read from the parsed document.
 *
 * Quantities must be asserted this way: the inlined stylesheet also contains
 * bare digits (`#0f172a`, `width: 34%`), so a substring match against the whole
 * document would pass even with the quantity cells wrong or missing.
 */
function readCells(parsed: Document, selector: string): string[] {
  return Array.from(parsed.querySelectorAll(selector), cell => (cell.textContent ?? '').trim());
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    orderNumber: 'PED-000010',
    providerId: 'provider-1',
    providerName: 'Distribuidora & Co',
    siteId: 'site-1',
    siteName: 'Main <Store>',
    status: 'submitted',
    subtotal: 28,
    total: 28,
    linkedPurchaseCount: 0,
    receivedPurchaseNumber: null,
    notes: 'Deliver to <front desk>',
    createdBy: 'user-1',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T11:30:00.000Z',
    items: [
      {
        id: 'order-item-1',
        orderId: 'order-1',
        productId: 'product-1',
        productName: 'Rice',
        productSku: 'RICE-1',
        tracksSerials: false,
        quantity: 7,
        receivedQuantity: 0,
        remainingQuantity: 7,
        unitId: 'unit-1',
        unitName: 'Unit',
        unitAbbreviation: 'UND',
        unitEquivalence: 1,
        costPerUnit: 4,
        baseUnitCost: 4,
        total: 28,
      },
    ],
    ...overrides,
  };
}

describe('orderPrinter', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    delete window.electron;
    await i18next.changeLanguage('en');
  });

  it('renders the supplier document with provider, order number, dates, lines and totals', async () => {
    const order = makeOrder();
    const html = await buildOrderDocumentHtml(order);

    expect(html).toContain('PED-000010');
    expect(html).toContain('Distribuidora &amp; Co');
    expect(html).toContain('Main &lt;Store&gt;');
    expect(html).toContain('Deliver to &lt;front desk&gt;');
    expect(html).toContain(formatDateTime(order.createdAt));
    expect(html).toContain(formatDateTime(order.updatedAt));
    // Ordered quantity, SKU and money all come from the shared formatters and
    // are read from their own cells, never from a document-wide substring.
    const parsed = parseDocument(html);
    expect(html).toContain('RICE-1');
    expect(readCells(parsed, 'tbody td.item-qty')).toEqual([`${formatNumber(7)}Unit`]);
    expect(readCells(parsed, 'tbody td.item-code')).toEqual(['RICE-1']);
    expect(html).toContain(formatCurrency(4));
    expect(html).toContain(formatCurrency(28));
    // Status line reuses the existing orders status copy.
    expect(html).toContain('Submitted');
  });

  it('prints the ordered unit under the quantity so a case reads as a case', async () => {
    const baseItem = makeOrder().items?.[0];
    if (!baseItem) throw new Error('Expected a fixture order item');

    const html = await buildOrderDocumentHtml(
      makeOrder({
        items: [
          {
            ...baseItem,
            unitName: 'Cajas',
            unitAbbreviation: 'CJ',
            quantity: 2,
          },
        ],
      })
    );

    expect(html).toContain('class="item-unit"');
    expect(html).toContain('Cajas');
  });

  it('adds received and pending columns only when the order is partially received', async () => {
    const submitted = await buildOrderDocumentHtml(makeOrder({ status: 'submitted' }));
    expect(submitted).not.toContain('>Received<');
    expect(submitted).not.toContain('>Pending<');

    const partiallyReceived = await buildOrderDocumentHtml(
      makeOrder({
        status: 'partial_received',
        items: [
          {
            ...makeOrder().items![0]!,
            receivedQuantity: 3,
            remainingQuantity: 4,
          },
        ],
      })
    );

    expect(partiallyReceived).toContain('>Received<');
    expect(partiallyReceived).toContain('>Pending<');
    expect(partiallyReceived).toContain('Partial received');

    // The cells themselves carry the numbers: requested 7, received 3, pending 4.
    const submittedDocument = parseDocument(submitted);
    expect(submittedDocument.querySelector('td.item-received')).toBeNull();
    expect(submittedDocument.querySelector('td.item-pending')).toBeNull();

    const partialDocument = parseDocument(partiallyReceived);
    expect(readCells(partialDocument, 'thead th.item-received')).toEqual(['Received']);
    expect(readCells(partialDocument, 'thead th.item-pending')).toEqual(['Pending']);
    expect(readCells(partialDocument, 'thead th.item-cost')).toEqual(['Cost']);
    expect(readCells(partialDocument, 'thead th.item-total')).toEqual(['Total']);
    expect(readCells(partialDocument, 'tbody td.item-qty')).toEqual([`${formatNumber(7)}Unit`]);
    expect(readCells(partialDocument, 'tbody td.item-received')).toEqual([formatNumber(3)]);
    expect(readCells(partialDocument, 'tbody td.item-pending')).toEqual([formatNumber(4)]);
    expect(partiallyReceived).toContain('padding-left: 10px;');
  });

  it('counts the requested items and states the document is not fiscal', async () => {
    const html = await buildOrderDocumentHtml(makeOrder());

    expect(html).toContain('1 item');
    expect(html).toContain('Not a tax document');
  });

  it('includes the auto-print script only when autoPrint is true', async () => {
    expect(await buildOrderDocumentHtml(makeOrder(), { autoPrint: true })).toContain(
      'window.print()'
    );
    expect(await buildOrderDocumentHtml(makeOrder(), { autoPrint: false })).not.toContain(
      'window.print()'
    );
  });

  it('renders the Spanish copy of the document', async () => {
    await i18next.changeLanguage('es');
    const html = await buildOrderDocumentHtml(makeOrder({ status: 'partial_received' }));

    expect(html).toContain('Orden de compra PED-000010');
    // The module calls this document an "orden" everywhere; "pedido" would be
    // a second name for the same thing on a single printed page.
    expect(html).toContain('Datos de la orden');
    expect(html.toLowerCase()).not.toContain('pedido');
    expect(html).toContain('Proveedor');
    expect(html).toContain('Cant.');
    expect(html).toContain('Recibido');
    expect(html).toContain('Parcialmente recibida');
    expect(html).toContain('No es un documento fiscal');
  });

  it('only treats submitted and partially received orders as printable', () => {
    expect(canPrintOrder(makeOrder({ status: 'submitted' }))).toBe(true);
    expect(canPrintOrder(makeOrder({ status: 'partial_received' }))).toBe(true);
    expect(canPrintOrder(makeOrder({ status: 'draft' }))).toBe(false);
    expect(canPrintOrder(makeOrder({ status: 'received' }))).toBe(false);
    expect(canPrintOrder(makeOrder({ status: 'voided' }))).toBe(false);
    expect(canPrintOrder(null)).toBe(false);
  });

  it('refuses to print an order the supplier never received', async () => {
    await expect(printOrderDocument(makeOrder({ status: 'draft' }))).rejects.toMatchObject({
      name: 'OrderPrintError',
      code: 'notPrintable',
    } satisfies Partial<OrderPrintError>);
  });

  it('throws a typed popupBlocked error when the browser blocks the print window', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:order');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await expect(printOrderDocument(makeOrder())).rejects.toMatchObject({
      name: 'OrderPrintError',
      code: 'popupBlocked',
    } satisfies Partial<OrderPrintError>);
  });

  it('throws a typed desktopBridgeFailed error when the desktop printer fails', async () => {
    window.electron = {
      printReceipt: vi.fn(async () => ({ success: false, error: 'printer offline' })),
    } as unknown as typeof window.electron;

    await expect(printOrderDocument(makeOrder())).rejects.toMatchObject({
      name: 'OrderPrintError',
      code: 'desktopBridgeFailed',
    } satisfies Partial<OrderPrintError>);
  });

  it('resolves quietly when the operator cancels the native print dialog', async () => {
    window.electron = {
      printReceipt: vi.fn(async () => ({ success: false, errorCode: 'PRINT_CANCELLED' })),
    } as unknown as typeof window.electron;

    await expect(printOrderDocument(makeOrder())).resolves.toBeUndefined();
  });
});
