import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { Purchase } from '@/types';
import { PurchaseReturnModal } from './PurchaseReturnModal';

const purchase = {
  id: 'purchase-1',
  tenantId: 'tenant-1',
  purchaseNumber: 'COM-000001',
  providerId: 'provider-1',
  siteId: 'site-1',
  status: 'completed',
  subtotal: 100,
  total: 100,
  createdBy: 'user-1',
  createdAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T00:00:00Z',
  items: [
    {
      id: 'purchase-item-1',
      purchaseId: 'purchase-1',
      productId: 'product-1',
      productName: 'Serialized terminal',
      productSku: 'TERM-1',
      tracksSerials: true,
      quantity: 1,
      remainingQuantity: 1,
      unitId: 'unit-1',
      unitEquivalence: 1,
      unitName: 'Unit',
      costPerUnit: 100,
      baseUnitCost: 100,
      total: 100,
      serials: [
        {
          id: 'serial-1',
          serialNumber: 'TERM-001',
          status: 'in_stock',
          currentSiteId: 'site-1',
        },
      ],
    },
  ],
} as Purchase;

describe('PurchaseReturnModal serialized return', () => {
  beforeAll(async () => i18next.changeLanguage('en'));

  it('submits the exact selected physical identity', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PurchaseReturnModal
        isOpen
        purchase={purchase}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'TERM-001' }));
    expect(screen.getByLabelText('Return Quantity')).toHaveValue(1);
    expect(screen.getByLabelText('Return Quantity')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Record Return' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        items: [{ purchaseItemId: 'purchase-item-1', quantity: 1, serialIds: ['serial-1'] }],
        reason: '',
      })
    );
  });

  it('converts selected physical identities to the purchased unit quantity', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const casePurchase = {
      ...purchase,
      items: purchase.items?.map(item => ({
        ...item,
        unitEquivalence: 2,
        serials: [
          ...(item.serials ?? []),
          {
            id: 'serial-2',
            serialNumber: 'TERM-002',
            status: 'in_stock' as const,
            currentSiteId: 'site-1',
          },
        ],
      })),
    } as Purchase;
    render(
      <PurchaseReturnModal
        isOpen
        purchase={casePurchase}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'TERM-001' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'TERM-002' }));
    expect(screen.getByLabelText('Return Quantity')).toHaveValue(1);
    fireEvent.click(screen.getByRole('button', { name: 'Record Return' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({ quantity: 1 })],
        })
      )
    );
  });
});
