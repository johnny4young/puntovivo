import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('renders a single loyalty tender with its frozen point quantity', () => {
    const sale = buildSale({
      paymentMethod: 'loyalty',
      payments: [
        {
          id: 'pay_loyalty',
          method: 'loyalty',
          amount: 25,
          loyaltyPoints: 50,
          reference: null,
          createdAt: '2026-04-17T15:00:00.000Z',
        },
      ],
    });

    render(
      <SaleDetailsContent sale={sale} returnError={null} voidError={null} printError={null} />
    );

    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.getByText('Settled with 1 tender')).toBeInTheDocument();
    expect(screen.getAllByText('Loyalty points')).toHaveLength(2);
    expect(screen.getByText('50 points')).toBeInTheDocument();
    expect(screen.getByText('$25.00')).toBeInTheDocument();
  });

  it('renders a single store-credit tender with the localized enum label', () => {
    const sale = buildSale({
      paymentMethod: 'store_credit',
      payments: [
        {
          id: 'pay_store_credit',
          method: 'store_credit',
          amount: 25,
          reference: null,
          createdAt: '2026-04-17T15:00:00.000Z',
        },
      ],
    });

    render(
      <SaleDetailsContent sale={sale} returnError={null} voidError={null} printError={null} />
    );

    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.getByText('Settled with 1 tender')).toBeInTheDocument();
    expect(screen.getAllByText('Store credit')).toHaveLength(2);
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.queryByText('payment.store_credit')).not.toBeInTheDocument();
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

  it('shows immutable serial provenance on the sold line', () => {
    const sale = buildSale({
      items: [
        {
          ...buildSale().items![0]!,
          serialNumbers: ['SN-001', 'SN-002'],
        },
      ],
    });

    render(
      <SaleDetailsContent sale={sale} returnError={null} voidError={null} printError={null} />
    );

    expect(screen.getByText('Serial numbers:')).toBeVisible();
    expect(screen.getByText('SN-001, SN-002')).toBeVisible();
  });

  it('renders the frozen promotion name and savings from the sold line snapshot', () => {
    const sale = buildSale({
      currencyCode: 'USD',
      items: [
        {
          ...buildSale().items![0]!,
          promotionDiscountAmount: 15,
          promotions: [
            {
              id: 'sale-item-promotion-1',
              promotionId: 'promotion-1',
              promotionVersion: 3,
              nameSnapshot: 'Weekend coffee offer',
              discountPct: 15,
              discountAmount: 15,
              priority: 100,
              combinable: false,
              position: 0,
              source: 'manual',
              sourceLotId: null,
            },
          ],
        },
      ],
    });

    render(
      <SaleDetailsContent sale={sale} returnError={null} voidError={null} printError={null} />
    );

    expect(screen.getByTestId('sale-item-promotions-item_1')).toHaveTextContent(
      'Weekend coffee offer · saved $15.00'
    );
  });

  it('renders frozen customer and product labels after catalog records change', () => {
    render(
      <SaleDetailsContent
        sale={buildSale({
          customerName: 'Current customer name',
          customerNameSnapshot: 'Customer at checkout',
          items: [
            {
              ...buildSale().items![0]!,
              productName: 'Current product name',
              productNameSnapshot: 'Product at checkout',
              productSku: 'CURRENT-SKU',
              productSkuSnapshot: 'SALE-SKU',
            },
          ],
        })}
        returnError={null}
        voidError={null}
        printError={null}
      />
    );

    expect(screen.getByText('Customer at checkout')).toBeVisible();
    expect(screen.getByText('Product at checkout')).toBeVisible();
    expect(screen.getByText(/SALE-SKU/)).toBeVisible();
    expect(screen.queryByText('Current customer name')).not.toBeInTheDocument();
    expect(screen.queryByText('Current product name')).not.toBeInTheDocument();
  });

  it('renders normalized partial-return history and starts an independent replacement sale', async () => {
    const onStartExchange = vi.fn();
    const user = userEvent.setup();
    const saleReturn = {
      id: 'return-1',
      saleId: 'sale_1',
      destination: 'store_credit' as const,
      subtotal: 50,
      tipAmount: 0,
      serviceChargeAmount: 0,
      discountAmount: 0,
      taxAmount: 0,
      refundAmount: 50,
      currencyCode: 'USD',
      reason: 'wrong_item',
      createdAt: '2026-04-18T15:00:00.000Z',
      legacyFullTicket: false,
      items: [
        {
          id: 'return-item-1',
          saleReturnId: 'return-1',
          saleItemId: 'item_1',
          productId: 'product_1',
          productNameSnapshot: 'Coffee Beans',
          productSkuSnapshot: 'COF-001',
          quantity: 0.5,
          baseQuantity: 0.5,
          unitPrice: 100,
          subtotal: 50,
          discountAmount: 0,
          taxAmount: 0,
          total: 50,
          lots: [],
          serials: [],
        },
      ],
      paymentAllocations: [],
      exchange: null,
    };
    const sale = buildSale({
      paymentStatus: 'partially_refunded',
      returnedAmount: 50,
      returnableAmount: 50,
      returnedAt: saleReturn.createdAt,
      returns: [saleReturn],
      items: [
        {
          ...buildSale().items![0]!,
          returnedQuantity: 0.5,
          remainingQuantity: 0.5,
          returnedAmount: 50,
          returnableAmount: 50,
        },
      ],
    });

    const view = render(
      <SaleDetailsContent
        sale={sale}
        returnError={null}
        voidError={null}
        printError={null}
        onStartExchange={onStartExchange}
      />
    );

    expect(screen.getAllByText('Partially returned')).toHaveLength(2);
    expect(screen.getByText('Return history (1)')).toBeVisible();
    expect(screen.getByText(/Customer store credit/)).toBeVisible();
    expect(screen.getByText('0.5 returned')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Start replacement sale' }));
    expect(onStartExchange).toHaveBeenCalledWith(saleReturn);

    view.rerender(
      <SaleDetailsContent
        sale={{
          ...sale,
          returns: [
            {
              ...saleReturn,
              exchange: {
                id: 'exchange-1',
                saleReturnId: saleReturn.id,
                replacementSaleId: 'replacement-sale-1',
                replacementSaleNumber: 'VTA-000124',
                createdAt: '2026-04-18T16:00:00.000Z',
              },
            },
          ],
        }}
        returnError={null}
        voidError={null}
        printError={null}
        onStartExchange={onStartExchange}
      />
    );
    expect(screen.getByText('Replacement sale VTA-000124 linked')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Start replacement sale' })
    ).not.toBeInTheDocument();
  });
});
