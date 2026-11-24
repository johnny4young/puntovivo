// Sale-receipt HTML builder + line/payment helpers ( slice 29).
// The fiscal section lives in `./fiscal`; the XSS guard in `./escape`.

import i18next from 'i18next';
import type { TFunction } from 'i18next';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { roundMoney } from '@/lib/money';
import { formatSystemNote } from '@/lib/systemNotes';
import type { SaleItem, SalePayment } from '@/types';
import { paymentsNeedBreakdown } from '../checkoutPayment';
import { escapeHtml } from './escape';
import { buildFiscalSection } from './fiscal';
import type { ReceiptSale } from './types';

type ReceiptHtmlOptions = {
  autoPrint: boolean;
};

/** Quote a trusted label for a CSS `content` string inside the receipt <style>. */
function cssString(value: string): string {
  return `"${value.replace(/["\\\n<]/g, char => `\\${char.charCodeAt(0).toString(16)} `)}"`;
}

function getItemDescription(item: SaleItem, t: TFunction): string {
  const productLabel =
    item.productNameSnapshot ??
    item.productName ??
    item.productSkuSnapshot ??
    item.productSku ??
    item.productId;
  const unitLabel =
    item.unitAbbreviation ?? item.unitName ?? item.unitId ?? t('receipts:fallback.unit');
  return `${productLabel} (${unitLabel})`;
}

