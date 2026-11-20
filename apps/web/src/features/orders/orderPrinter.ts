import i18next from 'i18next';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import { openHtmlInPrintWindow } from '@/lib/printWindow';
import type { Order } from '@/types';

/**
 * printable purchase order.
 *
 * Mirrors `features/quotations/quotationPrinter.ts` (same HTML shell, escape
 * helper, Electron bridge fallback and Blob-URL print window) so the operator
 * can hand or send the supplier the requested list. Differences:
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function buildOrderRows(order: PrintableOrder, showReceiptProgress: boolean): string {
  return (order.items ?? [])
    .map(item => {
      const productLabel = item.productName || item.productSku || item.productId;
      const received = item.receivedQuantity ?? 0;
      const pending = item.remainingQuantity ?? item.quantity;

      const progressCells = showReceiptProgress
        ? `
          <td class="item-received">${escapeHtml(formatNumber(received))}</td>
          <td class="item-pending">${escapeHtml(formatNumber(pending))}</td>
        `
        : '';

      return `
        <tr>
          <td class="item-name">${escapeHtml(productLabel)}</td>
          <td class="item-code">${escapeHtml(item.productSku ?? '')}</td>
          <td class="item-qty">${escapeHtml(formatNumber(item.quantity))}</td>
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

  return `
    <!DOCTYPE html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(t('orders:print.title', { orderNumber: order.orderNumber }))}</title>
        <style>
          :root { color-scheme: light; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 24px 18px;
            background: #ffffff;
            color: #0f172a;
            font-family: "SF Mono", "Roboto Mono", "Menlo", monospace;
            font-size: 12px;
            line-height: 1.45;
          }
          .receipt { width: 100%; max-width: 420px; margin: 0 auto; }
          .header, .summary, .notes, .meta {
            border-bottom: 1px dashed #cbd5e1;
            padding-bottom: 12px;
            margin-bottom: 12px;
          }
          .brand {
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .kicker {
            color: #475569;
            font-size: 10px;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          .receipt-number {
            margin-top: 4px;
            font-size: 14px;
            font-weight: 700;
          }
          .muted, .section-label { color: #475569; }
          .section-label {
            display: block;
            margin-bottom: 4px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }
          .meta-grid, .summary-grid { display: grid; gap: 6px; }
          .meta-row, .summary-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
          }
          th, td {
            padding: 6px 0;
            vertical-align: top;
            border-bottom: 1px dotted #e2e8f0;
          }
          th {
            text-align: left;
            color: #475569;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-transform: uppercase;
          }
          .item-name { width: 34%; padding-right: 8px; }
          .item-code { color: #475569; padding-right: 6px; }
          .item-qty, .item-received, .item-pending, .item-cost, .item-total {
            text-align: right;
            white-space: nowrap;
          }
          .total-row { font-size: 14px; font-weight: 700; }
          .footer {
            text-align: center;
            color: #475569;
            font-size: 11px;
          }
          @media print { body { padding: 10px; } }
        </style>
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
        ${
          autoPrint
            ? `
              <script>
                window.addEventListener('load', () => {
                  window.print();
                });
              </script>
            `
            : ''
        }
      </body>
    </html>
  `;
}

async function openBrowserPrintWindow(documentHtml: string): Promise<void> {
  const printWindow = openHtmlInPrintWindow(documentHtml, {
    features: 'noopener,noreferrer,width=480,height=720',
  });

  if (!printWindow) {
    throw new OrderPrintError(
      'popupBlocked',
      'Unable to open the print window. Check the browser popup settings.'
    );
  }
}

export async function printOrderDocument(order: PrintableOrder): Promise<void> {
  if (!canPrintOrder(order)) {
    throw new OrderPrintError(
      'notPrintable',
      'Only a submitted or partially received order can be printed'
    );
  }

  if (window.electron?.printReceipt) {
    const result = await window.electron.printReceipt(
      await buildOrderDocumentHtml(order, { autoPrint: false })
    );

    if (!result.success) {
      throw new OrderPrintError(
        'desktopBridgeFailed',
        result.error || 'Unable to print the purchase order'
      );
    }

    return;
  }

  try {
    await openBrowserPrintWindow(await buildOrderDocumentHtml(order, { autoPrint: true }));
  } catch (error) {
    if (error instanceof OrderPrintError) {
      throw error;
    }
    throw new OrderPrintError('unknown', 'Unable to print the purchase order');
  }
}
