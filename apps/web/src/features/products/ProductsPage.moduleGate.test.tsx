/**
 * ENG-068 — Products semantic-search module gate.
 *
 * The server now rejects `products.semanticSearch` when the
 * `semantic-search` module is inactive. ProductsPage must hide the
 * semantic toolbar and keep the query disabled in that state.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useAuthMock,
  useIsModuleActiveMock,
  useModulesSnapshotMock,
  semanticSearchUseQueryMock,
  embeddingHealthUseQueryMock,
  regenerateMutateMock,
  semanticSearchInvalidateMock,
  embeddingHealthInvalidateMock,
  marginUseQueryMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useIsModuleActiveMock: vi.fn(),
  useModulesSnapshotMock: vi.fn(),
  semanticSearchUseQueryMock: vi.fn(),
  embeddingHealthUseQueryMock: vi.fn(),
  regenerateMutateMock: vi.fn(),
  semanticSearchInvalidateMock: vi.fn(),
  embeddingHealthInvalidateMock: vi.fn(),
  marginUseQueryMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/features/modules', () => ({
  useIsModuleActive: useIsModuleActiveMock,
  useModulesSnapshot: useModulesSnapshotMock,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/components/tables/DataTable', () => ({
  DataTable: ({ searchPlaceholder }: { searchPlaceholder?: string }) => (
    <div data-testid="products-table">{searchPlaceholder}</div>
  ),
}));

vi.mock('@/components/tables/TableExportActions', () => ({
  TableExportActions: () => <div data-testid="export-actions" />,
}));

vi.mock('@/features/products/ProductFormModal', () => ({
  ProductFormModal: () => null,
}));

vi.mock('@/components/form-controls/Modal', () => ({
  ConfirmModal: () => null,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      products: {
        list: { invalidate: vi.fn() },
        semanticSearch: { invalidate: semanticSearchInvalidateMock },
        embeddingHealth: { invalidate: embeddingHealthInvalidateMock },
      },
    }),
    products: {
      list: {
        useQuery: () => ({ data: { items: [] }, isLoading: false, error: null }),
      },
      semanticSearch: {
        useQuery: semanticSearchUseQueryMock,
      },
      embeddingHealth: {
        useQuery: embeddingHealthUseQueryMock,
      },
      regenerateEmbeddings: {
        useMutation: (options?: {
          onSuccess?: (data: { ok: true; embedded: number }) => void;
        }) => ({
          mutate: () => {
            regenerateMutateMock();
            options?.onSuccess?.({ ok: true, embedded: 3 });
          },
          isPending: false,
        }),
      },
      getById: {
        useQuery: () => ({ data: null }),
      },
      create: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
      update: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
      delete: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
    // ENG-195 — the margin query is admin-only; the page keeps a stable
    // empty column while an enabled query loads.
    reports: {
      profit: { margin: { useQuery: marginUseQueryMock } },
    },
    categories: {
      tree: {
        useQuery: () => ({ data: { items: [] } }),
      },
    },
    providers: {
      list: {
        useQuery: () => ({ data: { items: [] } }),
      },
    },
    locations: {
      list: {
        useQuery: () => ({ data: { items: [] } }),
      },
    },
    units: {
      list: {
        useQuery: () => ({ data: { items: [] } }),
      },
    },
    vatRates: {
      list: {
        useQuery: () => ({ data: { items: [] } }),
      },
    },
  },
}));

import { ProductsPage } from './ProductsPage';

describe('ProductsPage semantic-search module gate', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useIsModuleActiveMock.mockReset();
    semanticSearchUseQueryMock.mockReset();
    embeddingHealthUseQueryMock.mockReset();
    useModulesSnapshotMock.mockReset();
    regenerateMutateMock.mockReset();
    semanticSearchInvalidateMock.mockReset();
    embeddingHealthInvalidateMock.mockReset();
    marginUseQueryMock.mockReset();
    useAuthMock.mockReturnValue({
      user: { id: 'u-1', role: 'manager' },
    });
    semanticSearchUseQueryMock.mockReturnValue({
      data: null,
      isFetching: false,
    });
    embeddingHealthUseQueryMock.mockReturnValue({ data: null, isLoading: false });
    marginUseQueryMock.mockReturnValue({ data: null, isLoading: false, error: null });
    useModulesSnapshotMock.mockReturnValue({
      modules: { 'semantic-search': true },
      isLoading: false,
      isPlaceholder: false,
    });
  });

  it('only enables the realized-margin query for admins', () => {
    useIsModuleActiveMock.mockReturnValue(false);
    render(<ProductsPage />);
    expect(marginUseQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 500 }),
      expect.objectContaining({ enabled: false })
    );

    marginUseQueryMock.mockClear();
    useAuthMock.mockReturnValue({ user: { id: 'u-admin', role: 'admin' } });
    render(<ProductsPage />);
    expect(marginUseQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 500 }),
      expect.objectContaining({ enabled: true, staleTime: 5 * 60_000 })
    );
  });

  it('hides the semantic toolbar and disables the query when module is inactive', () => {
    useIsModuleActiveMock.mockReturnValue(false);

    render(<ProductsPage />);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(semanticSearchUseQueryMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    );
    expect(embeddingHealthUseQueryMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: false })
    );
  });

  it('keeps semantic queries disabled while the modules snapshot is still placeholder', () => {
    useIsModuleActiveMock.mockReturnValue(true);
    useModulesSnapshotMock.mockReturnValue({
      modules: { 'semantic-search': true },
      isLoading: true,
      isPlaceholder: true,
    });

    render(<ProductsPage />);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(semanticSearchUseQueryMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    );
    expect(embeddingHealthUseQueryMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: false })
    );
  });

  it('shows the semantic toolbar when module is active for manager+', () => {
    useIsModuleActiveMock.mockReturnValue(true);

    render(<ProductsPage />);

    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /regenerate|regenerar/i })).not.toBeInTheDocument();
  });

  it('reveals the semantic search input after the active module switch is enabled', () => {
    useIsModuleActiveMock.mockReturnValue(true);

    render(<ProductsPage />);
    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(semanticSearchUseQueryMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    );
  });

  it('keeps regenerate embeddings available only to admins when module is active', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u-1', role: 'admin' },
    });
    useIsModuleActiveMock.mockReturnValue(true);

    render(<ProductsPage />);
    fireEvent.click(screen.getByRole('button', { name: /regenerate|regenerar/i }));

    expect(regenerateMutateMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(semanticSearchInvalidateMock).toHaveBeenCalled();
      expect(embeddingHealthInvalidateMock).toHaveBeenCalled();
    });
  });
});
