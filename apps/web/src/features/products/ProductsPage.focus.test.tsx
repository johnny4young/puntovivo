/** Synthetic query/mutation fixtures with real DataTable, ConfirmModal and focus isolation.
 * Preserve the actual opener across renders; use a workflow fallback only for missing rows.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { Product } from '@/types';
import { createMockProduct } from '@/test/utils';

const {
  useAuthMock,
  useIsModuleActiveMock,
  useModulesSnapshotMock,
  productsListUseQueryMock,
  productDetailFetchMock,
  productDetailInvalidateMock,
  productsListInvalidateMock,
  updateMutationOptionsRef,
  productFormModalMock,
  deleteResultMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useIsModuleActiveMock: vi.fn(),
  useModulesSnapshotMock: vi.fn(),
  productsListUseQueryMock: vi.fn(),
  productDetailFetchMock: vi.fn(),
  productDetailInvalidateMock: vi.fn(),
  productsListInvalidateMock: vi.fn(),
  updateMutationOptionsRef: {
    current: null as null | {
      onSuccess?: (data: unknown, variables: { id: string }) => Promise<void>;
    },
  },
  productFormModalMock: vi.fn(),
  deleteResultMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: useAuthMock }));
vi.mock('@/features/modules', () => ({
  useIsModuleActive: useIsModuleActiveMock,
  useModulesSnapshot: useModulesSnapshotMock,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// Stub only the heavy form / confirm modals; DataTable + ProductDetailsDrawer
// stay REAL so the column set and the drawer round-trip are exercised.
vi.mock('@/features/products/ProductFormModal', () => ({
  ProductFormModal: (props: {
    isOpen: boolean;
    product: { name?: string; version?: number } | null;
  }) => {
    productFormModalMock(props);
    return props.isOpen ? (
      <div
        data-testid="product-form-modal"
        data-product-name={props.product?.name}
        data-product-version={props.product?.version}
      />
    ) : null;
  },
}));
vi.mock('@/components/tables/TableExportActions', () => ({ TableExportActions: () => null }));
vi.mock('@/components/feedback/EmptyStateReadinessNudge', () => ({
  EmptyStateReadinessNudge: () => null,
}));

const product = {
  id: 'p-1',
  name: 'Café Premium',
  sku: 'CAF-001',
  categoryName: 'Bebidas',
  providerName: 'Proveedor Norte',
  locationName: 'Bodega A',
  price: 12000,
  price2: 11000,
  price3: 10000,
  stock: 42,
  minStock: 10,
  catalogType: 'standard',
  isActive: true,
};

// tRPC's useUtils returns a stable object; a fresh one per render would
// recreate the memoized columns and hide the identity this suite pins.
const utils = {
  setupReadiness: { get: { invalidate: vi.fn() } },
  products: {
    list: { invalidate: productsListInvalidateMock },
    semanticSearch: { invalidate: vi.fn() },
    embeddingHealth: { invalidate: vi.fn() },
    getById: { invalidate: productDetailInvalidateMock, fetch: productDetailFetchMock },
    getVariantMatrix: { invalidate: vi.fn() },
  },
};

vi.mock('@/lib/trpc', async () => ({
  ...(await vi.importActual<typeof import('@/lib/trpc')>('@/lib/trpc')),
  trpc: {
    useUtils: () => utils,
    products: {
      list: {
        useQuery: (input: unknown, options: unknown) => productsListUseQueryMock(input, options),
      },
      semanticSearch: { useQuery: () => ({ data: null, isFetching: false }) },
      embeddingHealth: { useQuery: () => ({ data: null, isLoading: false }) },
      regenerateEmbeddings: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      getVariantMatrix: {
        useQuery: () => ({ data: null, isLoading: false, error: null }),
      },
      create: { useMutation: () => ({ mutateAsync: vi.fn(), reset: vi.fn() }) },
      update: {
        useMutation: (options: {
          onSuccess?: (data: unknown, variables: { id: string }) => Promise<void>;
        }) => {
          updateMutationOptionsRef.current = options;
          return { mutateAsync: vi.fn(), reset: vi.fn() };
        },
      },
      delete: {
        useMutation: (options: {
          onSuccess?: () => Promise<void>;
          onError?: (error: unknown) => void;
        }) => ({
          isPending: false,
          mutate: (variables: { id: string }) => {
            void Promise.resolve(deleteResultMock(variables)).then(
              () => options.onSuccess?.(),
              error => options.onError?.(error)
            );
          },
        }),
      },
      createVariantMatrix: {
        useMutation: () => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false }),
      },
    },
    // - the margin column query; null data keeps the column hidden.
    reports: {
      profit: { margin: { useQuery: () => ({ data: null, isLoading: false }) } },
    },
    categories: { tree: { useQuery: () => ({ data: { items: [] } }) } },
    providers: { list: { useQuery: () => ({ data: { items: [] } }) } },
    locations: { list: { useQuery: () => ({ data: { items: [] } }) } },
    units: { list: { useQuery: () => ({ data: { items: [] } }) } },
    vatRates: { list: { useQuery: () => ({ data: { items: [] } }) } },
  },
}));

import { ProductsPage } from './ProductsPage';

describe('ProductsPage retains the logical deactivation opener', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useIsModuleActiveMock.mockReset();
    useModulesSnapshotMock.mockReset();
    productsListUseQueryMock.mockReset();
    productDetailFetchMock.mockReset();
    productDetailInvalidateMock.mockReset();
    productsListInvalidateMock.mockReset();
    updateMutationOptionsRef.current = null;
    productFormModalMock.mockReset();
    deleteResultMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'admin' } });
    useIsModuleActiveMock.mockReturnValue(false); // semantic off → simplest table
    useModulesSnapshotMock.mockReturnValue({
      modules: { 'semantic-search': false },
      isLoading: false,
      isPlaceholder: false,
    });
    productsListUseQueryMock.mockReturnValue({
      data: { items: [product] },
      isLoading: false,
      error: null,
    });
  });

  function rowDelete(container: HTMLElement, id: string, language: 'en' | 'es') {
    const row = container.querySelector(`[data-row-id="${id}"]`);
    const button = row?.querySelector<HTMLButtonElement>(
      `button[aria-label="${language === 'en' ? 'Delete' : 'Eliminar'}"]`
    );
    if (!button) throw new Error('Expected the synthetic product action');
    return button;
  }

  it.each([
    ['en', 'keyboard'],
    ['en', 'mouse'],
    ['es', 'keyboard'],
    ['es', 'mouse'],
  ] as const)(
    'keeps the same %s opener through %s open, error, cancel and retry',
    async (language, method) => {
      await i18next.changeLanguage(language);
      const user = userEvent.setup();
      const { container, rerender } = render(<ProductsPage />);
      const opener = rowDelete(container, product.id, language);
      if (method === 'keyboard') {
        opener.focus();
        await user.keyboard('{Enter}');
      } else await user.click(opener);
      expect(opener.isConnected).toBe(true);
      expect(rowDelete(container, product.id, language)).toBe(opener);
      deleteResultMock.mockRejectedValueOnce(new Error('Synthetic deactivation failure'));
      const confirm = () =>
        screen.getByRole('button', {
          name: language === 'en' ? 'Deactivate' : 'Desactivar',
        });
      await user.click(confirm());
      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
      rerender(<ProductsPage />);
      expect(rowDelete(container, product.id, language)).toBe(opener);
      const cancel = screen.getByRole('button', {
        name: language === 'en' ? 'Cancel' : 'Cancelar',
      });
      if (method === 'keyboard') {
        cancel.focus();
        await user.keyboard('{Enter}');
      } else await user.click(cancel);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
      expect(opener.isConnected).toBe(true);
      await user.click(opener);
      deleteResultMock.mockResolvedValueOnce({ success: true, id: product.id });
      await user.click(confirm());
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(deleteResultMock).toHaveBeenLastCalledWith({ id: product.id });
      expect(toastSuccessMock).toHaveBeenCalledTimes(1);
      expect(opener).toHaveFocus();
    }
  );

  it('preserves the opener through a pending debounced server search with real query state', async () => {
    await i18next.changeLanguage('en');
    const queryProduct = createMockProduct({
      id: product.id,
      name: product.name,
      sku: product.sku,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    let releaseSearch!: (value: { items: Product[] }) => void;
    const response = new Promise<{ items: Product[] }>(resolve => {
      releaseSearch = resolve;
    });
    function usePendingList(
      input: { search?: string },
      options: {
        placeholderData?: (
          previous: { items: Product[] } | undefined
        ) => { items: Product[] } | undefined;
      }
    ) {
      return useQuery({
        queryKey: ['synthetic-products', input.search],
        queryFn: () => {
          if (input.search) {
            return response;
          }
          return Promise.resolve({ items: [queryProduct] });
        },
        ...options,
      });
    }
    productsListUseQueryMock.mockImplementation(usePendingList);
    const user = userEvent.setup();
    const { container, unmount } = render(
      <QueryClientProvider client={client}>
        <ProductsPage />
      </QueryClientProvider>
    );
    try {
      await waitFor(() =>
        expect(container.querySelector(`[data-row-id="${product.id}"]`)).not.toBeNull()
      );
      const opener = rowDelete(container, product.id, 'en');
      fireEvent.change(screen.getByTestId('data-table-search'), {
        target: { value: 'pending product' },
      });
      await user.click(opener);
      await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
      expect(opener.isConnected).toBe(true);
      expect(rowDelete(container, product.id, 'en')).toBe(opener);
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      await act(async () => {
        releaseSearch({ items: [{ ...queryProduct, name: 'Refreshed pending product' }] });
      });
      await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
      expect(rowDelete(container, product.id, 'en')).toBe(opener);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(opener).toHaveFocus();
    } finally {
      releaseSearch({ items: [] });
      unmount();
      client.clear();
    }
  });

  it('keeps the same product action when refreshed rows change order', async () => {
    await i18next.changeLanguage('en');
    const other = { ...product, id: 'p-2', name: 'Tea', sku: 'TEA-002' };
    productsListUseQueryMock.mockReturnValue({
      data: { items: [product, other] },
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    const { container, rerender } = render(<ProductsPage />);
    const opener = rowDelete(container, product.id, 'en');
    await user.click(opener);
    productsListUseQueryMock.mockReturnValue({
      data: { items: [other, { ...product, name: 'Refreshed coffee' }] },
      isLoading: false,
      error: null,
    });
    rerender(<ProductsPage />);
    expect(rowDelete(container, product.id, 'en')).toBe(opener);
    expect(opener.closest('tr')).toHaveAttribute('data-row-id', product.id);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(opener).toHaveFocus();
    expect(rowDelete(container, other.id, 'en')).not.toHaveFocus();
  });

  it.each(['en', 'es'] as const)(
    'falls back to the %s product search only when the row is removed',
    async language => {
      await i18next.changeLanguage(language);
      const user = userEvent.setup();
      const { container, rerender } = render(<ProductsPage />);
      const opener = rowDelete(container, product.id, language);
      await user.click(opener);
      productsListUseQueryMock.mockReturnValue({
        data: { items: [] },
        isLoading: false,
        error: null,
      });
      rerender(<ProductsPage />);
      expect(opener.isConnected).toBe(false);
      await user.click(
        screen.getByRole('button', { name: language === 'en' ? 'Cancel' : 'Cancelar' })
      );
      expect(screen.getByTestId('data-table-search')).toHaveFocus();
    }
  );

  it('uses the page heading when a query error has also removed the search control', async () => {
    await i18next.changeLanguage('en');
    const user = userEvent.setup();
    const { container, rerender } = render(<ProductsPage />);
    const opener = rowDelete(container, product.id, 'en');
    await user.click(opener);
    productsListUseQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Synthetic list refresh failure'),
    });
    rerender(<ProductsPage />);
    expect(opener.isConnected).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Products', level: 1 })).toHaveFocus();
  });
});
