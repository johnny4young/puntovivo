import { describe, expect, it } from 'vitest';
import { buildSaleReceiptHtml } from '@/features/sales/receiptPrinter';
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

describe('receiptPrinter', () => {
  it('renders escaped receipt details', () => {
    const html = buildSaleReceiptHtml(sale);

    expect(html).toContain('POS-000123');
    expect(html).toContain('Ana &amp; Co');
    expect(html).toContain('Deliver to &lt;front desk&gt;');
    expect(html).toContain('Coffee Beans (bg)');
    expect(html).toContain('$114.00');
  });

  it('includes auto print script only when requested', () => {
    const autoPrintHtml = buildSaleReceiptHtml(sale, { autoPrint: true });
    const regularHtml = buildSaleReceiptHtml(sale, { autoPrint: false });

    expect(autoPrintHtml).toContain('window.print()');
    expect(regularHtml).not.toContain('window.print()');
  });
});
