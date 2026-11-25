import i18next from 'i18next';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import {
  AUTO_PRINT_SCRIPT,
  buildReceiptStyleTag,
  escapeHtml,
  printHtmlDocument,
} from '@/lib/printWindow';
import type { Order } from '@/types';

/**
 * printable purchase order.
 *
 * The escaping, the receipt stylesheet shell, the auto-print snippet and the
 * Electron/browser print bridge are shared with
 * `features/quotations/quotationPrinter.ts` through `@/lib/printWindow`, so a
 * fix there lands in both documents. This file owns what is specific to a
 * supplier request:
 *   - No prices-first framing: the document is a supplier request, so the
 *     provider, the requesting site and the receipt progress lead.
 *   - Received / pending columns appear only once something has arrived
 *     (`partial_received`), which is when "still to receive" is meaningful.
 *   - Copy is translated through the `orders` namespace; the sale/quotation
 *     receipts are intentionally English-only today, this document is not.
 *
 * There is no letter/A4 paginated variant: the quotation pattern ships a
 * single narrow receipt layout (max width 420px, no `@page` rule) and the
 * browser print dialog's "Save as PDF" is the established path to a PDF.
 */

type PrintableOrder = Pick<
  Order,
  | 'orderNumber'
  | 'providerName'
  | 'siteName'
  | 'status'
  | 'notes'
  | 'subtotal'
  | 'total'
  | 'createdAt'
  | 'updatedAt'
  | 'items'
>;

type OrderStatusForPrint = Order['status'];

interface OrderHtmlOptions {
  autoPrint: boolean;
}

type OrderPrintErrorCode = 'notPrintable' | 'popupBlocked' | 'desktopBridgeFailed' | 'unknown';

export class OrderPrintError extends Error {
  code: OrderPrintErrorCode;

  constructor(code: OrderPrintErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'OrderPrintError';
  }
}

/**
 * An order only means something to a supplier once it left `draft`. `received`
 * and `voided` orders are closed, so printing them as a request would be
 * misleading — the receipt/purchase is the document at that point.
 */
const PRINTABLE_ORDER_STATUSES: readonly OrderStatusForPrint[] = ['submitted', 'partial_received'];

export function canPrintOrder(order: Pick<Order, 'status'> | null | undefined): boolean {
  return !!order && PRINTABLE_ORDER_STATUSES.includes(order.status);
}

function buildOrderRows(order: PrintableOrder, showReceiptProgress: boolean): string {
  return (order.items ?? [])
    .map(item => {
      const productLabel = item.productName || item.productSku || item.productId;
      const unitLabel = item.unitName ?? item.unitAbbreviation ?? null;
      const received = item.receivedQuantity ?? 0;
      const pending = item.remainingQuantity ?? item.quantity;

      const progressCells = showReceiptProgress
        ? `
          <td class="item-received">${escapeHtml(formatNumber(received))}</td>
          <td class="item-pending">${escapeHtml(formatNumber(pending))}</td>
        `
        : '';

      // The supplier reads quantities and costs in the unit the order used —
      // two boxes of twelve are not "2" — so the unit travels with the
      // quantity, falling back exactly like the order details table.
      const unitCell = unitLabel
        ? `<br /><span class="item-unit">${escapeHtml(unitLabel)}</span>`
        : '';

      return `
        <tr>
          <td class="item-name">${escapeHtml(productLabel)}</td>
          <td class="item-code">${escapeHtml(item.productSku ?? '')}</td>
          <td class="item-qty">${escapeHtml(formatNumber(item.quantity))}${unitCell}</td>
          ${progressCells}
          <td class="item-cost">${escapeHtml(formatCurrency(item.costPerUnit))}</td>
          <td class="item-total">${escapeHtml(formatCurrency(item.total))}</td>
        </tr>
      `;
    })
    .join('');
}

