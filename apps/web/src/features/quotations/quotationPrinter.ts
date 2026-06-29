import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { openHtmlInPrintWindow } from '@/lib/printWindow';
import type { QuotationDetail, QuotationStatus } from '@/types';

/**
 * Phase 5 / Tier-2 #6 step 2 — printable quotation receipt.
 *
 * Mirrors `features/sales/receiptPrinter.ts` in spirit (same HTML shell,
 * escape helper, Electron bridge fallback) with these differences:
 *   - No tenders / payment status (a quotation is not settled).
 *   - Shows `Validity` in place of Payment.
 *   - Shows per-line tax rate so the customer can see their gross-priced
 *     unit price decomposed.
 *   - The browser-only fallback uses the shared Blob URL print helper rather
 *     than `document.write`, which sidesteps the XSS-adjacent footgun flagged
 *     by the repo's security hook and cleans up via `URL.revokeObjectURL`.
 */

type PrintableQuotation = Pick<
  QuotationDetail,
  | 'quotationNumber'
  | 'customerName'
  | 'siteName'
  | 'subtotal'
  | 'taxAmount'
  | 'discountAmount'
  | 'total'
  | 'status'
  | 'notes'
  | 'createdAt'
  | 'validUntil'
  | 'items'
>;

interface ReceiptHtmlOptions {
  autoPrint: boolean;
}

export class QuotationPrintError extends Error {
  code: 'popupBlocked' | 'desktopBridgeFailed' | 'unknown';

  constructor(
    code: 'popupBlocked' | 'desktopBridgeFailed' | 'unknown',
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = 'QuotationPrintError';
  }
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

function formatStatusLabel(status: QuotationStatus): string {
  // Capitalize the status for print. The receipt HTML is intentionally
  // English-only today (mirroring the sale receipt); translation-aware
  // variants can come in a later slice alongside the sale receipt pass.
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buildQuotationRows(items: PrintableQuotation['items']): string {
  return items
    .map(item => {
      const productLabel = item.productName || item.productSku || item.productId;
      const description = escapeHtml(productLabel);
      const quantity = escapeHtml(item.quantity.toLocaleString());
      const unitPrice = escapeHtml(formatCurrency(item.unitPrice));
      const taxLabel = item.taxRate > 0 ? `${item.taxRate}%` : '—';
      const total = escapeHtml(formatCurrency(item.total));

      return `
        <tr>
          <td class="item-name">${description}</td>
          <td class="item-qty">${quantity}</td>
          <td class="item-price">${unitPrice}</td>
          <td class="item-tax">${escapeHtml(taxLabel)}</td>
          <td class="item-total">${total}</td>
        </tr>
      `;
    })
    .join('');
}

export function buildQuotationReceiptHtml(
  quotation: PrintableQuotation,
  { autoPrint }: ReceiptHtmlOptions = { autoPrint: false }
): string {
  const items = quotation.items ?? [];
  const discountAmount = quotation.discountAmount ?? 0;
  const validityLabel = quotation.validUntil
    ? formatDate(quotation.validUntil)
    : '—';
  const notesSection = quotation.notes
    ? `
      <section class="notes">
        <div class="section-label">Notes</div>
        <p>${escapeHtml(quotation.notes)}</p>
      </section>
    `
    : '';

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(`Quotation ${quotation.quotationNumber}`)}</title>
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
          .item-name { width: 42%; padding-right: 8px; }
          .item-qty, .item-price, .item-tax, .item-total {
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
            <div class="kicker">Quotation</div>
            <div class="brand">Puntovivo</div>
            <div class="receipt-number">${escapeHtml(quotation.quotationNumber)}</div>
            <div class="muted">${escapeHtml(formatDateTime(quotation.createdAt))}</div>
          </header>

          <section class="meta">
            <span class="section-label">Quote Info</span>
            <div class="meta-grid">
              <div class="meta-row">
                <span class="muted">Customer</span>
                <span>${escapeHtml(quotation.customerName ?? 'Walk-in')}</span>
              </div>
              <div class="meta-row">
                <span class="muted">Site</span>
                <span>${escapeHtml(quotation.siteName)}</span>
              </div>
              <div class="meta-row">
                <span class="muted">Validity</span>
                <span>${escapeHtml(validityLabel)}</span>
              </div>
              <div class="meta-row">
                <span class="muted">Status</span>
                <span>${escapeHtml(formatStatusLabel(quotation.status))}</span>
              </div>
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Tax</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${buildQuotationRows(items)}
            </tbody>
          </table>

          <section class="summary">
            <span class="section-label">Totals</span>
            <div class="summary-grid">
              <div class="summary-row">
                <span class="muted">Subtotal</span>
                <span>${escapeHtml(formatCurrency(quotation.subtotal))}</span>
              </div>
              <div class="summary-row">
                <span class="muted">VAT</span>
                <span>${escapeHtml(formatCurrency(quotation.taxAmount))}</span>
              </div>
              ${
                discountAmount > 0
                  ? `
                    <div class="summary-row">
                      <span class="muted">Discount</span>
                      <span>- ${escapeHtml(formatCurrency(discountAmount))}</span>
                    </div>
                  `
                  : ''
              }
              <div class="summary-row total-row">
                <span>Total</span>
                <span>${escapeHtml(formatCurrency(quotation.total))}</span>
              </div>
            </div>
          </section>

          ${notesSection}

          <footer class="footer">
            <p>Items: ${items.length}</p>
            <p>${
              quotation.validUntil
                ? `Valid until ${escapeHtml(formatDate(quotation.validUntil))}.`
                : 'Please confirm validity with the vendor.'
            }</p>
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

async function openBrowserPrintWindow(receiptHtml: string): Promise<void> {
  const printWindow = openHtmlInPrintWindow(receiptHtml, {
    features: 'noopener,noreferrer,width=480,height=720',
  });

  if (!printWindow) {
    throw new QuotationPrintError(
      'popupBlocked',
      'Unable to open the print window. Check the browser popup settings.'
    );
  }
}

export async function printQuotationReceipt(quotation: PrintableQuotation): Promise<void> {
  if (window.electron?.printReceipt) {
    const result = await window.electron.printReceipt(
      buildQuotationReceiptHtml(quotation, { autoPrint: false })
    );

    if (!result.success) {
      throw new QuotationPrintError(
        'desktopBridgeFailed',
        result.error || 'Unable to print the quotation'
      );
    }

    return;
  }

  try {
    await openBrowserPrintWindow(buildQuotationReceiptHtml(quotation, { autoPrint: true }));
  } catch (error) {
    if (error instanceof QuotationPrintError) {
      throw error;
    }
    throw new QuotationPrintError('unknown', 'Unable to print the quotation');
  }
}
