import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { PaymentStatus, PaymentMethod, SaleItem, SaleStatus } from '@/types';

type ReceiptSale = {
  saleNumber: string;
  customerName?: string | null;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: SaleStatus;
  notes?: string | null;
  createdAt: string;
  items?: SaleItem[];
};

type ReceiptHtmlOptions = {
  autoPrint: boolean;
};

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

function getItemDescription(item: SaleItem): string {
  const productLabel = item.productName ?? item.productSku ?? item.productId;
  const unitLabel = item.unitAbbreviation ?? item.unitName ?? item.unitId ?? 'unit';
  return `${productLabel} (${unitLabel})`;
}

function buildReceiptRows(items: SaleItem[]): string {
  return items
    .map(item => {
      const description = escapeHtml(getItemDescription(item));
      const quantity = escapeHtml(String(item.quantity));
      const unitPrice = escapeHtml(formatCurrency(item.unitPrice));
      const total = escapeHtml(formatCurrency(item.total));

      return `
        <tr>
          <td class="item-name">${description}</td>
          <td class="item-qty">${quantity}</td>
          <td class="item-price">${unitPrice}</td>
          <td class="item-total">${total}</td>
        </tr>
      `;
    })
    .join('');
}

export function buildSaleReceiptHtml(
  sale: ReceiptSale,
  { autoPrint }: ReceiptHtmlOptions = { autoPrint: false }
): string {
  const items = sale.items ?? [];
  const discountAmount = sale.discountAmount ?? 0;
  const notesSection = sale.notes
    ? `
      <section class="notes">
        <div class="section-label">Notes</div>
        <p>${escapeHtml(sale.notes)}</p>
      </section>
    `
    : '';

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(`Receipt ${sale.saleNumber}`)}</title>
        <style>
          :root {
            color-scheme: light;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 24px 18px;
            background: #ffffff;
            color: #0f172a;
            font-family: "SF Mono", "Roboto Mono", "Menlo", monospace;
            font-size: 12px;
            line-height: 1.45;
          }

          .receipt {
            width: 100%;
            max-width: 360px;
            margin: 0 auto;
          }

          .header,
          .summary,
          .notes,
          .meta {
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

          .receipt-number {
            margin-top: 4px;
            font-size: 14px;
            font-weight: 700;
          }

          .muted,
          .section-label {
            color: #475569;
          }

          .section-label {
            display: block;
            margin-bottom: 4px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }

          .meta-grid,
          .summary-grid {
            display: grid;
            gap: 6px;
          }

          .meta-row,
          .summary-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
          }

          th,
          td {
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

          .item-name {
            width: 46%;
            padding-right: 8px;
          }

          .item-qty,
          .item-price,
          .item-total {
            text-align: right;
            white-space: nowrap;
          }

          .total-row {
            font-size: 14px;
            font-weight: 700;
          }

          .footer {
            text-align: center;
            color: #475569;
            font-size: 11px;
          }

          @media print {
            body {
              padding: 10px;
            }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          <header class="header">
            <div class="brand">Puntovivo</div>
            <div class="receipt-number">${escapeHtml(sale.saleNumber)}</div>
            <div class="muted">${escapeHtml(formatDateTime(sale.createdAt))}</div>
          </header>

          <section class="meta">
            <span class="section-label">Sale Info</span>
            <div class="meta-grid">
              <div class="meta-row">
                <span class="muted">Customer</span>
                <span>${escapeHtml(sale.customerName ?? 'Walk-in')}</span>
              </div>
              <div class="meta-row">
                <span class="muted">Payment</span>
                <span>${escapeHtml(sale.paymentMethod)} / ${escapeHtml(sale.paymentStatus)}</span>
              </div>
              <div class="meta-row">
                <span class="muted">Status</span>
                <span>${escapeHtml(sale.status)}</span>
              </div>
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${buildReceiptRows(items)}
            </tbody>
          </table>

          <section class="summary">
            <span class="section-label">Totals</span>
            <div class="summary-grid">
              <div class="summary-row">
                <span class="muted">Subtotal</span>
                <span>${escapeHtml(formatCurrency(sale.subtotal))}</span>
              </div>
              <div class="summary-row">
                <span class="muted">VAT</span>
                <span>${escapeHtml(formatCurrency(sale.taxAmount))}</span>
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
                <span>${escapeHtml(formatCurrency(sale.total))}</span>
              </div>
            </div>
          </section>

          ${notesSection}

          <footer class="footer">
            <p>Items: ${items.length}</p>
            <p>Thank you for your purchase.</p>
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
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=420,height=720');

  if (!printWindow) {
    throw new Error('Unable to open the print window. Check the browser popup settings.');
  }

  printWindow.document.open();
  printWindow.document.write(receiptHtml);
  printWindow.document.close();
}

export async function printSaleReceipt(sale: ReceiptSale): Promise<void> {
  if (window.electron?.printReceipt) {
    const result = await window.electron.printReceipt(buildSaleReceiptHtml(sale, { autoPrint: false }));

    if (!result.success) {
      throw new Error(result.error || 'Unable to print the receipt');
    }

    return;
  }

  await openBrowserPrintWindow(buildSaleReceiptHtml(sale, { autoPrint: true }));
}
