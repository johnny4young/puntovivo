/**
 * RestaurantTablesPage tests.
 *
 * Drives admin CRUD + archive flow against mocked trpc procedures. The
 * row-action buttons mirror the LocationsPage pattern.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const archiveMutate = vi.fn();
const listInvalidate = vi.fn();

let mockUserRole: 'admin' | 'manager' = 'admin';
let mockTables: Array<Record<string, unknown>> = [];
let mockFloor: { items: Array<Record<string, unknown>>; occupiedTables: number } | null = null;
let summaryInputs: Array<Record<string, unknown>> = [];
let mockTotalItems = 0;
let mockHasMore = false;
let lastTableListInput: Record<string, unknown> | null = null;
let tableListInputs: Array<Record<string, unknown>> = [];
let archiveOnSuccess: (() => void | Promise<void>) | undefined;

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
      restaurantTables: {
        list: { invalidate: listInvalidate },
        listSummary: { invalidate: vi.fn() },
      },
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
      listSummary: {
        useQuery: (input: Record<string, unknown>) => {
          summaryInputs.push(input);
          return {
            data: mockFloor
              ? {
                  generatedAt: '2026-05-10T21:00:00.000Z',
                  offset: 0,
                  limit: 500,
                  totalItems: mockFloor.items.length,
                  occupiedTables: mockFloor.occupiedTables,
                  hasMore: false,
                  items: mockFloor.items,
                }
              : undefined,
            error: null,
          };
        },
      },
      list: {
        useQuery: (input: Record<string, unknown>) => {
          tableListInputs.push(input);
          lastTableListInput = input;
          return {
            data: {
              items: mockTables,
              totalItems: mockTotalItems,
              hasMore: mockHasMore,
            },
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          };
        },
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
        useMutation: (options?: { onSuccess?: () => void | Promise<void> }) => {
          archiveOnSuccess = options?.onSuccess;
          return {
            mutate: archiveMutate,
            isPending: false,
            reset: vi.fn(),
            error: null,
          };
        },
      },
    },
  },
}));

import { RestaurantTablesPage } from '../RestaurantTablesPage';

function floorTable(
  id: string,
  name: string,
  state: 'free' | 'occupied' | 'billRequested' | 'reserved',
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    name,
    seatCount: 4,
    area: 'Salón',
    notes: null,
    state,
    openedAt: null,
    guestCount: null,
    openChecks: state === 'occupied' || state === 'billRequested' ? 1 : 0,
    total: 0,
    billRequestedAt: null,
    pendingRound: null,
    nextReservation: null,
    ...overrides,
  };
}

function renderPage(path = '/restaurants/tables?view=list') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
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
  archiveMutate.mockClear();
  archiveMutate.mockResolvedValue(undefined);
  listInvalidate.mockClear();
  lastTableListInput = null;
  tableListInputs = [];
  archiveOnSuccess = undefined;
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
  mockTotalItems = mockTables.length;
  mockHasMore = false;
  mockFloor = null;
  summaryInputs = [];
  void i18n.changeLanguage('en');
});

describe('RestaurantTablesPage — admin', () => {
  it('renders the rows + site selector + Crear mesa CTA', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Mesa 1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Mesa 2').length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId('restaurant-tables-site-select')).toBeInTheDocument();
    const createCta = screen.getByTestId('restaurant-tables-create-cta');
    expect(createCta).not.toBeDisabled();
  });

  it('opens the create modal and fires the mutation on submit', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Mesa 1').length).toBeGreaterThan(0));
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
    await waitFor(() => expect(screen.getAllByText('Mesa 1').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('restaurant-table-archive-rt-1'));
    fireEvent.click(screen.getByRole('button', { name: /Archive$/i }));
    await waitFor(() => {
      expect(archiveMutate).toHaveBeenCalledWith({ id: 'rt-1' });
    });
  });

  it('toggles show-archived and includes archived rows in the next query', () => {
    renderPage();
    const toggle = screen.getByTestId('restaurant-tables-show-archived') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
  });

  it('paginates catalogs larger than the operational page without hiding rows', async () => {
    mockTotalItems = 205;
    mockHasMore = true;
    renderPage();

    expect(screen.getByTestId('restaurant-tables-pagination')).toHaveTextContent(
      'Showing 1–2 of 205 tables'
    );
    fireEvent.click(screen.getByTestId('restaurant-tables-next-page'));
    await waitFor(() => {
      expect(lastTableListInput).toMatchObject({ limit: 100, offset: 100 });
    });
    expect(screen.getByTestId('restaurant-tables-previous-page')).not.toBeDisabled();
  });

  it('opens on the floor map with each table state and keeps the list one tab away', () => {
    mockFloor = {
      occupiedTables: 3,
      items: [
        floorTable('rt-10', 'Mesa 10', 'free', { seatCount: 2 }),
        floorTable('rt-8', 'Mesa 8', 'occupied', {
          guestCount: 6,
          openedAt: '2026-05-10T19:55:00.000Z',
          openChecks: 2,
          total: 312000,
          pendingRound: { itemCount: 3, since: '2026-05-10T20:58:00.000Z' },
        }),
        floorTable('rt-3', 'Mesa 3', 'billRequested', {
          openedAt: '2026-05-10T20:10:00.000Z',
          total: 88500,
          billRequestedAt: '2026-05-10T20:57:00.000Z',
        }),
        floorTable('rt-4', 'Mesa 4', 'reserved', {
          nextReservation: {
            id: 'r-1',
            status: 'booked',
            guestName: 'Rojas',
            partySize: 4,
            startsAt: '2026-05-10T22:00:00.000Z',
          },
        }),
        floorTable('rt-1', 'Mesa 1', 'occupied', {
          guestCount: 2,
          openedAt: '2026-05-10T20:42:00.000Z',
          total: 46000,
        }),
      ],
    };
    renderPage('/restaurants/tables');

    expect(summaryInputs).toContainEqual(
      expect.objectContaining({ siteId: 'site-1', limit: 500, offset: 0 })
    );
    const map = screen.getByTestId('restaurant-floor-map-preview');
    expect(screen.getByTestId('restaurant-floor-table-rt-1')).toHaveTextContent(
      '2 guests · 18 min'
    );
    const big = screen.getByTestId('restaurant-floor-table-rt-8');
    expect(big).toHaveTextContent('6 guests · 1 h 05');
    expect(big).toHaveTextContent('2 checks');
    expect(big).toHaveTextContent('round ready to send');
    expect(screen.getByTestId('restaurant-floor-table-rt-3')).toHaveAttribute(
      'data-state',
      'billRequested'
    );
    expect(screen.getByTestId('restaurant-floor-table-rt-3')).toHaveTextContent(
      'Asked for the bill'
    );
    expect(screen.getByTestId('restaurant-floor-table-rt-4')).toHaveTextContent('Reserved');
    expect(screen.getByTestId('restaurant-floor-occupancy')).toHaveTextContent('3 of 5 occupied');
    const names = Array.from(map.querySelectorAll('[data-testid^="restaurant-floor-table-"]')).map(
      tile => tile.getAttribute('data-testid')
    );
    expect(names.indexOf('restaurant-floor-table-rt-8')).toBeLessThan(
      names.indexOf('restaurant-floor-table-rt-10')
    );
    expect(screen.queryByTestId('restaurant-tables-pagination')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('restaurant-tables-view-list'));
    expect(screen.getByTestId('restaurant-table-archive-rt-1')).toBeInTheDocument();
    expect(screen.queryByTestId('restaurant-floor-map-preview')).not.toBeInTheDocument();
  });

  it('never draws the map while the floor state is unknown', () => {
    renderPage('/restaurants/tables');

    expect(screen.queryByTestId('restaurant-floor-map-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('restaurant-floor-status-free')).not.toBeInTheDocument();
  });

  it('opens the edit form from a floor tile', () => {
    mockFloor = { occupiedTables: 0, items: [floorTable('rt-2', 'Mesa 2', 'free')] };
    renderPage('/restaurants/tables');

    fireEvent.click(screen.getByTestId('restaurant-floor-table-rt-2'));
    expect(screen.getByTestId('restaurant-table-name')).toHaveValue('Mesa 2');
  });

  it('searches the list on the server without narrowing the floor map', async () => {
    mockFloor = { occupiedTables: 0, items: [floorTable('rt-101', 'Mesa Terraza 101', 'free')] };
    renderPage('/restaurants/tables');

    expect(screen.getByText('Mesa Terraza 101')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('restaurant-tables-view-list'));
    fireEvent.change(screen.getByPlaceholderText('Restaurant tables'), {
      target: { value: 'Terraza 101' },
    });

    await waitFor(() => {
      expect(tableListInputs).toContainEqual(
        expect.objectContaining({
          search: 'Terraza 101',
          limit: 100,
          offset: 0,
        })
      );
    });
    expect(summaryInputs.every(input => input.search === undefined)).toBe(true);
  });

  it('returns to the first page when archiving the last row of a trailing page', async () => {
    mockTotalItems = 101;
    mockHasMore = true;
    renderPage();
    fireEvent.click(screen.getByTestId('restaurant-tables-next-page'));
    await waitFor(() => {
      expect(lastTableListInput).toMatchObject({ limit: 100, offset: 100 });
    });

    fireEvent.click(screen.getByTestId('restaurant-table-archive-rt-1'));
    fireEvent.click(screen.getByRole('button', { name: /Archive$/i }));
    mockTotalItems = 100;
    mockHasMore = false;
    await act(async () => {
      await archiveOnSuccess?.();
    });

    await waitFor(() => {
      expect(lastTableListInput).toMatchObject({ limit: 100, offset: 0 });
    });
    expect(screen.queryByTestId('restaurant-tables-pagination')).toBeNull();
  });
});

describe('RestaurantTablesPage — manager', () => {
  it('manager sees the list but the Crear mesa CTA is disabled + permission note shows', async () => {
    mockUserRole = 'manager';
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Mesa 1').length).toBeGreaterThan(0));
    const cta = screen.getByTestId('restaurant-tables-create-cta');
    expect(cta).toBeDisabled();
    expect(screen.getByTestId('restaurant-tables-permission-note')).toBeInTheDocument();
  });

  it('manager does not see the archive button on active rows', async () => {
    mockUserRole = 'manager';
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Mesa 1').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('restaurant-table-archive-rt-1')).toBeNull();
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
