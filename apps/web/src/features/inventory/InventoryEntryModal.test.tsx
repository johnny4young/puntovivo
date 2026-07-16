import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockProduct, render } from '@/test/utils';
import type { ProductSearchSelection } from '@/types';
import { InventoryEntryModal } from './InventoryEntryModal';
import { parseSerialNumbers } from './serialNumbers';

function trackedSelection(): ProductSearchSelection {
  return {
    product: createMockProduct({ tracksLots: true, stock: 0 }),
    unit: {
      id: 'unit-product-1',
      unitId: 'unit-1',
      unitName: 'Unit',
      unitAbbreviation: 'EA',
      equivalence: 1,
      price: 10,
      isBase: true,
    },
    price: 10,
  };
}

function serializedSelection(): ProductSearchSelection {
  return {
    ...trackedSelection(),
    product: createMockProduct({ tracksLots: false, tracksSerials: true, stock: 0 }),
  };
}

describe('InventoryEntryModal (ENG-110a)', () => {
  it('collects lot evidence instead of showing the aggregate count mode', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <InventoryEntryModal
        isOpen
        selection={trackedSelection()}
        siteId="site-1"
        siteName="Main site"
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByRole('heading', { name: 'Receive Inventory Lot' })).toBeVisible();
    expect(screen.queryByLabelText('Mode')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Lot number'), { target: { value: 'LOT-2026-01' } });
    fireEvent.change(screen.getByLabelText('Expiry date (optional)'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.change(screen.getByLabelText('Received quantity'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Cost per base unit'), { target: { value: '4.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          lotNumber: 'LOT-2026-01',
          expiresAt: '2026-12-31',
          quantity: 6,
          cost: 4.5,
        }),
        expect.anything()
      )
    );
  });

  it('normalizes serialized identities and derives quantity from unique physical units', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <InventoryEntryModal
        isOpen
        selection={serializedSelection()}
        siteId="site-1"
        siteName="Main site"
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByRole('heading', { name: 'Receive Serialized Units' })).toBeVisible();
    expect(screen.queryByLabelText('Lot number')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Serial numbers'), {
      target: { value: ' sn-a \nＳＮ－Ｂ\nSN-A' },
    });

    expect(parseSerialNumbers(' sn-a \nＳＮ－Ｂ\nSN-A')).toEqual(['SN-A', 'SN-B']);
    expect(screen.getByText('2 unique serials')).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Serialized units')).toHaveValue(2));
    expect(screen.getByLabelText('Serialized units')).toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }));
    expect(await screen.findByText('Remove duplicate serial numbers before saving')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Serial numbers'), {
      target: { value: ' sn-a \nＳＮ－Ｂ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          serialNumbers: ' sn-a \nＳＮ－Ｂ',
          quantity: 2,
        }),
        expect.anything()
      )
    );
  });

  it('converts serialized units through the selected unit equivalence', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const selection = serializedSelection();
    render(
      <InventoryEntryModal
        isOpen
        selection={{
          ...selection,
          unit: { ...selection.unit, equivalence: 2 },
        }}
        siteId="site-1"
        siteName="Main site"
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Serial numbers'), {
      target: { value: 'SN-A\nSN-B' },
    });
    await waitFor(() => expect(screen.getByLabelText('Serialized units')).toHaveValue(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 1 }),
        expect.anything()
      )
    );
  });
});
