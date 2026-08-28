import {
  act,
  fireEvent,
  render as renderWithoutProviders,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  NavLink,
  Route,
  Routes,
  UNSAFE_createMemoryHistory,
  unstable_HistoryRouter as HistoryRouter,
} from 'react-router';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createGuardedHistory } from '@/components/navigation/guardedHistory';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
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
  { id: 'vat-5', name: 'IVA 5%', rate: 5, kind: 'iva' },
  { id: 'vat-19', name: 'IVA 19%', rate: 19, kind: 'iva' },
  { id: 'inc-8', name: 'INC 8%', rate: 8, kind: 'inc' },
];

function ProductRouteTestShell({ onClose }: { onClose: () => void }) {
  const [, setMobileOpen] = useState(false);
  return (
    <>
      <NavLink to="/sales" onClick={() => setMobileOpen(false)}>
        Go to sales
      </NavLink>
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
        onClose={onClose}
        onSubmit={onSubmitMock}
        initialExperience="quick"
        origin="catalog"
      />
    </>
  );
}

function renderQuickModal(
  props: {
    origin?: 'catalog' | 'sale';
    advancedLookupsPending?: boolean;
    onClose?: () => void;
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
      onClose={props.onClose ?? vi.fn()}
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
  it('closes a clean form immediately and confirms before discarding a changed draft', async () => {
    const cleanClose = vi.fn();
    const clean = renderQuickModal({ onClose: cleanClose });
    await waitForQuickPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(cleanClose).toHaveBeenCalledOnce();
    clean.unmount();

    const dirtyClose = vi.fn();
    renderQuickModal({ onClose: dirtyClose });
    await waitForQuickPanel();
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Protected draft' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved product changes');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Discard product changes?' })).toBeInTheDocument();
    expect(dirtyClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Product name')).toHaveValue('Protected draft');
    await waitFor(() => expect(screen.getByLabelText('Product name')).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(dirtyClose).toHaveBeenCalledOnce();
  });

  it('guards backdrop dismissal and keeps the confirmation inside one dialog', async () => {
    const onClose = vi.fn();
    renderQuickModal({ onClose });
    await waitForQuickPanel();
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Backdrop-protected draft' },
    });

    const dialog = screen.getByRole('dialog', { name: 'Create Product' });
    const backdrop = dialog.firstElementChild;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Discard product changes?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Product name')).toHaveValue('Backdrop-protected draft');
  });

  it('returns to a clean close when the operator restores the original values', async () => {
    const onClose = vi.fn();
    renderQuickModal({ onClose });
    await waitForQuickPanel();
    const name = screen.getByLabelText('Product name');

    fireEvent.change(name, { target: { value: 'Temporary product' } });
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.change(name, { target: { value: '' } });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText('Discard product changes?')).not.toBeInTheDocument();
  });

  it('requests browser unload protection only while product changes are unsaved', async () => {
    renderQuickModal();
    await waitForQuickPanel();

    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Reload-protected draft' },
    });
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
  });

  it('continues an in-app route after the operator discards the product draft', async () => {
    const controller = createNavigationGuardController();
    const history = createGuardedHistory(
      UNSAFE_createMemoryHistory({ initialEntries: ['/products'], v5Compat: true }),
      controller
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onClose = vi.fn();

    renderWithoutProviders(
      <QueryClientProvider client={queryClient}>
        <NavigationGuardProvider controller={controller}>
          <HistoryRouter history={history}>
            <Routes>
              <Route path="/products" element={<ProductRouteTestShell onClose={onClose} />} />
              <Route path="/sales" element={<h1>Sales destination</h1>} />
            </Routes>
          </HistoryRouter>
        </NavigationGuardProvider>
      </QueryClientProvider>
    );

    await waitForQuickPanel();
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Route-protected product' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    const salesLink = document.querySelector<HTMLAnchorElement>('a[href="/sales"]');
    expect(salesLink).not.toBeNull();
    fireEvent.click(salesLink!);

    expect(history.location.pathname).toBe('/products');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    await waitFor(() => expect(history.location.pathname).toBe('/sales'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Sales destination' })).toBeInTheDocument();
  });

  it('submits the minimum sellable fields through the shared product form', async () => {
    renderQuickModal();
    await waitForQuickPanel();

    expect(screen.getByRole('region', { name: 'Essential information' })).toBeInTheDocument();
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
      target: { value: 'inc-8' },
    });
    expect(screen.getByTestId('product-quick-tax-kind')).toHaveTextContent('Tax type: INC');
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
        vatRateId: 'inc-8',
        taxRate: 8,
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

    expect(screen.getByText('Preparing advanced settings…')).toBeVisible();
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
