import { screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { Purchase } from '@/types';
import { PurchaseDetailsContent } from './PurchaseDetailsContent';

const purchase = {
  id: 'purchase-1',
  tenantId: 'tenant-1',
  purchaseNumber: 'COM-000001',
  providerId: 'provider-1',
  providerName: 'Proveedor',
  siteId: 'site-1',
  siteName: 'Principal',
  status: 'completed',
  subtotal: 20,
  total: 20,
  createdBy: 'user-1',
  createdAt: '2030-01-01T12:00:00.000Z',
  updatedAt: '2030-01-01T12:00:00.000Z',
  items: [
    {
      id: 'item-1',
      purchaseId: 'purchase-1',
      productId: 'product-1',
      productName: 'Producto lotificado',
      productSku: 'LOT-1',
      tracksLots: true,
      quantity: 2,
      unitId: 'unit-1',
      unitEquivalence: 1,
      unitName: 'Unidad',
      costPerUnit: 10,
      baseUnitCost: 10,
      total: 20,
      returnedQuantity: 0,
      remainingQuantity: 2,
      returnableQuantity: 0,
      lots: [
        {
          id: 'purchase-lot-1',
          purchaseItemId: 'item-1',
          inventoryLotId: 'lot-1',
          lotNumber: 'L-2031',
          expiresAt: '2031-01-31',
          baseQuantity: 2,
          unitCost: 10,
          currentOnHand: 0,
          currentStatus: 'quarantined',
          returnedBaseQuantity: 0,
          remainingBaseQuantity: 2,
          availableBaseQuantity: 0,
        },
      ],
    },
  ],
} as Purchase;

describe('PurchaseDetailsContent lot evidence', () => {
  beforeAll(async () => i18next.changeLanguage('es'));

  it('shows the calendar expiry and localized current lot status', () => {
    render(<PurchaseDetailsContent purchase={purchase} returnError={null} voidError={null} />);

    expect(screen.getByText(/vence .*2031/i)).toBeInTheDocument();
    expect(screen.getByText(/estado actual: en cuarentena/i)).toBeInTheDocument();
    expect(screen.queryByText(/quarantined/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Disponible para devolución' })
    ).toBeInTheDocument();
    const productRow = screen.getByRole('row', { name: /Producto lotificado/i });
    expect(within(productRow).getAllByRole('cell')[3]).toHaveTextContent('0');
    expect(screen.queryByRole('columnheader', { name: 'Restante' })).not.toBeInTheDocument();
  });
});
