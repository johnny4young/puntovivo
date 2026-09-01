import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { Sale } from '@/types';
import { RefundConfirmOverlay } from './RefundConfirmOverlay';

const mocks = vi.hoisted(() => ({
  input: null as unknown,
  enabled: false,
  preview: {
    data: {
      refundAmount: 50,
      taxAmount: 0,
      cashAmount: 50,
      externalAmount: 0,
      storeCreditAmount: 0,
      receivableAmount: 0,
      allocations: [
        {
          salePaymentId: 'payment-1' as string | null,
          originalMethod: 'cash',
          destination: 'cash',
          amount: 50,
        },
      ],
    },
    isFetching: false,
    error: null as Error | null,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sales: {
      previewReturn: {
        useQuery: (input: unknown, options: { enabled: boolean }) => {
          mocks.input = input;
          mocks.enabled = options.enabled;
          return {
            ...mocks.preview,
            data:
              (input as { destination?: string }).destination === 'store_credit'
                ? { ...mocks.preview.data, allocations: [] }
                : mocks.preview.data,
          };
        },
      },
    },
  },
}));

function saleFixture(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 'sale-1',
    tenantId: 'tenant-1',
    saleNumber: 'VTA-0001',
    currencyCode: 'USD',
    customerId: null,
    subtotal: 100,
    taxAmount: 0,
    discountAmount: 0,
    total: 100,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    createdBy: 'user-1',
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    items: [
      {
        id: 'line-1',
        saleId: 'sale-1',
        productId: 'product-1',
        productName: 'Coffee',
        quantity: 2,
        remainingQuantity: 2,
        returnedQuantity: 0,
        unitPrice: 50,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        total: 100,
        returnableAmount: 100,
      },
    ],
    payments: [
      {
        id: 'payment-1',
        method: 'cash',
        amount: 100,
        returnedAmount: 0,
        remainingAmount: 100,
        createdAt: '2026-08-31T12:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('RefundConfirmOverlay', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  beforeEach(() => {
    mocks.input = null;
    mocks.enabled = false;
    mocks.preview.data = {
      refundAmount: 50,
      taxAmount: 0,
      cashAmount: 50,
      externalAmount: 0,
      storeCreditAmount: 0,
      receivableAmount: 0,
      allocations: [
        { salePaymentId: 'payment-1', originalMethod: 'cash', destination: 'cash', amount: 50 },
      ],
    };
    mocks.preview.isFetching = false;
    mocks.preview.error = null;
  });

  it('fails closed until an explicit returnable line selection has a server preview', () => {
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        sale={saleFixture()}
        confirmDisabled
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Confirm return' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm return' })).toHaveClass(
      'disabled:bg-secondary-200',
      'disabled:text-secondary-500'
    );
    expect(mocks.enabled).toBe(false);
  });

  it('submits a partial quantity only after the server-authoritative preview', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        sale={saleFixture()}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Return Coffee' }));
    const quantity = screen.getByRole('spinbutton', { name: /Quantity/i });
    await user.clear(quantity);
    await user.type(quantity, '1');

    expect(mocks.enabled).toBe(true);
    expect(mocks.input).toMatchObject({
      id: 'sale-1',
      destination: 'original',
      items: [{ saleItemId: 'line-1', quantity: 1 }],
    });
    await user.click(screen.getByRole('button', { name: 'Wrong item' }));
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));

    expect(onConfirm).toHaveBeenCalledWith({
      reason: 'wrong_item',
      destination: 'original',
      items: [{ saleItemId: 'line-1', quantity: 1 }],
    });
  });

  it('requires external evidence for the original tender but not for customer store credit', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const sale = saleFixture({
      customerId: 'customer-1',
      customerName: 'Ada',
      paymentMethod: 'card',
      payments: [
        {
          id: 'card-payment',
          method: 'card',
          amount: 100,
          returnedAmount: 0,
          remainingAmount: 100,
          createdAt: '2026-08-31T12:00:00.000Z',
        },
      ],
    });
    mocks.preview.data.allocations = [
      {
        salePaymentId: 'card-payment',
        originalMethod: 'card',
        destination: 'external',
        amount: 50,
      },
    ];
    mocks.preview.data.cashAmount = 0;
    mocks.preview.data.externalAmount = 50;
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        sale={sale}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Return Coffee' }));
    expect(mocks.enabled).toBe(true);
    expect(mocks.input).not.toHaveProperty('externalReferences');
    expect(screen.getByRole('button', { name: 'Confirm return' })).toBeDisabled();
    const reference = screen.getByRole('textbox', { name: /Card/i });
    expect(reference).toHaveAccessibleName(/Card · \$50\.00/);
    expect(reference).not.toHaveAccessibleName(/\$100\.00/);
    expect(screen.getByText(/External \$50\.00/)).toBeVisible();
    await user.type(reference, 'provider-ref-42');
    expect(mocks.enabled).toBe(true);
    expect(mocks.input).not.toHaveProperty('externalReferences');
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));
    expect(onConfirm).toHaveBeenLastCalledWith({
      destination: 'original',
      items: [{ saleItemId: 'line-1', quantity: 2 }],
      externalReferences: [{ salePaymentId: 'card-payment', reference: 'provider-ref-42' }],
    });

    await user.click(screen.getByRole('button', { name: /^Customer store credit/ }));
    expect(mocks.input).toMatchObject({ destination: 'store_credit' });
    expect(mocks.input).not.toHaveProperty('externalReferences');
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));
    expect(onConfirm).toHaveBeenCalledWith({
      destination: 'store_credit',
      items: [{ saleItemId: 'line-1', quantity: 2 }],
    });
  });

  it('collects provider evidence from a legacy external allocation with no payment row', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    mocks.preview.data.allocations = [
      { salePaymentId: null, originalMethod: 'card', destination: 'external', amount: 50 },
    ];
    mocks.preview.data.cashAmount = 0;
    mocks.preview.data.externalAmount = 50;
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        sale={saleFixture({ paymentMethod: 'card', payments: [] })}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Return Coffee' }));
    const reference = screen.getByRole('textbox', { name: /Card · \$50\.00/ });
    expect(screen.getByText(/External \$50\.00/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm return' })).toBeDisabled();
    await user.type(reference, 'legacy-provider-ref-42');
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));

    expect(onConfirm).toHaveBeenCalledWith({
      destination: 'original',
      items: [{ saleItemId: 'line-1', quantity: 2 }],
      externalReferences: [{ salePaymentId: null, reference: 'legacy-provider-ref-42' }],
    });
  });

  it('uses the frozen product label instead of a later catalog rename', async () => {
    const user = userEvent.setup();
    const originalLine = saleFixture().items![0]!;
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        sale={saleFixture({
          items: [
            {
              ...originalLine,
              productName: 'Renamed after sale',
              productNameSnapshot: 'Original coffee',
            },
          ],
        })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText('Original coffee')).toBeVisible();
    expect(screen.queryByText('Renamed after sale')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Return Original coffee' }));
    expect(mocks.enabled).toBe(true);
  });

  it('preserves exact lot and serial provenance in the submitted selection', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const sale = saleFixture({
      items: [
        {
          id: 'line-serial',
          saleId: 'sale-1',
          productId: 'product-serial',
          productName: 'Serial drill',
          quantity: 2,
          remainingQuantity: 2,
          returnedQuantity: 0,
          unitPrice: 50,
          unitEquivalence: 1,
          discount: 0,
          taxRate: 0,
          taxAmount: 0,
          total: 100,
          returnableAmount: 100,
          lots: [
            {
              id: 'sale-lot-a',
              saleItemId: 'line-serial',
              lotId: 'lot-a',
              lotNumber: 'LOT-A',
              expiresAt: null,
              status: 'active',
              quantity: 2,
              unitCost: 10,
              returnedQuantity: 0,
              remainingQuantity: 2,
            },
          ],
          serials: [
            {
              id: 'sale-serial-a',
              saleItemId: 'line-serial',
              productSerialId: 'serial-a',
              serialNumber: 'SN-A',
              currentStatus: 'sold',
              returned: false,
            },
            {
              id: 'sale-serial-b',
              saleItemId: 'line-serial',
              productSerialId: 'serial-b',
              serialNumber: 'SN-B',
              currentStatus: 'sold',
              returned: false,
            },
          ],
        },
      ],
    });
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        sale={sale}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Return Serial drill' }));
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));

    expect(onConfirm).toHaveBeenCalledWith({
      destination: 'original',
      items: [
        {
          saleItemId: 'line-serial',
          quantity: 2,
          lotAllocations: [{ saleItemLotId: 'sale-lot-a', quantity: 2 }],
          serialIds: ['serial-a', 'serial-b'],
        },
      ],
    });
  });
});
