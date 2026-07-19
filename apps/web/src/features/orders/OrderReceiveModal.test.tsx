import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { Order } from '@/types';
import { OrderReceiveModal } from './OrderReceiveModal';

const order = {
  id: 'order-1',
  tenantId: 'tenant-1',
  orderNumber: 'OC-000001',
  providerId: 'provider-1',
  siteId: 'site-1',
  status: 'submitted',
  subtotal: 200,
  total: 200,
  createdBy: 'user-1',
  createdAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T00:00:00Z',
  items: [
    {
      id: 'order-item-1',
      orderId: 'order-1',
      productId: 'product-1',
      productName: 'Serialized scanner',
      productSku: 'SCN-1',
      tracksSerials: true,
      quantity: 2,
      remainingQuantity: 2,
      unitId: 'unit-1',
      unitEquivalence: 1,
      unitName: 'Unit',
      costPerUnit: 100,
      baseUnitCost: 100,
      total: 200,
    },
  ],
} as Order;

describe('OrderReceiveModal serialized receipt', () => {
  beforeAll(async () => i18next.changeLanguage('en'));

  it('collects serial numbers and derives the order receipt quantity', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <OrderReceiveModal
        isOpen
        order={order}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Received serial numbers'), {
      target: { value: 'SCN-001\nSCN-002' },
    });
    expect(screen.getByLabelText('Receive Quantity')).toHaveValue(2);
    expect(screen.getByLabelText('Receive Quantity')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Create Receipt' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        items: [
          {
            orderItemId: 'order-item-1',
            quantity: 2,
            serialNumbers: ['SCN-001', 'SCN-002'],
          },
        ],
        notes: '',
      })
    );
  });

  it('converts physical serial count to the ordered unit quantity', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const caseOrder = {
      ...order,
      items: order.items?.map(item => ({
        ...item,
        quantity: 1,
        remainingQuantity: 1,
        unitEquivalence: 2,
      })),
    } as Order;
    render(
      <OrderReceiveModal
        isOpen
        order={caseOrder}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Received serial numbers'), {
      target: { value: 'SCN-001\nSCN-002' },
    });
    expect(screen.getByLabelText('Receive Quantity')).toHaveValue(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create Receipt' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({ quantity: 1 })],
        })
      )
    );
  });
});
