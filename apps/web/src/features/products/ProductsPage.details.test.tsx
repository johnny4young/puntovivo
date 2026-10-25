/**
 * ProductsPage column-trim + row-detail integration.
 *
 * Renders the page with the REAL DataTable + ProductDetailsDrawer (only
 * the heavy form / confirm modals are stubbed) to prove:
 * - the default table renders the smallest useful column set — provider,
 * location, tier-2 and tier-3 headers are gone;
 * - the Details (eye) action opens the row-detail Drawer, which surfaces
 * exactly those trimmed fields.
 *
 * @module features/products/ProductsPage.details.test
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { StrictMode, useEffect } from 'react';
import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';

const {
  useAuthMock,
  useIsModuleActiveMock,
  useModulesSnapshotMock,
  productsListUseQueryMock,
  semanticSearchUseQueryMock,
  productsListOptionsRef,
  productDetailFetchMock,
  productDetailInvalidateMock,
  productsListInvalidateMock,
  updateMutationOptionsRef,
  deleteMutationOptionsRef,
  productFormModalMock,
  deleteResultMock,
  toastErrorMock,
  toastSuccessMock,
  confirmPropsRef,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useIsModuleActiveMock: vi.fn(),
  useModulesSnapshotMock: vi.fn(),
  productsListUseQueryMock: vi.fn(),
  semanticSearchUseQueryMock: vi.fn(),
  productsListOptionsRef: { current: null as null | { placeholderData?: typeof keepPreviousData } },
  productDetailFetchMock: vi.fn(),
  productDetailInvalidateMock: vi.fn(),
  productsListInvalidateMock: vi.fn(),
  updateMutationOptionsRef: {
    current: null as null | {
      onSuccess?: (data: unknown, variables: { id: string }) => Promise<void>;
    },
  },
  deleteMutationOptionsRef: {
    current: null as null | {
      onSuccess?: (data: unknown, variables: { id: string }) => Promise<void>;
    },
  },
  productFormModalMock: vi.fn(),
  deleteResultMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  confirmPropsRef: {
    current: null as null | {
      isOpen: boolean;
      title?: string;
      confirmText?: string;
      onConfirm: () => void;
      onClose: () => void;
    },
  },
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
    onClose: () => void;
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
vi.mock('@/components/form-controls/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  ConfirmModal: (props: NonNullable<typeof confirmPropsRef.current>) => {
    confirmPropsRef.current = props;
    return props.isOpen ? (
      <div role="dialog" aria-label={props.title} data-testid="product-delete-confirmation">
        {props.confirmText}
      </div>
    ) : null;
  },
}));
vi.mock('@/components/tables/TableExportActions', () => ({ TableExportActions: () => null }));

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

vi.mock('@/lib/trpc', async () => ({
  ...(await vi.importActual<typeof import('@/lib/trpc')>('@/lib/trpc')),
  trpc: {
    useUtils: () => ({
      setupReadiness: { get: { invalidate: vi.fn() } },
      products: {
        list: { invalidate: productsListInvalidateMock },
        semanticSearch: { invalidate: vi.fn() },
        embeddingHealth: { invalidate: vi.fn() },
        getById: { invalidate: productDetailInvalidateMock, fetch: productDetailFetchMock },
        getVariantMatrix: { invalidate: vi.fn() },
      },
    }),
    products: {
      list: {
        useQuery: (input: unknown, options?: { placeholderData?: typeof keepPreviousData }) => {
          productsListOptionsRef.current = options ?? null;
          return productsListUseQueryMock(input);
        },
      },
      semanticSearch: { useQuery: semanticSearchUseQueryMock },
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
          onSuccess?: (data: unknown, variables: { id: string }) => Promise<void>;
          onError?: (error: unknown) => void;
        }) => {
          deleteMutationOptionsRef.current = options;
          return {
            isPending: false,
            // Mirrors TanStack's mutate: failures reach onError, never the caller.
            mutate: (variables: { id: string }) => {
              void Promise.resolve(deleteResultMock(variables)).then(
                () => options.onSuccess?.(undefined, variables),
                error => options.onError?.(error)
              );
            },
          };
        },
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

describe('ProductsPage default column set', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useIsModuleActiveMock.mockReset();
    useModulesSnapshotMock.mockReset();
    productsListUseQueryMock.mockReset();
    semanticSearchUseQueryMock.mockReset();
    semanticSearchUseQueryMock.mockReturnValue({ data: null, isFetching: false });
    productsListOptionsRef.current = null;
    productDetailFetchMock.mockReset();
    productDetailInvalidateMock.mockReset();
    productsListInvalidateMock.mockReset();
    updateMutationOptionsRef.current = null;
    deleteMutationOptionsRef.current = null;
    productFormModalMock.mockReset();
    deleteResultMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    confirmPropsRef.current = null;
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'manager' } });
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

  it('keeps the editing form uninitialized during read-only listing and details', () => {
    render(<ProductsPage />);
    expect(screen.getByText('CAF-001')).toBeInTheDocument();
    expect(productFormModalMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /view details|ver detalle/i }));
    expect(screen.getByTestId('product-details-drawer')).toBeInTheDocument();
    expect(screen.getByText('Proveedor Norte')).toBeInTheDocument();
    expect(productFormModalMock).not.toHaveBeenCalled();
  });

  it('mounts a fresh editor on each open and unmounts it on close', () => {
    render(<ProductsPage />);
    const openCreate = () =>
      fireEvent.click(screen.getByRole('button', { name: i18next.t('products:page.add') }));

    openCreate();
    expect(screen.getByTestId('product-form-modal')).toBeInTheDocument();
    const firstOpen = productFormModalMock.mock.calls.at(-1)?.[0];
    expect(firstOpen).toMatchObject({ isOpen: true, product: null });

    act(() => firstOpen.onClose());
    expect(screen.queryByTestId('product-form-modal')).not.toBeInTheDocument();

    openCreate();
    expect(screen.getByTestId('product-form-modal')).toBeInTheDocument();
  });

  function cataloguePage(total: number, page: number) {
    const items = Array.from({ length: total }, (_, index) => ({
      ...product,
      id: `catalogue-${index}`,
      name: `A B Catalogue ${index}`,
      sku: `CAT-${String(index).padStart(3, '0')}`,
    }));
    return {
      items: items.slice((page - 1) * 50, page * 50),
      page,
      perPage: 50,
      totalItems: total,
      totalPages: Math.ceil(total / 50),
    };
  }

  it('shows the result count when everything fits on one server page', () => {
    productsListUseQueryMock.mockReturnValue({
      data: cataloguePage(25, 1),
      isSuccess: true,
      isLoading: false,
      error: null,
    });
    render(<ProductsPage />);
    expect(screen.getByText('Showing 1-25 of 25')).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('reconciles a shrinking page and query changes finitely under StrictMode', async () => {
    let total = 65;
    productsListUseQueryMock.mockImplementation(({ page }: { page: number }) => ({
      data: cataloguePage(total, page),
      isSuccess: true,
      isLoading: false,
      error: null,
    }));
    const view = render(
      <StrictMode>
        <ProductsPage />
      </StrictMode>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    total = 0;
    view.rerender(
      <StrictMode>
        <ProductsPage />
      </StrictMode>
    );
    expect(productsListUseQueryMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
    expect(screen.getByText('No results.')).toBeVisible();
  });

  it.each([
    [61, 11],
    [65, 15],
    [80, 30],
  ])(
    'exposes all %i products through the final block of %i, without a hidden client subpage',
    async (total, remaining) => {
      productsListUseQueryMock.mockImplementation(({ page }: { page: number }) => ({
        data: cataloguePage(total, page),
        isSuccess: true,
        isLoading: false,
        error: null,
      }));
      render(<ProductsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      const body = within(screen.getByRole('table')).getAllByRole('rowgroup')[1]!;
      expect(within(body).getAllByRole('row')).toHaveLength(remaining);
      expect(screen.getByText(`CAT-${String(total - 1).padStart(3, '0')}`)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Go to next page' })).not.toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent(
        `Showing 51-${total} of ${total}`
      );
    }
  );

  it('does not clamp a requested page using placeholder metadata from another search', async () => {
    let placeholder = true;
    productsListUseQueryMock.mockImplementation(({ page }: { page: number }) => ({
      data: cataloguePage(page === 2 && placeholder ? 40 : 65, page),
      isSuccess: true,
      isPlaceholderData: page === 2 && placeholder,
      isLoading: false,
      error: null,
    }));
    const view = render(<ProductsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 })
      )
    );
    placeholder = false;
    view.rerender(<ProductsPage />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent(
      'Showing 51-65 of 65'
    );
    expect(screen.getByText('CAT-064')).toBeVisible();
  });

  it('keeps a late A-page response out of a pending B search with the real QueryClient', async () => {
    type Input = { page: number; search?: string };
    type Data = ReturnType<typeof cataloguePage>;
    function deferredPage() {
      let resolve: (data: Data) => void;
      const promise = new Promise<Data>(r => {
        resolve = r;
      });
      return { promise, resolve: (data: Data) => resolve(data) };
    }
    const oldA = deferredPage(),
      currentB = deferredPage();
    let latest: { page: number; search: string | undefined; placeholder: boolean } | undefined;
    function useListQuery(input: Input) {
      const result = useQuery({
        queryKey: ['pagination-race', input],
        queryFn: () =>
          input.search === 'A' && input.page === 2
            ? oldA.promise
            : input.search === 'B'
              ? currentB.promise
              : Promise.resolve(cataloguePage(65, input.page)),
        retry: false,
        staleTime: 300_000,
        ...(productsListOptionsRef.current ?? {}),
      });
      useEffect(() => {
        latest = { page: input.page, search: input.search, placeholder: result.isPlaceholderData };
      }, [input.page, input.search, result.isPlaceholderData]);
      return result;
    }
    productsListUseQueryMock.mockImplementation(useListQuery);
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <ProductsPage />
      </QueryClientProvider>
    );
    try {
      await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled());
      const search = screen.getByPlaceholderText('Search products...');
      fireEvent.change(search, { target: { value: 'A' } });
      await waitFor(() =>
        expect(latest).toMatchObject({ search: 'A', page: 1, placeholder: false })
      );
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() =>
        expect(latest).toMatchObject({ search: 'A', page: 2, placeholder: true })
      );
      // The footer follows the requested page while its rows load.
      expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent(
        'Showing 51-65 of 65'
      );
      fireEvent.change(search, { target: { value: 'B' } });
      await waitFor(() =>
        expect(latest).toMatchObject({ search: 'B', page: 1, placeholder: true })
      );
      await act(async () => {
        oldA.resolve(cataloguePage(0, 2));
        await Promise.resolve();
      });
      expect(latest).toMatchObject({ search: 'B', page: 1, placeholder: true });
      await act(async () => {
        currentB.resolve(cataloguePage(65, 1));
      });
      await waitFor(() =>
        expect(latest).toMatchObject({ search: 'B', page: 1, placeholder: false })
      );
      expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent(
        'Showing 1-50 of 65'
      );
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it.each(['success', 'error'] as const)(
    'keeps a cached out-of-range page selected while its refetch finishes with %s',
    async outcome => {
      type Input = {
        page: number;
        perPage: number;
        search?: string | undefined;
        includeVariantParents: boolean;
      };
      type Data = ReturnType<typeof cataloguePage>;
      const input = (page: number): Input => ({
        page,
        perPage: 50,
        search: undefined,
        includeVariantParents: true,
      });
      const key = (value: Input) => ['cached-pagination', value];
      let resolve!: (data: Data) => void;
      let reject!: (error: Error) => void;
      const response = new Promise<Data>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const options = (value: Input) => ({
        queryKey: key(value),
        queryFn: () =>
          value.page === 2 ? response : Promise.resolve(cataloguePage(65, value.page)),
        retry: false,
        staleTime: 300_000,
      });
      function useListQuery(value: Input) {
        return useQuery({ ...options(value), ...(productsListOptionsRef.current ?? {}) });
      }
      productsListUseQueryMock.mockImplementation(useListQuery);
      const client = new QueryClient();
      // A contracted page remains cached after the user returns to page one.
      client.setQueryData(key(input(2)), cataloguePage(40, 2));
      const view = render(
        <QueryClientProvider client={client}>
          <ProductsPage />
        </QueryClientProvider>
      );
      let request: Promise<Data> | undefined;
      try {
        // The expanded total has reached page one, but page two still holds the old total.
        await waitFor(() =>
          expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent(
            'Showing 1-50 of 65'
          )
        );
        request = client.fetchQuery({ ...options(input(2)), staleTime: 0 });
        void request.catch(() => undefined);
        expect(client.getQueryState(key(input(2)))).toMatchObject({
          fetchStatus: 'fetching',
          data: { totalItems: 40 },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        const index = productsListUseQueryMock.mock.calls.findIndex(([value]) => value.page === 2);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(productsListUseQueryMock.mock.results[index]?.value).toMatchObject({
          isFetching: true,
          isPlaceholderData: false,
          isSuccess: true,
          data: { page: 2, totalPages: 1 },
        });
        expect
          .soft(productsListUseQueryMock)
          .toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
        await act(async () => {
          if (outcome === 'success') resolve(cataloguePage(65, 2));
          else reject(new Error('Synthetic page refetch failure'));
          await request?.catch(() => undefined);
        });
        await waitFor(() =>
          expect(client.getQueryState(key(input(2)))).toMatchObject({
            fetchStatus: 'idle',
            status: outcome === 'success' ? 'success' : 'error',
          })
        );
        expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ page: 2 })
        );
        if (outcome === 'success') {
          await waitFor(() => expect(screen.getByText('CAT-064')).toBeVisible());
          expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent(
            'Showing 51-65 of 65'
          );
        } else {
          expect(client.getQueryData(key(input(2)))).toMatchObject({
            totalItems: 40,
            totalPages: 1,
          });
          expect(productsListUseQueryMock.mock.results.at(-1)?.value).toMatchObject({
            isError: true,
            isFetching: false,
            isPlaceholderData: false,
          });
        }
      } finally {
        resolve(cataloguePage(65, 2));
        await request?.catch(() => undefined);
        view.unmount();
        client.clear();
      }
    }
  );

  it.each([50, 40, 0])(
    'recovers page one after a matching-edit refresh reduces total to %i',
    async total => {
      let matchingTotal = 65;
      productsListUseQueryMock.mockImplementation(({ page }: { page: number }) => ({
        data: cataloguePage(matchingTotal, page),
        isSuccess: true,
        isLoading: false,
        error: null,
      }));
      const view = render(<ProductsPage />);
      fireEvent.change(screen.getByPlaceholderText('Search products...'), {
        target: { value: 'A' },
      });
      await waitFor(() =>
        expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'A' })
        )
      );
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      // Model the query notification after an edit no longer matches A. Deactivation
      // is intentionally not used: products.list does not filter inactive rows.
      matchingTotal = total;
      await act(async () => {
        await updateMutationOptionsRef.current?.onSuccess?.({}, { id: product.id });
      });
      view.rerender(<ProductsPage />);
      await waitFor(() =>
        expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'A', page: 1 })
        )
      );
      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
      if (total === 0) expect(screen.getByText('No results.')).toBeVisible();
    }
  );

  it.each([false, true])('resets A→B→A consistently when B was paged: %s', async pageB => {
    productsListUseQueryMock.mockImplementation(({ page }: { page: number }) => ({
      data: cataloguePage(80, page),
      isSuccess: true,
      isLoading: false,
      error: null,
    }));
    render(<ProductsPage />);
    const search = screen.getByPlaceholderText('Search products...');
    fireEvent.change(search, { target: { value: 'A' } });
    await waitFor(() =>
      expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'A', page: 1 })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.change(search, { target: { value: 'B' } });
    await waitFor(() =>
      expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'B', page: 1 })
      )
    );
    if (pageB) fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.change(search, { target: { value: 'A' } });
    await waitFor(() =>
      expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'A', page: 1 })
      )
    );
  });

  it('pages unavailable semantic fallback and resets between literal, fallback and ranked rows', async () => {
    useIsModuleActiveMock.mockReturnValue(true);
    useModulesSnapshotMock.mockReturnValue({
      modules: { 'semantic-search': true },
      isLoading: false,
      isPlaceholder: false,
    });
    semanticSearchUseQueryMock.mockReturnValue({
      data: { mode: 'unavailable' },
      isFetching: false,
    });
    productsListUseQueryMock.mockImplementation(({ page }: { page: number }) => ({
      data: cataloguePage(65, page),
      isSuccess: true,
      isLoading: false,
      error: null,
    }));
    const view = render(<ProductsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Semantic' }));
    expect(productsListUseQueryMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    fireEvent.change(
      screen.getByPlaceholderText('Combine text and meaning (e.g. coffee for brewing)'),
      { target: { value: 'A' } }
    );
    await waitFor(() =>
      expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'A', page: 1 })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    semanticSearchUseQueryMock.mockReturnValue({
      data: { mode: 'semantic', results: [{ ...product, similarity: 0.9 }] },
      isFetching: false,
    });
    view.rerender(<ProductsPage />);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    semanticSearchUseQueryMock.mockReturnValue({
      data: { mode: 'unavailable' },
      isFetching: false,
    });
    view.rerender(<ProductsPage />);
    expect(productsListUseQueryMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Semantic' }));
    expect(productsListUseQueryMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  });

  it('browses the second server page when the catalogue exceeds 50 products', async () => {
    const second = { ...product, id: 'p-51', name: 'Second server page', sku: 'PAGE-051' };
    productsListUseQueryMock.mockImplementation(({ page }: { page: number }) => ({
      data: {
        items: [page === 2 ? second : product],
        page,
        perPage: 50,
        totalItems: 100,
        totalPages: 2,
      },
      isLoading: false,
      error: null,
    }));
    render(<ProductsPage />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, perPage: 50 })
      )
    );
    expect(screen.getByText('PAGE-051')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('CAF-001')).toBeInTheDocument();
  });

  it('starts a changed server search at page one after browsing page two', async () => {
    productsListUseQueryMock.mockReturnValue({
      data: { items: [product], perPage: 50, totalItems: 100, totalPages: 2 },
      isLoading: false,
      error: null,
    });
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.change(screen.getByPlaceholderText('Search products...'), {
      target: { value: 'CAF' },
    });
    await waitFor(() =>
      expect(productsListUseQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'CAF', page: 1 })
      )
    );
  });

  it('renders the smallest useful column set (provider / location / tier-2 / tier-3 trimmed)', () => {
    render(<ProductsPage />);

    expect(productsListUseQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ includeVariantParents: true })
    );

    // Core columns stay.
    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Stock' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tier 1' })).toBeInTheDocument();

    // Trimmed columns are gone from the default table.
    expect(screen.queryByRole('columnheader', { name: 'Provider' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Location' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Tier 2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Tier 3' })).not.toBeInTheDocument();
  });

  it('opens the row-detail Drawer with the trimmed fields when Details is clicked', () => {
    render(<ProductsPage />);

    // Drawer closed initially.
    expect(screen.queryByTestId('product-details-drawer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view details|ver detalle/i }));

    const drawer = screen.getByTestId('product-details-drawer');
    expect(drawer).toBeInTheDocument();
    // Provider + location were trimmed from the table, so they appear ONLY
    // in the drawer.
    expect(screen.getByText('Proveedor Norte')).toBeInTheDocument();
    expect(screen.getByText('Bodega A')).toBeInTheDocument();
    // SKU legitimately shows in the name cell AND the drawer — scope to the
    // drawer to disambiguate.
    expect(within(drawer).getByText('CAF-001')).toBeInTheDocument();
  });

  it('waits for complete edit details and keeps one immutable optimistic-version snapshot', async () => {
    let resolveProductDetail: ((value: Record<string, unknown>) => void) | undefined;
    productDetailFetchMock.mockReturnValue(
      new Promise<Record<string, unknown>>(resolve => {
        resolveProductDetail = resolve;
      })
    );
    const { rerender } = render(<ProductsPage />);

    fireEvent.click(screen.getByRole('button', { name: /view details|ver detalle/i }));
    const drawer = screen.getByTestId('product-details-drawer');
    fireEvent.click(within(drawer).getByRole('button', { name: /edit product|editar producto/i }));

    expect(screen.getByTestId('product-edit-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('product-form-modal')).not.toBeInTheDocument();

    resolveProductDetail?.({
      ...product,
      version: 7,
      updatedAt: '2026-07-27T15:00:00.000Z',
      unitAssignments: [],
      providerAssignments: [],
    });

    await waitFor(() => expect(screen.getByTestId('product-form-modal')).toBeInTheDocument());
    expect(screen.getByTestId('product-form-modal')).toHaveAttribute('data-product-version', '7');

    productDetailFetchMock.mockResolvedValue({
      ...product,
      name: 'Background refresh name',
      version: 8,
      updatedAt: '2026-07-27T15:01:00.000Z',
      unitAssignments: [],
      providerAssignments: [],
    });
    rerender(<ProductsPage />);

    await waitFor(() => {
      expect(productDetailFetchMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('product-form-modal')).toHaveAttribute(
        'data-product-name',
        'Café Premium'
      );
      expect(screen.getByTestId('product-form-modal')).toHaveAttribute('data-product-version', '7');
    });
  });

  it('invalidates the saved product detail before a later edit can reuse it', async () => {
    render(<ProductsPage />);

    await updateMutationOptionsRef.current?.onSuccess?.(undefined, { id: product.id });

    expect(productsListInvalidateMock).toHaveBeenCalledTimes(1);
    expect(productDetailInvalidateMock).toHaveBeenCalledWith({ id: product.id });
  });
  it('keeps the confirmation open after a rejected deactivation and succeeds on retry', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'synthetic-admin', role: 'admin' } });
    deleteResultMock.mockRejectedValueOnce(new Error('Synthetic rejected deactivation'));
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole('button', { name: i18next.t('common:actions.delete') }));

    act(() => confirmPropsRef.current!.onConfirm());
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(deleteResultMock).toHaveBeenCalledWith({ id: product.id });
    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: i18next.t('products:toast.deactivateError') })
    );
    expect(productsListInvalidateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('product-delete-confirmation')).toBeInTheDocument();

    deleteResultMock.mockResolvedValueOnce({ success: true, id: product.id });
    act(() => confirmPropsRef.current!.onConfirm());
    await waitFor(() =>
      expect(screen.queryByTestId('product-delete-confirmation')).not.toBeInTheDocument()
    );
    expect(productsListInvalidateMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith({
      title: i18next.t('products:toast.deactivated'),
    });
  });

  it('cancels deactivation without a request', () => {
    useAuthMock.mockReturnValue({ user: { id: 'synthetic-admin', role: 'admin' } });
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole('button', { name: i18next.t('common:actions.delete') }));
    act(() => confirmPropsRef.current!.onClose());
    expect(screen.queryByTestId('product-delete-confirmation')).not.toBeInTheDocument();
    expect(deleteResultMock).not.toHaveBeenCalled();
  });

  it('invalidates the deactivated product detail so a later edit loads the new version', async () => {
    render(<ProductsPage />);

    await deleteMutationOptionsRef.current?.onSuccess?.(undefined, { id: product.id });

    expect(productsListInvalidateMock).toHaveBeenCalledTimes(1);
    expect(productDetailInvalidateMock).toHaveBeenCalledWith({ id: product.id });
  });
});
