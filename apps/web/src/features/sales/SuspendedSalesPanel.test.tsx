/**
 * ENG-039c — SuspendedSalesPanel component tests.
 *
 * Closes a BACKLOG gap flagged after ENG-018b shipped: the panel was
 * only exercised by the E2E round-trip. This test file covers the
 * local state machine (empty / loading / error / draft rows /
 * discard-confirm flow) plus the new ENG-039c restaurant table badge
 * surface.
 *
 * The test mounts the panel directly with a stubbed tRPC layer so we
 * can drive the listDrafts query state deterministically without
 * lifting the QueryClient hydration logic.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';

const authMock = vi.hoisted(() => ({
  role: 'manager' as 'admin' | 'manager' | 'cashier',
}));

const listDraftsMock = vi.fn();
const discardMutateAsync = vi.fn();
// ENG-039c2 — mutation stub for `sales.changeTable`. Resolves/rejects
// independently of the discard stub so the transfer-modal flow can be
// driven in isolation.
const changeTableMutateAsync = vi.fn();
const refetchMock = vi.fn();
const invalidateMock = vi.fn();
// ENG-039c2 — gate query feeding the "Cambiar mesa" CTA. Default
// (empty catalog) keeps the CTA hidden so legacy tests stay green.
const restaurantTablesListMock = vi.fn();
// ENG-039c2 — dropdown feed for the transfer modal. Augments each row
// with `openDraft` so the modal can mark occupied tables.
const restaurantTablesListWithDraftStatusMock = vi.fn();

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: authMock.role },
  }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentTenant: { id: 't-1', name: 'Restaurante Sabor', slug: 'sabor' },
    currentSite: { id: 'site-1', name: 'Sucursal Centro', tenantId: 't-1' },
  }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (
    procedure: string,
    opts?: {
      onSuccess?: (data: unknown, variables: unknown) => Promise<void> | void;
      onError?: (err: unknown) => void;
    }
  ) => {
    const mutateAsync =
      procedure === 'sales.changeTable'
        ? changeTableMutateAsync
        : discardMutateAsync;
    return {
      mutate: vi.fn((variables: Record<string, unknown>) => {
        void mutateAsync(variables).then(
          async (result: unknown) => {
            await opts?.onSuccess?.(result, variables);
          },
          (err: unknown) => {
            opts?.onError?.(err);
          }
        );
      }),
      mutateAsync,
      isPending: false,
    };
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sales: {
      listDrafts: {
        useQuery: () => listDraftsMock(),
      },
    },
    restaurantTables: {
      list: {
        useQuery: (...args: unknown[]) => restaurantTablesListMock(...args),
      },
      listWithDraftStatus: {
        useQuery: (...args: unknown[]) =>
          restaurantTablesListWithDraftStatusMock(...args),
      },
    },
    useUtils: () => ({
      sales: { listDrafts: { invalidate: invalidateMock } },
      inventory: { listStock: { invalidate: invalidateMock } },
      products: { list: { invalidate: invalidateMock } },
      restaurantTables: {
        listWithDraftStatus: { invalidate: invalidateMock },
      },
    }),
  },
}));

import { SuspendedSalesPanel } from './SuspendedSalesPanel';

function renderPanel(props?: { isOpen?: boolean; onResume?: () => void }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SuspendedSalesPanel
          isOpen={props?.isOpen ?? true}
          onClose={vi.fn()}
          onResume={props?.onResume ?? vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function makeDraft(overrides?: Record<string, unknown>) {
  return {
    id: 'sale-1',
    saleNumber: 'VTA-N-000001',
    customerId: null,
    customerName: null,
    subtotal: 10,
    taxAmount: 0,
    total: 10,
    notes: null,
    suspendedAt: '2026-05-14T10:00:00.000Z',
    suspendedBy: null,
    suspendedLabel: null,
    tableId: null,
    tableName: null,
    createdBy: 'user-1',
    cashSessionId: null,
    createdAt: '2026-05-14T10:00:00.000Z',
    updatedAt: '2026-05-14T10:00:00.000Z',
    itemCount: 2,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  listDraftsMock.mockReset();
  discardMutateAsync.mockReset();
  changeTableMutateAsync.mockReset();
  refetchMock.mockReset();
  invalidateMock.mockReset();
  restaurantTablesListMock.mockReset();
  restaurantTablesListWithDraftStatusMock.mockReset();
  authMock.role = 'manager';
  // ENG-039c2 — default both restaurantTables queries to "empty
  // catalog" so legacy cases stay green. Cases that need the CTA
  // override with `mockReturnValue` per-test.
  restaurantTablesListMock.mockReturnValue({
    data: { items: [] },
    isLoading: false,
    error: null,
  });
  restaurantTablesListWithDraftStatusMock.mockReturnValue({
    data: { items: [] },
    isLoading: false,
    error: null,
  });
  await i18n.changeLanguage('es');
});

describe('SuspendedSalesPanel — base render', () => {
  it('renders nothing when isOpen is false', () => {
    listDraftsMock.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
    const { container } = renderPanel({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('shows the empty state when listDrafts returns no items', () => {
    listDraftsMock.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
    renderPanel();
    expect(screen.getByTestId('suspended-sales-empty')).toBeDefined();
  });

  it('renders the error block with a retry button when listDrafts fails', () => {
    listDraftsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: refetchMock,
    });
    renderPanel();
    expect(screen.getByTestId('suspended-sales-error')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /reintentar|retry/i }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('SuspendedSalesPanel — draft cards (ENG-018b + ENG-039c)', () => {
  it('renders one card per draft and includes the saleNumber + label', () => {
    listDraftsMock.mockReturnValue({
      data: {
        items: [
          makeDraft({ id: 'sale-a', suspendedLabel: 'Mesa libre', itemCount: 1 }),
          makeDraft({ id: 'sale-b', saleNumber: 'VTA-N-000002', itemCount: 3 }),
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
    renderPanel();
    expect(screen.getAllByTestId('suspended-draft-card')).toHaveLength(2);
    expect(screen.getByText('Mesa libre')).toBeDefined();
    // The fallback row (label=null) uses the saleNumber as the heading
    // AND echoes it in the subtitle, so the same text appears twice.
    expect(screen.getAllByText('VTA-N-000002').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the table badge when the draft carries a tableId + tableName', () => {
    listDraftsMock.mockReturnValue({
      data: {
        items: [
          makeDraft({
            id: 'sale-table',
            suspendedLabel: 'Mesa 5',
            tableId: 'rt-1',
            tableName: 'Mesa 5',
          }),
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
    renderPanel();
    const badge = screen.getByTestId('suspended-draft-table-badge');
    expect(badge.textContent).toContain('Mesa 5');
  });

  it('omits the badge when the draft has no tableId (free-text fallback)', () => {
    listDraftsMock.mockReturnValue({
      data: {
        items: [
          makeDraft({ suspendedLabel: 'Cliente Juan', tableId: null, tableName: null }),
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
    renderPanel();
    expect(screen.queryByTestId('suspended-draft-table-badge')).toBeNull();
  });

  it('fires onResume with the picked draft summary when the resume button is clicked', () => {
    const onResume = vi.fn();
    listDraftsMock.mockReturnValue({
      data: { items: [makeDraft({ id: 'sale-resume' })] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
    renderPanel({ onResume });
    fireEvent.click(screen.getByTestId('suspended-draft-resume'));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume.mock.calls[0]?.[0]).toMatchObject({ id: 'sale-resume' });
  });

  it('opens the discard confirm modal and forwards saleId to the mutation on confirm', async () => {
    discardMutateAsync.mockResolvedValue(undefined);
    listDraftsMock.mockReturnValue({
      data: { items: [makeDraft({ id: 'sale-discard' })] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
    renderPanel();
    fireEvent.click(screen.getByTestId('suspended-draft-discard'));
    // ConfirmModal renders a confirm button labelled with "Discard"
    // / "Descartar" depending on the locale. The row's own "Descartar"
    // button keeps the same text, so query within the dialog to
    // disambiguate.
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: /descartar|discard/i,
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(discardMutateAsync).toHaveBeenCalledWith({ saleId: 'sale-discard' })
    );
  });
});

describe('SuspendedSalesPanel — transfer-to-table CTA (ENG-039c2)', () => {
  const tableA = {
    id: 'rt-a',
    tenantId: 't-1',
    siteId: 'site-1',
    name: 'Mesa A',
    seatCount: 4,
    area: null,
    notes: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
    openDraft: null as null | {
      saleId: string;
      saleNumber: string;
      suspendedAt: string | null;
      suspendedBy: string | null;
      total: number;
    },
  };
  const tableB = {
    id: 'rt-b',
    tenantId: 't-1',
    siteId: 'site-1',
    name: 'Mesa B',
    seatCount: 2,
    area: null,
    notes: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
    openDraft: null as null | {
      saleId: string;
      saleNumber: string;
      suspendedAt: string | null;
      suspendedBy: string | null;
      total: number;
    },
  };

  function mockListDrafts(items: ReturnType<typeof makeDraft>[]) {
    listDraftsMock.mockReturnValue({
      data: { items },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
  }

  it('hides the CTA and disables the catalog query for cashier users', () => {
    authMock.role = 'cashier';
    mockListDrafts([makeDraft({ id: 'sale-1' })]);
    restaurantTablesListMock.mockReturnValue({
      data: { items: [tableA] },
      isLoading: false,
      error: null,
    });
    renderPanel();
    expect(screen.queryByTestId('suspended-draft-transfer')).toBeNull();
    expect(restaurantTablesListMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: false })
    );
  });

  it('hides the CTA when the restaurant_tables catalog is empty', () => {
    mockListDrafts([makeDraft({ id: 'sale-1' })]);
    // restaurantTablesListMock default returns an empty catalog.
    renderPanel();
    expect(screen.queryByTestId('suspended-draft-transfer')).toBeNull();
  });

  it('hides the CTA while the catalog query is loading (no flash)', () => {
    mockListDrafts([makeDraft({ id: 'sale-1' })]);
    restaurantTablesListMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    renderPanel();
    expect(screen.queryByTestId('suspended-draft-transfer')).toBeNull();
  });

  it('hides the CTA when the catalog query errors out (defensive)', () => {
    mockListDrafts([makeDraft({ id: 'sale-1' })]);
    restaurantTablesListMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    });
    renderPanel();
    expect(screen.queryByTestId('suspended-draft-transfer')).toBeNull();
  });

  it('renders the CTA per row once the catalog has at least one table', () => {
    mockListDrafts([
      makeDraft({ id: 'sale-1' }),
      makeDraft({ id: 'sale-2', saleNumber: 'VTA-N-000002' }),
    ]);
    restaurantTablesListMock.mockReturnValue({
      data: { items: [tableA] },
      isLoading: false,
      error: null,
    });
    renderPanel();
    expect(screen.getAllByTestId('suspended-draft-transfer')).toHaveLength(2);
  });

  it('opens the transfer modal pre-selected with the draft current tableId', () => {
    mockListDrafts([
      makeDraft({
        id: 'sale-on-a',
        tableId: 'rt-a',
        tableName: 'Mesa A',
        suspendedLabel: 'Mesa A',
      }),
    ]);
    restaurantTablesListMock.mockReturnValue({
      data: { items: [tableA, tableB] },
      isLoading: false,
      error: null,
    });
    restaurantTablesListWithDraftStatusMock.mockReturnValue({
      data: { items: [tableA, tableB] },
      isLoading: false,
      error: null,
    });
    renderPanel();
    fireEvent.click(screen.getByTestId('suspended-draft-transfer'));
    const select = screen.getByTestId(
      'transfer-modal-table-select'
    ) as HTMLSelectElement;
    expect(select.value).toBe('rt-a');
    // The "(actual)" marker resolves on the row matching the draft's id.
    const currentOption = Array.from(select.options).find(o => o.value === 'rt-a');
    expect(currentOption?.text).toMatch(/actual/i);
  });

  it('flags occupied tables in the dropdown with an "(ocupada)" suffix', () => {
    mockListDrafts([makeDraft({ id: 'sale-1', tableId: null, tableName: null })]);
    restaurantTablesListMock.mockReturnValue({
      data: { items: [tableA, tableB] },
      isLoading: false,
      error: null,
    });
    restaurantTablesListWithDraftStatusMock.mockReturnValue({
      data: {
        items: [
          tableA,
          {
            ...tableB,
            openDraft: {
              saleId: 'sale-on-b',
              saleNumber: 'VTA-N-000099',
              suspendedAt: '2026-05-14T09:00:00.000Z',
              suspendedBy: 'user-1',
              total: 25,
            },
          },
        ],
      },
      isLoading: false,
      error: null,
    });
    renderPanel();
    fireEvent.click(screen.getByTestId('suspended-draft-transfer'));
    const select = screen.getByTestId(
      'transfer-modal-table-select'
    ) as HTMLSelectElement;
    const occupiedOption = Array.from(select.options).find(o => o.value === 'rt-b');
    expect(occupiedOption?.text).toMatch(/ocupada/i);
  });

  it('confirms a transfer to a new table and invalidates the affected queries', async () => {
    changeTableMutateAsync.mockResolvedValue(undefined);
    mockListDrafts([
      makeDraft({
        id: 'sale-move',
        tableId: 'rt-a',
        tableName: 'Mesa A',
        suspendedLabel: 'Mesa A',
      }),
    ]);
    restaurantTablesListMock.mockReturnValue({
      data: { items: [tableA, tableB] },
      isLoading: false,
      error: null,
    });
    restaurantTablesListWithDraftStatusMock.mockReturnValue({
      data: { items: [tableA, tableB] },
      isLoading: false,
      error: null,
    });
    renderPanel();
    fireEvent.click(screen.getByTestId('suspended-draft-transfer'));
    const select = screen.getByTestId(
      'transfer-modal-table-select'
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'rt-b' } });
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /mover orden/i });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(changeTableMutateAsync).toHaveBeenCalledWith({
        saleId: 'sale-move',
        tableId: 'rt-b',
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(invalidateMock).toHaveBeenCalled();
  });

  it('forwards tableId=null when the operator picks "Liberar mesa"', async () => {
    changeTableMutateAsync.mockResolvedValue(undefined);
    mockListDrafts([
      makeDraft({
        id: 'sale-detach',
        tableId: 'rt-a',
        tableName: 'Mesa A',
        suspendedLabel: 'Mesa A',
      }),
    ]);
    restaurantTablesListMock.mockReturnValue({
      data: { items: [tableA] },
      isLoading: false,
      error: null,
    });
    restaurantTablesListWithDraftStatusMock.mockReturnValue({
      data: { items: [tableA] },
      isLoading: false,
      error: null,
    });
    renderPanel();
    fireEvent.click(screen.getByTestId('suspended-draft-transfer'));
    const select = screen.getByTestId(
      'transfer-modal-table-select'
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__clear__' } });
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /mover orden/i });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(changeTableMutateAsync).toHaveBeenCalledWith({
        saleId: 'sale-detach',
        tableId: null,
      })
    );
  });

  it('keeps the modal open and surfaces a localized hint on mutation error', async () => {
    changeTableMutateAsync.mockRejectedValue(
      Object.assign(new Error('boom'), {
        data: { errorCode: 'SALE_CHANGE_TABLE_INVALID_STATUS' },
      })
    );
    mockListDrafts([
      makeDraft({
        id: 'sale-err',
        tableId: 'rt-a',
        tableName: 'Mesa A',
        suspendedLabel: 'Mesa A',
      }),
    ]);
    restaurantTablesListMock.mockReturnValue({
      data: { items: [tableA, tableB] },
      isLoading: false,
      error: null,
    });
    restaurantTablesListWithDraftStatusMock.mockReturnValue({
      data: { items: [tableA, tableB] },
      isLoading: false,
      error: null,
    });
    renderPanel();
    fireEvent.click(screen.getByTestId('suspended-draft-transfer'));
    const select = screen.getByTestId(
      'transfer-modal-table-select'
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'rt-b' } });
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /mover orden/i });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByTestId('transfer-modal-error')).toBeDefined()
    );
    // Modal stays open after the failure so the operator can retry.
    expect(screen.getByTestId('transfer-modal-table-select')).toBeDefined();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
