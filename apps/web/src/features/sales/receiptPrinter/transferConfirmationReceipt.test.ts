/**
 * Transfer confirmation block on the printed receipt (Fase 5.7 / T4).
 *
 * The receipt is the customer-facing copy of the transfer evidence: the frozen
 * destination, the bank reference, the confirmation state and the split between
 * confirmed and still-unconfirmed money. Historical receipts — sales whose
 * tenders were written before the confirmation lifecycle existed — must keep
 * printing exactly what they print today.
 */

import { describe, expect, it } from 'vitest';
import i18next from '@/i18n';
import { buildSaleReceiptHtml } from '@/features/sales/receiptPrinter';
import type { Sale, SalePayment } from '@/types';

const baseSale: Sale = {
  id: 'sale_transfer_1',
  tenantId: 'tenant_1',
  saleNumber: 'POS-000900',
  customerName: 'Ana Torres',
  subtotal: 95.8,
  taxAmount: 18.2,
  discountAmount: 0,
  total: 114,
  paymentMethod: 'transfer',
  paymentStatus: 'paid',
  returnState: null,
  status: 'completed',
  createdBy: 'user_1',
  createdAt: '2026-07-14T15:00:00.000Z',
  updatedAt: '2026-07-14T15:00:00.000Z',
  items: [
    {
      id: 'item_1',
      saleId: 'sale_transfer_1',
      productId: 'product_1',
      productName: 'Coffee Beans',
      productSku: 'COF-001',
      quantity: 1,
      unitPrice: 114,
      unitId: 'unit_1',
      unitEquivalence: 1,
      unitName: 'Bag',
      unitAbbreviation: 'bg',
      discount: 0,
      taxRate: 19,
      taxKind: 'iva',
      taxAmount: 18.2,
      costAtSale: 70,
      total: 114,
    },
  ],
};

const frozenDestination = {
  id: 'dest_bancolombia',
  label: 'Bancolombia <4821>',
  kind: 'bank_account',
};

function transferPayment(overrides: Partial<SalePayment> = {}): SalePayment {
  return {
    id: 'pay_transfer',
    method: 'transfer',
    amount: 114,
    reference: 'M-482190',
    createdAt: baseSale.createdAt,
    ...overrides,
  };
}

function countSections(html: string): number {
  return (html.match(/<section/g) ?? []).length;
}