export async function buildOrderDocumentHtml(
  order: PrintableOrder,
  { autoPrint }: OrderHtmlOptions = { autoPrint: false }
): Promise<string> {
  // `orders` is a lazy namespace: load it before `getFixedT` reads it so a
  // document printed from a screen that never mounted the namespace renders
  // real copy instead of raw keys.
  await i18next.loadNamespaces(['orders', 'common']);
  const t = i18next.getFixedT(null, ['orders', 'common']);
  const language = i18next.resolvedLanguage ?? i18next.language ?? 'en';
  const items = order.items ?? [];
  const showReceiptProgress = order.status === 'partial_received';
  const notesSection = order.notes
    ? `
      <section class="notes">
        <div class="section-label">${escapeHtml(t('orders:print.notes'))}</div>
        <p>${escapeHtml(order.notes)}</p>
      </section>
    `
    : '';

  // Only the item columns differ from the quotation receipt.
  const styleTag = buildReceiptStyleTag(`
          .item-name { width: 34%; padding-right: 8px; }
          .item-code { color: #475569; padding-right: 6px; }
          .item-unit { color: #64748b; font-size: 10px; }
          .item-qty, .item-received, .item-pending, .item-cost, .item-total {
            text-align: right;
            white-space: nowrap;
          }
`);

  return `
    <!DOCTYPE html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(t('orders:print.title', { orderNumber: order.orderNumber }))}</title>${styleTag}
      </head>
      <body>
        <main class="receipt">
          <header class="header">
            <div class="kicker">${escapeHtml(t('orders:print.kicker'))}</div>
            <div class="brand">Puntovivo</div>
            <div class="receipt-number">${escapeHtml(order.orderNumber)}</div>
            <div class="muted">${escapeHtml(formatDateTime(order.createdAt))}</div>
          </header>

          <section class="meta">
            <span class="section-label">${escapeHtml(t('orders:print.info'))}</span>
            <div class="meta-grid">
              <div class="meta-row">
                <span class="muted">${escapeHtml(t('orders:print.provider'))}</span>
                <span>${escapeHtml(order.providerName ?? '—')}</span>
              </div>
              <div class="meta-row">
                <span class="muted">${escapeHtml(t('orders:print.site'))}</span>
                <span>${escapeHtml(order.siteName ?? '—')}</span>
              </div>
              <div class="meta-row">
                <span class="muted">${escapeHtml(t('orders:print.status'))}</span>
                <span>${escapeHtml(t(`orders:status.${order.status}`))}</span>
              </div>
              <div class="meta-row">
                <span class="muted">${escapeHtml(t('orders:print.createdAt'))}</span>
                <span>${escapeHtml(formatDateTime(order.createdAt))}</span>
              </div>
              <div class="meta-row">
                <span class="muted">${escapeHtml(t('orders:print.updatedAt'))}</span>
                <span>${escapeHtml(formatDateTime(order.updatedAt))}</span>
              </div>
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t('orders:print.columns.item'))}</th>
                <th>${escapeHtml(t('orders:print.columns.code'))}</th>
                <th>${escapeHtml(t('orders:print.columns.quantity'))}</th>
                ${
                  showReceiptProgress
                    ? `<th>${escapeHtml(t('orders:print.columns.received'))}</th>
                <th>${escapeHtml(t('orders:print.columns.pending'))}</th>`
                    : ''
                }
                <th>${escapeHtml(t('orders:print.columns.unitCost'))}</th>
                <th>${escapeHtml(t('orders:print.columns.total'))}</th>
              </tr>
            </thead>
            <tbody>
              ${buildOrderRows(order, showReceiptProgress)}
            </tbody>
          </table>

          <section class="summary">
            <span class="section-label">${escapeHtml(t('orders:print.totalsLabel'))}</span>
            <div class="summary-grid">
              <div class="summary-row">
                <span class="muted">${escapeHtml(t('orders:print.totals.subtotal'))}</span>
                <span>${escapeHtml(formatCurrency(order.subtotal))}</span>
              </div>
              <div class="summary-row total-row">
                <span>${escapeHtml(t('orders:print.totals.total'))}</span>
                <span>${escapeHtml(formatCurrency(order.total))}</span>
              </div>
            </div>
          </section>

          ${notesSection}

          <footer class="footer">
            <p>${escapeHtml(t('orders:print.itemCount', { count: items.length }))}</p>
            <p>${escapeHtml(t('orders:print.footer'))}</p>
          </footer>
        </main>
${autoPrint ? AUTO_PRINT_SCRIPT : ''}
      </body>
    </html>
  `;
}

export async function printOrderDocument(order: PrintableOrder): Promise<void> {
  if (!canPrintOrder(order)) {
    throw new OrderPrintError(
      'notPrintable',
      'Only a submitted or partially received order can be printed'
    );
  }

  await printHtmlDocument({
    buildHtml: options => buildOrderDocumentHtml(order, options),
    createError: (code, message) => new OrderPrintError(code, message),
    desktopBridgeFailedMessage: 'Unable to print the purchase order',
    unknownErrorMessage: 'Unable to print the purchase order',
    // Closing the native print dialog is an operator choice, not a printer
    // failure — mirror the sale receipt printer, which returns quietly.
    cancelledDialogIsSuccess: true,
  });
}
