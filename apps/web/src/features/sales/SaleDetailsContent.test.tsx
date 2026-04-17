import { beforeAll, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { Sale } from '@/types';
import { SaleDetailsContent } from './SaleDetailsContent';

function buildSale(overrides?: Partial<Sale>): Sale {
  return {
    id: 'sale_1',
    tenantId: 'tenant_1',
    saleNumber: 'POS-000123',
    customerId: null,
    customerName: null,
    subtotal: 100,
    taxAmount: 0,
    discountAmount: 0,
    total: 100,
    paymentMethod: 'card',
    paymentStatus: 'paid',
    status: 'completed',
    notes: null,
    createdBy: 'user_1',
    createdAt: '2026-04-17T15:00:00.000Z',
    updatedAt: '2026-04-17T15:00:00.000Z',
    items: [
      {
        id: 'item_1',
        saleId: 'sale_1',
        productId: 'product_1',
        productName: 'Coffee Beans',
        productSku: 'COF-001',
        quantity: 1,
        unitPrice: 100,
        unitId: 'unit_1',
        unitEquivalence: 1,
        unitName: 'Bag',
        unitAbbreviation: 'bg',
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        total: 100,
      },
    ],
    ...overrides,
  };
}

describe('SaleDetailsContent — split payments breakdown', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('hides the Payments section for single-tender sales to avoid one-row noise', () => {
    const sale = buildSale({
      payments: [
        {
          id: 'pay_1',
          method: 'card',
          amount: 100,
          reference: null,
          createdAt: '2026-04-17T15:00:00.000Z',
        },
      ],
    });

    render(
      <SaleDetailsContent sale={sale} returnError={null} voidError={null} printError={null} />
    );

    expect(screen.queryByText('Payments')).not.toBeInTheDocument();
    expect(screen.queryByText(/Settled with \d+ tenders/i)).not.toBeInTheDocument();
  });

  it('renders one row per tender and shows the trimmed reference for a split sale', () => {
    const sale = buildSale({
      payments: [
        {
          id: 'pay_1',
          method: 'cash',
          amount: 40,
          reference: null,
          createdAt: '2026-04-17T15:00:00.000Z',
        },
        {
          id: 'pay_2',
          method: 'card',
          amount: 60,
          // Reference arrives from the server as-stored — the view should
          // render it verbatim without inventing whitespace handling.
          reference: 'AUTH-42',
          createdAt: '2026-04-17T15:00:00.000Z',
        },
      ],
    });

    render(
      <SaleDetailsContent sale={sale} returnError={null} voidError={null} printError={null} />
    );

    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.getByText('Settled with 2 tenders')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getByText('$60.00')).toBeInTheDocument();
    expect(screen.getByText('AUTH-42')).toBeInTheDocument();
  });

  it('falls back to the placeholder when a tender reference is blank or whitespace-only', () => {
    const sale = buildSale({
      payments: [
        {
          id: 'pay_1',
          method: 'cash',
          amount: 50,
          reference: '   ',
          createdAt: '2026-04-17T15:00:00.000Z',
        },
        {
          id: 'pay_2',
          method: 'transfer',
          amount: 50,
          reference: null,
          createdAt: '2026-04-17T15:00:00.000Z',
        },
      ],
    });

    render(
      <SaleDetailsContent sale={sale} returnError={null} voidError={null} printError={null} />
    );

    // Both rows should collapse to the dash placeholder rather than rendering
    // a stray whitespace string or the word "null".
    const placeholders = screen.getAllByText('—');
    expect(placeholders.length).toBeGreaterThanOrEqual(2);
  });
});
