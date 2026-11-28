import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/lib/utils';
import {
  AUTO_PRINT_SCRIPT,
  buildReceiptStyleTag,
  escapeHtml,
  printHtmlDocument,
} from '@/lib/receiptDocumentPrint';
import type { QuotationDetail, QuotationStatus } from '@/types';
import { formatQuotationTaxLabel } from './quotationTaxLabel';

/**
 * printable quotation receipt.
 *
 * Mirrors `features/sales/receiptPrinter.ts` in spirit with these differences:
 *   - No tenders / payment status (a quotation is not settled).
 *   - Shows `Validity` in place of Payment.
 *   - Shows per-line tax rate so the customer can see their gross-priced
 *     unit price decomposed.
 *   - The escaping, the receipt stylesheet shell, the auto-print snippet and
 *     the Electron/browser print bridge are shared with
 *     `features/orders/orderPrinter.ts` through `@/lib/receiptDocumentPrint`; the
 *     browser fallback uses the shared Blob URL helper rather than
 *     `document.write`, which sidesteps the XSS-adjacent footgun flagged by
 *     the repo's security hook and cleans up via `URL.revokeObjectURL`.
 */

type PrintableQuotation = Pick<
  QuotationDetail,
  | 'quotationNumber'
  | 'customerName'
  | 'priceTier'
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

  constructor(code: 'popupBlocked' | 'desktopBridgeFailed' | 'unknown', message: string) {
    super(message);
    this.code = code;
    this.name = 'QuotationPrintError';
  }
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
      const quantity = escapeHtml(formatNumber(item.quantity));
      const unitPrice = escapeHtml(formatCurrency(item.unitPrice));
      const taxLabel = formatQuotationTaxLabel(item);
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
  const validityLabel = quotation.validUntil ? formatDate(quotation.validUntil) : '—';
  const notesSection = quotation.notes
    ? `
      <section class="notes">
        <div class="section-label">Notes</div>
        <p>${escapeHtml(quotation.notes)}</p>
      </section>
    `
    : '';

  // Only the item columns differ from the purchase order document.
  const styleTag = buildReceiptStyleTag(`
          .item-name { width: 42%; padding-right: 8px; }
          .item-qty, .item-price, .item-tax, .item-total {
            text-align: right;
            white-space: nowrap;
          }
`);

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(`Quotation ${quotation.quotationNumber}`)}</title>${styleTag}
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
                <span class="muted">Price tier</span>
                <span>${escapeHtml(`Tier ${quotation.priceTier}`)}</span>
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
${autoPrint ? AUTO_PRINT_SCRIPT : ''}
      </body>
    </html>
  `;
}

export async function printQuotationReceipt(quotation: PrintableQuotation): Promise<void> {
  await printHtmlDocument({
    buildHtml: options => buildQuotationReceiptHtml(quotation, options),
    createError: (code, message) => new QuotationPrintError(code, message),
    desktopBridgeFailedMessage: 'Unable to print the quotation',
    unknownErrorMessage: 'Unable to print the quotation',
  });
}
