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
      returnableQuantity: 1,
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

  it('returns the exact received lot provenance without aggregating identities', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const lotPurchase = {
      ...purchase,
      items: [
        {
          ...purchase.items![0]!,
          id: 'purchase-item-lot',
          productName: 'Lot medicine',
          tracksSerials: false,
          tracksLots: true,
          quantity: 3,
          remainingQuantity: 3,
          returnableQuantity: 2.5,
          unitEquivalence: 2,
          serials: [],
          lots: [
            {
              id: 'purchase-item-lot-link',
              purchaseItemId: 'purchase-item-lot',
              inventoryLotId: 'lot-1',
              lotNumber: 'MED-LOT-1',
              expiresAt: '2027-01-31',
              baseQuantity: 6,
              unitCost: 50,
              currentOnHand: 5,
              currentStatus: 'active',
              returnedBaseQuantity: 1,
              remainingBaseQuantity: 5,
              availableBaseQuantity: 5,
            },
          ],
        },
      ],
    } as Purchase;
    render(
      <PurchaseReturnModal
        isOpen
        purchase={lotPurchase}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Quantity from lot MED-LOT-1'), {
      target: { value: '2' },
    });
    expect(screen.getByLabelText('Return Quantity')).toHaveValue(1);
    fireEvent.click(screen.getByRole('button', { name: 'Record Return' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        items: [
          {
            purchaseItemId: 'purchase-item-lot',
            quantity: 1,
            lotAllocations: [{ purchaseItemLotId: 'purchase-item-lot-link', baseQuantity: 2 }],
          },
        ],
        reason: '',
      })
    );
  });

  it('shows physical returnability and disables an exhausted purchase lot', () => {
    const exhaustedPurchase = {
      ...purchase,
      items: [
        {
          ...purchase.items![0]!,
          id: 'purchase-item-exhausted-lot',
          productName: 'Consumed lot medicine',
          tracksSerials: false,
          tracksLots: true,
          quantity: 3,
          remainingQuantity: 3,
          returnableQuantity: 0,
          unitEquivalence: 1,
          serials: [],
          lots: [
            {
              id: 'purchase-item-exhausted-link',
              purchaseItemId: 'purchase-item-exhausted-lot',
              inventoryLotId: 'lot-exhausted',
              lotNumber: 'MED-LOT-EMPTY',
              expiresAt: '2027-01-31',
              baseQuantity: 3,
              unitCost: 50,
              currentOnHand: 0,
              currentStatus: 'depleted',
              returnedBaseQuantity: 0,
              remainingBaseQuantity: 3,
              availableBaseQuantity: 0,
            },
          ],
        },
      ],
    } as Purchase;

    render(
      <PurchaseReturnModal
        isOpen
        purchase={exhaustedPurchase}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText('Available to return').parentElement).toHaveTextContent('0');
    expect(screen.getByLabelText('Quantity from lot MED-LOT-EMPTY')).toBeDisabled();
    expect(screen.getByLabelText('Return Quantity')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record Return' })).toBeDisabled();
  });
});
