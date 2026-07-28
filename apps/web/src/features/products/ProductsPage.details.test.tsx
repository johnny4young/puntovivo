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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: useAuthMock }));
vi.mock('@/features/modules', () => ({
  useIsModuleActive: useIsModuleActiveMock,
  useModulesSnapshot: useModulesSnapshotMock,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
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
  ConfirmModal: () => null,
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

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
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
        useQuery: (input: unknown) => productsListUseQueryMock(input),
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
      delete: { useMutation: () => ({ mutateAsync: vi.fn() }) },
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
    productDetailFetchMock.mockReset();
    productDetailInvalidateMock.mockReset();
    productsListInvalidateMock.mockReset();
    updateMutationOptionsRef.current = null;
    productFormModalMock.mockReset();
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
});