function buildPaymentBreakdownSection(payments: SalePayment[] | undefined, t: TFunction): string {
  if (!payments || !paymentsNeedBreakdown(payments)) {
    return '';
  }

  const rows = payments
    .map(payment => {
      const method = escapeHtml(
        t(`sales:payment.${payment.method}`, { defaultValue: payment.method })
      );
      const amount = escapeHtml(formatCurrency(payment.amount));
      const reference = escapeHtml(payment.reference?.trim() ?? '');
      return `
        <tr>
          <td class="tender-method">${method}</td>
          <td class="tender-reference">${reference || '&mdash;'}</td>
          <td class="tender-amount">${amount}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <section class="tenders">
      <span class="section-label">${escapeHtml(t('receipts:fallback.tenders'))}</span>
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(t('receipts:fallback.method'))}</th>
            <th>${escapeHtml(t('receipts:fallback.reference'))}</th>
            <th class="tender-amount">${escapeHtml(t('receipts:fallback.amount'))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
  `;
}

/** Only these two count as received money; every other state is still in doubt. */
function isConfirmedTransfer(status: SalePayment['confirmationStatus']): boolean {
  return status === 'manual_confirmed' || status === 'provider_confirmed';
}

/** Reported by the customer or parked for reconciliation: received? not proven. */
function isPendingTransfer(status: SalePayment['confirmationStatus']): boolean {
  return (
    status === 'pending' || status === 'customer_reported' || status === 'needs_reconciliation'
  );
}

/**
 * Transfer-confirmation evidence for the customer copy (Fase 5.7).
 *
 * Renders nothing unless at least one tender actually carries a confirmation
 * state, so a receipt reprinted from a sale recorded before the lifecycle
 * existed keeps its exact current layout. Confirmed and pending money are
 * reported as separate figures: adding them together would print unreceived
 * money as if it were collected.
 */
function buildTransferConfirmationSection(sale: ReceiptSale, t: TFunction): string {
  const transfers = (sale.payments ?? []).filter(
    payment => payment.method === 'transfer' && payment.confirmationStatus != null
  );
  if (transfers.length === 0) {
    return '';
  }

  // A tender repays what its movements actually added up to. A partially
  // deposited transfer leaves the rest pending, and money that arrived above
  // the tender is never counted as sale revenue.
  let confirmed = 0;
  let pending = 0;
  let reportedUnapplied = 0;
  let hasReportedUnapplied = false;
  for (const transfer of transfers) {
    const confirmedStatus = isConfirmedTransfer(transfer.confirmationStatus);
    const applied =
      typeof transfer.appliedAmount === 'number'
        ? transfer.appliedAmount
        : confirmedStatus
          ? transfer.amount
          : 0;
    if (confirmedStatus) {
      confirmed = roundMoney(confirmed + applied);
    } else if (isPendingTransfer(transfer.confirmationStatus)) {
      pending = roundMoney(pending + Math.max(0, roundMoney(transfer.amount - applied)));
    }
    if (typeof transfer.surplusAmount === 'number') {
      hasReportedUnapplied = true;
      reportedUnapplied = roundMoney(reportedUnapplied + transfer.surplusAmount);
    }
  }

  const row = (label: string, value: string) =>
    `<div class="summary-row"><span class="muted">${escapeHtml(label)}</span><span>${value}</span></div>`;

  const transferRows = transfers
    .map(transfer => {
      const destination = escapeHtml(transfer.destinationSnapshot?.label?.trim() ?? '');
      const reference = escapeHtml(transfer.reference?.trim() ?? '');
      const status = escapeHtml(
        t(`receipts:transfer.statuses.${transfer.confirmationStatus}`, {
          defaultValue: String(transfer.confirmationStatus),
        })
      );
      return [
        row(t('receipts:transfer.destination'), destination || '&mdash;'),
        row(t('receipts:transfer.reference'), reference || '&mdash;'),
        row(t('receipts:transfer.status'), status),
        row(t('receipts:transfer.amount'), escapeHtml(formatCurrency(transfer.amount))),
      ].join('');
    })
    .join('');

  // A known zero is evidence; an absent figure is not, so it prints nothing.
  // The per-tender surplus the server reports wins over any sale-level figure.
  const unappliedAmount = hasReportedUnapplied ? reportedUnapplied : sale.unappliedTransferAmount;
  const unappliedRow =
    typeof unappliedAmount === 'number'
      ? row(t('receipts:transfer.unapplied'), escapeHtml(formatCurrency(unappliedAmount)))
      : '';

  return `
    <section class="summary transfer-confirmation">
      <span class="section-label">${escapeHtml(t('receipts:transfer.sectionTitle'))}</span>
      <div class="summary-grid">${transferRows}</div>
      <div class="summary-grid">
        ${row(t('receipts:transfer.saleTotal'), escapeHtml(formatCurrency(sale.total)))}
        ${row(t('receipts:transfer.confirmedTotal'), escapeHtml(formatCurrency(confirmed)))}
        ${row(t('receipts:transfer.pendingTotal'), escapeHtml(formatCurrency(pending)))}
        ${unappliedRow}
      </div>
    </section>
  `;
}

function buildReceiptRows(items: SaleItem[], t: TFunction): string {
  return items
    .map(item => {
      const description = escapeHtml(getItemDescription(item, t));
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

function buildTaxSummaryRows(items: SaleItem[], compatibilityTotal: number, t: TFunction): string {
  if (
    items.length === 0 ||
    items.some(item => !item.taxComponents?.length && item.taxKind === undefined)
  ) {
    return `<div class="summary-row"><span class="muted">${escapeHtml(t('receipts:fallback.tax'))}</span><span>${escapeHtml(formatCurrency(compatibilityTotal))}</span></div>`;
  }

  const totals: Record<'iva' | 'inc', number | null> = { iva: null, inc: null };
  for (const item of items) {
    const components = item.taxComponents?.length
      ? item.taxComponents
      : [{ taxKind: item.taxKind!, taxAmount: item.taxAmount }];
    for (const component of components) {
      totals[component.taxKind] = roundMoney(
        (totals[component.taxKind] ?? 0) + component.taxAmount
      );
    }
  }
  return (['iva', 'inc'] as const)
    .flatMap(kind =>
      totals[kind] === null
        ? []
        : [
            `<div class="summary-row"><span class="muted">${kind.toUpperCase()}</span><span>${escapeHtml(formatCurrency(totals[kind]!))}</span></div>`,
          ]
    )
    .join('');
}

export async function buildSaleReceiptHtml(
  sale: ReceiptSale,
  { autoPrint }: ReceiptHtmlOptions = { autoPrint: false }
): Promise<string> {
  // Same language source as the fiscal section: the operator's active locale.
  await i18next.loadNamespaces(['receipts', 'sales']);
  const t = i18next.getFixedT(null, ['receipts', 'sales']);
  const language = i18next.resolvedLanguage ?? i18next.language ?? 'en';
  const items = sale.items ?? [];
  const fiscalSection = sale.fiscalDocuments?.length
    ? await buildFiscalSection(sale.fiscalDocuments)
    : '';
  const discountAmount = sale.discountAmount ?? 0;
  const hasIdentitySnapshot = (sale.receiptIdentitySnapshotVersion ?? 0) >= 1;
  const companyName =
    hasIdentitySnapshot && sale.companyNameSnapshot ? sale.companyNameSnapshot : 'Puntovivo';
  const companyDetails = hasIdentitySnapshot
    ? [
        sale.companyTaxIdSnapshot
          ? t('receipts:fallback.taxId', { value: sale.companyTaxIdSnapshot })
          : null,
        sale.companyAddressSnapshot,
        sale.companyPhoneSnapshot,
        sale.companyEmailSnapshot,
      ].filter((value): value is string => Boolean(value))
    : [];
  const notesSection = sale.notes
    ? `
      <section class="notes">
        <div class="section-label">${escapeHtml(t('receipts:fallback.notes'))}</div>
        <p>${escapeHtml(formatSystemNote(sale.notes, t))}</p>
      </section>
    `
    : '';

  return `
    <!DOCTYPE html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(t('receipts:fallback.title', { number: sale.saleNumber }))}</title>
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

          .company-detail {
            margin-top: 2px;
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

          .tenders {
            border-bottom: 1px dashed #cbd5e1;
            padding-bottom: 12px;
            margin-bottom: 12px;
          }

          .tender-method {
            text-transform: capitalize;
          }

          .tender-amount {
            text-align: right;
            white-space: nowrap;
          }

          .tender-reference {
            color: #475569;
            font-size: 11px;
          }

          .footer {
            text-align: center;
            color: #475569;
            font-size: 11px;
          }

          .receipt-fiscal {
            border-bottom: 1px dashed #cbd5e1;
            padding-bottom: 12px;
            margin-bottom: 12px;
          }

          .receipt-fiscal-status {
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }

          .receipt-fiscal-cufe {
            font-family: "SF Mono", "Roboto Mono", "Menlo", monospace;
            font-size: 10px;
            word-break: break-all;
            text-align: right;
            max-width: 240px;
          }

          .receipt-fiscal-notice {
            margin: 10px 0 0;
            border: 1px solid #d97706;
            border-radius: 6px;
            padding: 7px 8px;
            color: #78350f;
            background: #fffbeb;
            font-size: 10px;
            font-weight: 700;
          }

          .receipt-fiscal-qr {
            display: block;
            margin: 12px auto 0;
            width: 120px;
            height: 120px;
          }

          @media print {
            body {
              padding: 0;
              margin: 0 auto;
              width: 48mm;
              max-width: 100%;
              color: #000;
              font-size: 11pt;
              overflow-wrap: anywhere;
            }
            .receipt { max-width: none; }
            .receipt * { color: #000 !important; border-color: #000 !important; background: transparent !important; }
            th, .muted, .footer, .tender-reference, .receipt-fiscal-notice { font-size: 10pt; }
            .total-row { font-size: 14pt; }
            .receipt table, .receipt tbody, .receipt tr, .receipt td { display: block; width: 100%; box-sizing: border-box; }
            .receipt thead { display: none; }
            .receipt tr { margin-bottom: 8px; break-inside: avoid; }
            .receipt td { border: 0; }
            .item-name { width: auto; font-weight: 700; padding-right: 0; }
            .item-qty, .item-price, .item-total { display: flex !important; flex-wrap: wrap; justify-content: space-between; column-gap: 8px; white-space: normal; }
            .item-qty::before { content: ${cssString(t('receipts:fallback.qty'))}; }
            .item-price::before { content: ${cssString(t('receipts:fallback.price'))}; }
            .item-total::before { content: ${cssString(t('receipts:fallback.total'))}; }
            .meta-row, .summary-row { flex-wrap: wrap; }
            .meta-row > :last-child, .summary-row > :last-child { margin-left: auto; max-width: 100%; }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          <header class="header">
            <div class="brand">${escapeHtml(companyName)}</div>
            ${companyDetails
              .map(detail => `<div class="muted company-detail">${escapeHtml(detail)}</div>`)
              .join('')}
            <div class="receipt-number">${escapeHtml(sale.saleNumber)}</div>
            <div class="muted">${escapeHtml(formatDateTime(sale.createdAt))}</div>
          </header>

          <section class="meta">
            <span class="section-label">${escapeHtml(t('receipts:fallback.saleInfo'))}</span>
            <div class="meta-grid">
              <div class="meta-row">
                <span class="muted">${escapeHtml(t('receipts:fallback.customer'))}</span>
                <span>${escapeHtml(sale.customerNameSnapshot ?? sale.customerName ?? t('receipts:fallback.walkIn'))}</span>
              </div>
              ${
                hasIdentitySnapshot && sale.customerTaxIdSnapshot
                  ? `
                    <div class="meta-row">
                      <span class="muted">${escapeHtml(t('receipts:fallback.customerTaxId'))}</span>
                      <span>${escapeHtml(sale.customerTaxIdSnapshot)}</span>
                    </div>
                  `
                  : ''
              }
              <div class="meta-row">
                <span class="muted">${escapeHtml(t('receipts:fallback.payment'))}</span>
                <span>${escapeHtml(t(`sales:payment.${sale.paymentMethod}`, { defaultValue: sale.paymentMethod }))} / ${escapeHtml(t(`sales:paymentStatus.${sale.paymentStatus}`, { defaultValue: sale.paymentStatus }))}</span>
              </div>
              <div class="meta-row">
                <span class="muted">${escapeHtml(t('receipts:fallback.status'))}</span>
                <span>${escapeHtml(t(`sales:status.${sale.status}`, { defaultValue: sale.status }))}</span>
              </div>
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t('receipts:fallback.item'))}</th>
                <th>${escapeHtml(t('receipts:fallback.qty'))}</th>
                <th>${escapeHtml(t('receipts:fallback.price'))}</th>
                <th>${escapeHtml(t('receipts:fallback.total'))}</th>
              </tr>
            </thead>
            <tbody>
              ${buildReceiptRows(items, t)}
            </tbody>
          </table>

          <section class="summary">
            <span class="section-label">${escapeHtml(t('receipts:fallback.totals'))}</span>
            <div class="summary-grid">
              <div class="summary-row">
                <span class="muted">${escapeHtml(t('receipts:fallback.subtotal'))}</span>
                <span>${escapeHtml(formatCurrency(sale.subtotal))}</span>
              </div>
              ${buildTaxSummaryRows(items, sale.taxAmount, t)}
              ${
                discountAmount > 0
                  ? `
                    <div class="summary-row">
                      <span class="muted">${escapeHtml(t('receipts:fallback.discount'))}</span>
                      <span>- ${escapeHtml(formatCurrency(discountAmount))}</span>
                    </div>
                  `
                  : ''
              }
              ${
                sale.roundingAdjustment
                  ? `<div class="summary-row"><span class="muted">${escapeHtml(t('receipts:fallback.rounding'))}</span><span>${escapeHtml(formatCurrency(sale.roundingAdjustment, undefined, undefined, 2))}</span></div>`
                  : ''
              }
              <div class="summary-row total-row">
                <span>${escapeHtml(t('receipts:fallback.total'))}</span>
                <span>${escapeHtml(formatCurrency(sale.total))}</span>
              </div>
            </div>
          </section>

          ${sale.cashReceivedSnapshot != null ? `<section class="summary"><div class="summary-row"><span>${escapeHtml(t('receipts:fallback.cashReceived'))}</span><span>${escapeHtml(formatCurrency(sale.cashReceivedSnapshot))}</span></div><div class="summary-row"><span>${escapeHtml(t('receipts:fallback.change'))}</span><span>${escapeHtml(formatCurrency(sale.cashChangeSnapshot ?? 0))}</span></div></section>` : ''}

          ${buildPaymentBreakdownSection(sale.payments, t)}

          ${buildTransferConfirmationSection(sale, t)}

          ${fiscalSection}

          ${notesSection}

          <footer class="footer">
            <p>${escapeHtml(t('receipts:fallback.itemCount', { count: items.length }))}</p>
            <p>${escapeHtml(t('receipts:fallback.thanks'))}</p>
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
