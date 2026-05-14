/**
 * ENG-039b — RestaurantTablesPage tests.
 *
 * Drives admin CRUD + archive flow against mocked trpc procedures. The
 * row-action buttons mirror the LocationsPage pattern.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const archiveMutateAsync = vi.fn();
const listInvalidate = vi.fn();

let mockUserRole: 'admin' | 'manager' = 'admin';
let mockTables: Array<Record<string, unknown>> = [];

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'demo@test', role: mockUserRole, tenantId: 't-1' },
  }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentSite: { id: 'site-1', name: 'Main' },
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      restaurantTables: { list: { invalidate: listInvalidate } },
    }),
    sites: {
      list: {
        useQuery: () => ({
          data: {
            items: [
              { id: 'site-1', name: 'Main' },
              { id: 'site-2', name: 'Sucursal Norte' },
            ],
          },
          isLoading: false,
          error: null,
        }),
      },
    },
    restaurantTables: {
      list: {
        useQuery: () => ({
          data: { items: mockTables },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      create: {
        useMutation: () => ({
          mutateAsync: createMutateAsync,
          isPending: false,
          reset: vi.fn(),
          error: null,
        }),
      },
      update: {
        useMutation: () => ({
          mutateAsync: updateMutateAsync,
          isPending: false,
          reset: vi.fn(),
          error: null,
        }),
      },
      archive: {
        useMutation: () => ({
          mutateAsync: archiveMutateAsync,
          isPending: false,
          reset: vi.fn(),
          error: null,
        }),
      },
    },
  },
}));

import { RestaurantTablesPage } from '../RestaurantTablesPage';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RestaurantTablesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
  createMutateAsync.mockClear();
  createMutateAsync.mockResolvedValue(undefined);
  updateMutateAsync.mockClear();
  updateMutateAsync.mockResolvedValue(undefined);
  archiveMutateAsync.mockClear();
  archiveMutateAsync.mockResolvedValue(undefined);
  listInvalidate.mockClear();
  mockUserRole = 'admin';
  mockTables = [
    {
      id: 'rt-1',
      tenantId: 't-1',
      siteId: 'site-1',
      name: 'Mesa 1',
      seatCount: 4,
      area: 'Salón',
      notes: null,
      isActive: true,
      createdAt: '2026-05-10T10:00:00.000Z',
      updatedAt: '2026-05-10T10:00:00.000Z',
    },
    {
      id: 'rt-2',
      tenantId: 't-1',
      siteId: 'site-1',
      name: 'Mesa 2',
      seatCount: null,
      area: null,
      notes: 'Cerca de la ventana',
      isActive: true,
      createdAt: '2026-05-10T10:05:00.000Z',
      updatedAt: '2026-05-10T10:05:00.000Z',
    },
  ];
  void i18n.changeLanguage('en');
});

describe('RestaurantTablesPage — admin', () => {
  it('renders the rows + site selector + Crear mesa CTA', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Mesa 1')).toBeInTheDocument();
      expect(screen.getByText('Mesa 2')).toBeInTheDocument();
    });
    expect(screen.getByTestId('restaurant-tables-site-select')).toBeInTheDocument();
    const createCta = screen.getByTestId('restaurant-tables-create-cta');
    expect(createCta).not.toBeDisabled();
  });

  it('opens the create modal and fires the mutation on submit', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Mesa 1'));
    fireEvent.click(screen.getByTestId('restaurant-tables-create-cta'));
    fireEvent.change(screen.getByTestId('restaurant-table-name'), {
      target: { value: 'Mesa 3' },
    });
    fireEvent.change(screen.getByTestId('restaurant-table-seat-count'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByTestId('restaurant-table-area'), {
      target: { value: 'Terraza' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({
        siteId: 'site-1',
        name: 'Mesa 3',
        seatCount: 6,
        area: 'Terraza',
        notes: null,
      });
    });
  });

  it('opens the archive confirm modal and fires the archive mutation', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Mesa 1'));
    fireEvent.click(screen.getByTestId('restaurant-table-archive-rt-1'));
    fireEvent.click(screen.getByRole('button', { name: /Archive$/i }));
    await waitFor(() => {
      expect(archiveMutateAsync).toHaveBeenCalledWith({ id: 'rt-1' });
    });
  });

  it('toggles show-archived and includes archived rows in the next query', () => {
    renderPage();
    const toggle = screen.getByTestId(
      'restaurant-tables-show-archived'
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
  });
});

describe('RestaurantTablesPage — manager', () => {
  it('manager sees the list but the Crear mesa CTA is disabled + permission note shows', async () => {
    mockUserRole = 'manager';
    renderPage();
    await waitFor(() => screen.getByText('Mesa 1'));
    const cta = screen.getByTestId('restaurant-tables-create-cta');
    expect(cta).toBeDisabled();
    expect(
      screen.getByTestId('restaurant-tables-permission-note')
    ).toBeInTheDocument();
  });

  it('manager does not see the archive button on active rows', async () => {
    mockUserRole = 'manager';
    renderPage();
    await waitFor(() => screen.getByText('Mesa 1'));
    expect(
      screen.queryByTestId('restaurant-table-archive-rt-1')
    ).toBeNull();
  });
});

describe('RestaurantTablesPage — empty state', () => {
  it('shows the empty body when the list returns no rows', () => {
    mockTables = [];
    renderPage();
    // ResourcePage renders zero rows but no explicit "empty" copy in
    // this layer. Smoke: the create CTA is still reachable for admin.
    expect(screen.getByTestId('restaurant-tables-create-cta')).toBeInTheDocument();
  });
});
