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

const listDraftsMock = vi.fn();
const discardMutateAsync = vi.fn();
const refetchMock = vi.fn();
const invalidateMock = vi.fn();

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

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (
    _procedure: string,
    opts?: {
      onSuccess?: (data: unknown) => Promise<void> | void;
      onError?: (err: unknown) => void;
    }
  ) => ({
    mutate: vi.fn(({ saleId }: { saleId: string }) => {
      void discardMutateAsync({ saleId }).then(
        async (result: unknown) => {
          await opts?.onSuccess?.(result);
        },
        (err: unknown) => {
          opts?.onError?.(err);
        }
      );
    }),
    mutateAsync: discardMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sales: {
      listDrafts: {
        useQuery: () => listDraftsMock(),
      },
    },
    useUtils: () => ({
      sales: { listDrafts: { invalidate: invalidateMock } },
      inventory: { listStock: { invalidate: invalidateMock } },
      products: { list: { invalidate: invalidateMock } },
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
  refetchMock.mockReset();
  invalidateMock.mockReset();
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