describe('receipt transfer confirmation', () => {
  it('prints the frozen destination, reference, status and the confirmed/pending split', async () => {
    const html = await buildSaleReceiptHtml({
      ...baseSale,
      payments: [
        transferPayment({
          id: 'pay_confirmed',
          amount: 60,
          reference: 'REF-A',
          confirmationStatus: 'provider_confirmed',
          confirmationSource: 'provider_api',
          confirmedAt: '2026-07-14T15:05:00.000Z',
          destinationSnapshot: frozenDestination,
        }),
        transferPayment({
          id: 'pay_pending',
          amount: 54,
          reference: 'REF-B',
          confirmationStatus: 'pending',
          destinationSnapshot: frozenDestination,
        }),
      ],
    });

    expect(html).toContain('<section class="summary transfer-confirmation">');
    expect(html).toContain('Transfer confirmation');
    // Frozen snapshot label, escaped by the same guard as the rest of the receipt.
    expect(html).toContain(
      '<span class="muted">Destination</span><span>Bancolombia &lt;4821&gt;</span>'
    );
    expect(html).toContain('<span class="muted">Reference</span><span>REF-A</span>');
    expect(html).toContain('<span class="muted">Status</span><span>Provider confirmed</span>');
    expect(html).toContain('<span class="muted">Reference</span><span>REF-B</span>');
    expect(html).toContain('<span class="muted">Status</span><span>Pending</span>');
    // Sale total, confirmed total and pending confirmation are reported apart.
    expect(html).toContain('<span class="muted">Sale total</span><span>$114.00</span>');
    expect(html).toContain('<span class="muted">Confirmed total</span><span>$60.00</span>');
    expect(html).toContain('<span class="muted">Pending confirmation</span><span>$54.00</span>');
  });

  it('never counts a rejected or cancelled transfer as received money', async () => {
    const html = await buildSaleReceiptHtml({
      ...baseSale,
      payments: [
        transferPayment({
          id: 'pay_kept',
          amount: 100,
          confirmationStatus: 'manual_confirmed',
          destinationSnapshot: frozenDestination,
        }),
        transferPayment({
          id: 'pay_superseded',
          amount: 14,
          confirmationStatus: 'rejected',
          destinationSnapshot: frozenDestination,
        }),
      ],
    });

    expect(html).toContain('<span class="muted">Confirmed total</span><span>$100.00</span>');
    expect(html).toContain('<span class="muted">Pending confirmation</span><span>$0.00</span>');
    expect(html).toContain('<span class="muted">Status</span><span>Rejected</span>');
  });

  it('prints unapplied money only when the sale recorded it', async () => {
    const surplus = await buildSaleReceiptHtml({
      ...baseSale,
      payments: [
        transferPayment({
          amount: 114,
          confirmationStatus: 'needs_reconciliation',
          destinationSnapshot: frozenDestination,
        }),
      ],
      unappliedTransferAmount: 6,
    });
    expect(surplus).toContain('<span class="muted">Unapplied money</span><span>$6.00</span>');

    const noneKnown = await buildSaleReceiptHtml({
      ...baseSale,
      payments: [
        transferPayment({
          amount: 114,
          confirmationStatus: 'manual_confirmed',
          destinationSnapshot: frozenDestination,
        }),
      ],
    });
    expect(noneKnown).not.toContain('Unapplied money');

    const zeroCaptured = await buildSaleReceiptHtml({
      ...baseSale,
      payments: [
        transferPayment({
          amount: 114,
          confirmationStatus: 'manual_confirmed',
          destinationSnapshot: frozenDestination,
        }),
      ],
      unappliedTransferAmount: 0,
    });
    expect(zeroCaptured).toContain('<span class="muted">Unapplied money</span><span>$0.00</span>');
  });

  it('prints what the server accumulated, so a partial deposit is only partly confirmed', async () => {
    // One 60 deposit against a 114 tender: the pending figure is what is still
    // owed, never the whole tender, and the confirmed figure is what arrived.
    const html = await buildSaleReceiptHtml({
      ...baseSale,
      payments: [
        transferPayment({
          amount: 114,
          confirmationStatus: 'needs_reconciliation',
          destinationSnapshot: frozenDestination,
          appliedAmount: 60,
          surplusAmount: 0,
        }),
      ],
    });

    expect(html).toContain('<span class="muted">Confirmed total</span><span>$0.00</span>');
    expect(html).toContain('<span class="muted">Pending confirmation</span><span>$54.00</span>');
  });

  it('prints the surplus the server reported, not the tender amount, as unapplied', async () => {
    const html = await buildSaleReceiptHtml({
      ...baseSale,
      payments: [
        transferPayment({
          amount: 114,
          confirmationStatus: 'needs_reconciliation',
          destinationSnapshot: frozenDestination,
          appliedAmount: 114,
          surplusAmount: 6,
        }),
      ],
    });

    // Everything the tender could absorb is applied; the excess is reported
    // separately and the tender owes nothing more.
    expect(html).toContain('<span class="muted">Unapplied money</span><span>$6.00</span>');
    expect(html).toContain('<span class="muted">Pending confirmation</span><span>$0.00</span>');
  });

  it('renders a transfer without a frozen destination or reference without crashing', async () => {
    const html = await buildSaleReceiptHtml({
      ...baseSale,
      payments: [
        transferPayment({
          reference: null,
          confirmationStatus: 'customer_reported',
          destinationSnapshot: null,
        }),
      ],
    });

    expect(html).toContain('<span class="muted">Destination</span><span>&mdash;</span>');
    expect(html).toContain('<span class="muted">Reference</span><span>&mdash;</span>');
    expect(html).toContain('<span class="muted">Status</span><span>Reported by customer</span>');
  });

  it('leaves a historical receipt with no confirmation state exactly as it is today', async () => {
    const legacyPayment = transferPayment({ reference: 'M-482190' });
    const legacy = await buildSaleReceiptHtml({ ...baseSale, payments: [legacyPayment] });
    // Same tender shape, no transfer lifecycle: a legacy transfer receipt must
    // not gain a section that an equivalent non-transfer receipt does not have.
    const cardEquivalent = await buildSaleReceiptHtml({
      ...baseSale,
      paymentMethod: 'card',
      payments: [{ ...legacyPayment, method: 'card' }],
    });
    const explicitNulls = await buildSaleReceiptHtml({
      ...baseSale,
      payments: [
        {
          ...legacyPayment,
          confirmationStatus: null,
          confirmationSource: null,
          confirmedAt: null,
          destinationSnapshot: null,
        },
      ],
    });

    // No new section: not even an empty one, so the printed layout is untouched.
    expect(legacy).not.toContain('transfer-confirmation');
    expect(countSections(legacy)).toBe(countSections(cardEquivalent));
    // NULL lifecycle columns render byte for byte like absent ones.
    expect(legacy).toBe(explicitNulls);
    for (const label of [
      'Transfer confirmation',
      'Confirmed total',
      'Pending confirmation',
      'Unapplied money',
      'Sale total',
    ]) {
      expect(legacy).not.toContain(label);
    }

    // Historical evidence still renders exactly as before.
    expect(legacy).toContain('<td class="tender-method">Transfer</td>');
    expect(legacy).toContain('<td class="tender-reference">M-482190</td>');
    expect(legacy).toContain('<div class="summary-row total-row">');
    expect(legacy).toContain('<span>$114.00</span>');
    expect(legacy).toContain('Transfer / Paid');
  });

  it('localizes the transfer block into Spanish', async () => {
    await i18next.changeLanguage('es');
    try {
      const html = await buildSaleReceiptHtml({
        ...baseSale,
        payments: [
          transferPayment({
            confirmationStatus: 'manual_confirmed',
            destinationSnapshot: frozenDestination,
          }),
        ],
        unappliedTransferAmount: 0,
      });

      expect(html).toContain('Confirmación de transferencia');
      expect(html).toContain('Destino');
      expect(html).toContain('Total de la venta');
      expect(html).toContain('Total confirmado');
      expect(html).toContain('Pendiente de confirmación');
      expect(html).toContain('Dinero no aplicado');
      expect(html).toContain('Confirmada manualmente');
    } finally {
      await i18next.changeLanguage('en');
    }
  });
});
