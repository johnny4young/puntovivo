/**
 * ENG-068 — Products semantic-search module gate.
 *
 * The server now rejects `products.semanticSearch` when the
 * `semantic-search` module is inactive. ProductsPage must hide the
 * semantic toolbar and keep the query disabled in that state.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useAuthMock,
  useIsModuleActiveMock,
  semanticSearchUseQueryMock,
  regenerateMutateMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useIsModuleActiveMock: vi.fn(),
  semanticSearchUseQueryMock: vi.fn(),
  regenerateMutateMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/features/modules', () => ({
  useIsModuleActive: useIsModuleActiveMock,
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
        semanticSearch: { invalidate: vi.fn() },
      },
    }),
    products: {
      list: {
        useQuery: () => ({ data: { items: [] }, isLoading: false, error: null }),
      },
      semanticSearch: {
        useQuery: semanticSearchUseQueryMock,
      },
      regenerateEmbeddings: {
        useMutation: () => ({ mutate: regenerateMutateMock, isPending: false }),
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
    regenerateMutateMock.mockReset();
    useAuthMock.mockReturnValue({
      user: { id: 'u-1', role: 'manager' },
    });
    semanticSearchUseQueryMock.mockReturnValue({
      data: null,
      isFetching: false,
    });
  });

  it('hides the semantic toolbar and disables the query when module is inactive', () => {
    useIsModuleActiveMock.mockReturnValue(false);

    render(<ProductsPage />);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(semanticSearchUseQueryMock).toHaveBeenCalledWith(
      expect.any(Object),
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

  it('keeps regenerate embeddings available only to admins when module is active', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u-1', role: 'admin' },
    });
    useIsModuleActiveMock.mockReturnValue(true);

    render(<ProductsPage />);
    fireEvent.click(screen.getByRole('button', { name: /regenerate|regenerar/i }));

    expect(regenerateMutateMock).toHaveBeenCalled();
  });
});
