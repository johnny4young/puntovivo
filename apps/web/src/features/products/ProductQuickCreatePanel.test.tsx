import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
import type { ProductFormValues } from './productForm.types';

const { onSubmitMock, useAuthMock, useIsModuleActiveMock } = vi.hoisted(() => ({
  onSubmitMock: vi.fn<(values: ProductFormValues) => Promise<void>>(),
  useAuthMock: vi.fn(),
  useIsModuleActiveMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/features/modules', () => ({
  useIsModuleActive: useIsModuleActiveMock,
}));

vi.mock('./AISuggestionsPanel', () => ({
  AISuggestionsPanel: () => null,
}));

import { ProductFormModal, type VatRateOption } from './ProductFormModal';

const VAT_RATES: VatRateOption[] = [
  { id: 'vat-5', name: 'IVA 5%', rate: 5 },
  { id: 'vat-19', name: 'IVA 19%', rate: 19 },
];

function renderQuickModal(
  props: {
    origin?: 'catalog' | 'sale';
    advancedLookupsPending?: boolean;
  } = {}
) {
  return render(
    <ProductFormModal
      mode="create"
      isOpen
      product={null}
      categories={[]}
      locations={[]}
      providers={[]}
      units={[]}
      vatRates={VAT_RATES}
      isSaving={false}
      error={null}
      onClose={vi.fn()}
      onSubmit={onSubmitMock}
      initialExperience="quick"
      origin={props.origin ?? 'catalog'}
      advancedLookupsPending={props.advancedLookupsPending ?? false}
    />
  );
}

async function waitForQuickPanel() {
  await screen.findByTestId('product-quick-create');
}

beforeEach(() => {
  onSubmitMock.mockReset();
  onSubmitMock.mockResolvedValue(undefined);
  useAuthMock.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
  useIsModuleActiveMock.mockReturnValue(false);
});

afterEach(async () => {
  await act(async () => {
    await Promise.resolve();
  });
});

describe('ProductFormModal quick experience', () => {
  it('submits the minimum sellable fields through the shared product form', async () => {
    renderQuickModal();
    await waitForQuickPanel();

    expect(
      screen.getByRole('region', { name: 'Essential information' })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Whole grain bread' },
    });
    fireEvent.change(screen.getByLabelText('Product code'), {
      target: { value: '7701234567890' },
    });
    fireEvent.change(screen.getByLabelText('Selling price'), {
      target: { value: '8900' },
    });
    fireEvent.change(screen.getByLabelText('Tax'), {
      target: { value: 'vat-19' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add opening stock' }));
    fireEvent.change(screen.getByLabelText('Available units'), {
      target: { value: '12' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));
    });

    await waitFor(() => expect(onSubmitMock).toHaveBeenCalledOnce());
    expect(onSubmitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Whole grain bread',
        sku: '7701234567890',
        barcode: '7701234567890',
        price: 8900,
        vatRateId: 'vat-19',
        taxRate: 19,
        stock: 12,
        unitAssignments: [],
      })
    );
  });

  it('generates one internal code for both SKU and exact barcode lookup', async () => {
    renderQuickModal({ origin: 'sale' });
    await waitForQuickPanel();

    expect(screen.getByText(/It will join the current ticket when you finish/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Café de origen' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate code' }));

    const code = (screen.getByLabelText('Product code') as HTMLInputElement).value;
    expect(code).toMatch(/^PV-CAFE-DE-ORIGEN-[A-Z0-9]{6}$/);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));
    });

    await waitFor(() => expect(onSubmitMock).toHaveBeenCalledOnce());
    expect(onSubmitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: code,
        barcode: code,
      })
    );
  });

  it('preserves quick values when advanced settings are disclosed', async () => {
    renderQuickModal();
    await waitForQuickPanel();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Product name'), {
        target: { value: 'Preserved name' },
      });
      fireEvent.change(screen.getByLabelText('Product code'), {
        target: { value: 'PRESERVED-001' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));
      await Promise.resolve();
    });

    expect(screen.getByRole('tab', { name: 'General' })).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('Preserved name');
    expect(screen.getByLabelText('SKU')).toHaveValue('PRESERVED-001');
  });

  it('keeps the form mounted while lazy advanced catalogs load', async () => {
    renderQuickModal({ advancedLookupsPending: true });
    await waitForQuickPanel();

    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Still mounted' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));

    expect(screen.getByRole('status')).toHaveTextContent('Preparing advanced settings');
    expect(screen.queryByRole('tab', { name: 'General' })).not.toBeInTheDocument();
  });

  it('shows direct validation instead of opening the advanced form for missing identity', async () => {
    renderQuickModal();
    await waitForQuickPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));
    });

    expect(await screen.findByText('Enter a product name')).toBeVisible();
    expect(screen.getByText('Scan, type or generate a product code')).toBeVisible();
    expect(onSubmitMock).not.toHaveBeenCalled();
  });
});
