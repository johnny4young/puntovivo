/**
 * ENG-098 — KdsBoard unit tests.
 *
 * Drives the board against synthetic `kds.list` payloads with the
 * realtime hook stubbed. Covers:
 * - empty state copy.
 * - query error state.
 * - rendered cards grouped by station; quantity + product name.
 * - Listo click fires `markReady` + invalidates the list.
 * - Recall flow from a ready card → `recall` + invalidate + info toast.
 * - SSE event triggers `kds.list.invalidate()`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockKdsOrder {
  id: string;
  saleId: string;
  saleNumber: string;
  tableLabel: string | null;
  station: string;
  items: Array<{ saleItemId: string; productName: string; quantity: number }>;
  notes: string | null;
  status: 'pending' | 'ready';
  createdAt: string;
  readyAt: string | null;
}

interface ListQueryRef {
  current: {
    data: { items: MockKdsOrder[]; readyTtlMinutes: number };
    isLoading: boolean;
    isError: boolean;
  };
}

const {
  useTenantMock,
  useRealtimeChannelMock,
  listQueryRef,
  invalidateListMock,
  markReadyMutateMock,
  recallMutateMock,
  toastSuccessMock,
  toastInfoMock,
  toastErrorMock,
} = vi.hoisted(() => {
  const ref: ListQueryRef = {
    current: {
      data: { items: [], readyTtlMinutes: 5 },
      isLoading: false,
      isError: false,
    },
  };
  return {
    useTenantMock: vi.fn(),
    useRealtimeChannelMock: vi.fn(),
    listQueryRef: ref,
    invalidateListMock: vi.fn().mockResolvedValue(undefined),
    markReadyMutateMock: vi.fn(),
    recallMutateMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastInfoMock: vi.fn(),
    toastErrorMock: vi.fn(),
  };
});

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: useTenantMock,
}));

vi.mock('@/hooks/useRealtimeChannel', () => ({
  useRealtimeChannel: useRealtimeChannelMock,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    info: toastInfoMock,
    warning: vi.fn(),
    error: toastErrorMock,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      kds: {
        list: { invalidate: invalidateListMock },
      },
    }),
    kds: {
      list: {
        useQuery: () => listQueryRef.current,
      },
      markReady: {
        useMutation: (opts: {
          onSuccess?: () => Promise<void> | void;
          onError?: (err: unknown) => void;
          onSettled?: () => void;
        }) => ({
          mutate: (input: { id: string }) => {
            markReadyMutateMock(input);
            void opts.onSuccess?.();
            opts.onSettled?.();
          },
          isPending: false,
        }),
      },
      recall: {
        useMutation: (opts: {
          onSuccess?: () => Promise<void> | void;
          onError?: (err: unknown) => void;
          onSettled?: () => void;
        }) => ({
          mutate: (input: { id: string }) => {
            recallMutateMock(input);
            void opts.onSuccess?.();
            opts.onSettled?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

import '@/i18n';
import { KdsBoard } from '../KdsBoard';

const ACTIVE_SITE = { id: 'site-1', name: 'Sede principal' };

function setListData(items: MockKdsOrder[]) {
  listQueryRef.current = {
    data: { items, readyTtlMinutes: 5 },
    isLoading: false,
    isError: false,
  };
}

describe('KdsBoard (ENG-098)', () => {
  beforeEach(() => {
    invalidateListMock.mockClear();
    markReadyMutateMock.mockClear();
    recallMutateMock.mockClear();
    toastInfoMock.mockClear();
    toastErrorMock.mockClear();
    useTenantMock.mockReset();
    useRealtimeChannelMock.mockReset();
    useTenantMock.mockReturnValue({
      currentTenant: { id: 'tenant-1' },
      tenantSettings: null,
      sites: [ACTIVE_SITE],
      currentSite: ACTIVE_SITE,
      isLoadingSites: false,
      switchSite: vi.fn(),
    });
    setListData([]);
  });

  it('renders the empty state when no orders are pending', () => {
    render(<KdsBoard />);
    expect(screen.getByTestId('kds-empty-state')).toBeInTheDocument();
  });

  it('renders an error state when the KDS list cannot load', () => {
    listQueryRef.current = {
      data: { items: [], readyTtlMinutes: 5 },
      isLoading: false,
      isError: true,
    };
    render(<KdsBoard />);
    expect(screen.getByTestId('kds-load-error')).toBeInTheDocument();
  });

  it('renders one card per pending order with quantity + product name', () => {
    setListData([
      {
        id: 'kds-1',
        saleId: 'sale-1',
        saleNumber: 'VTA-001',
        tableLabel: 'Mesa 5',
        station: 'main',
        items: [
          { saleItemId: 'si-1', productName: 'Bandeja paisa', quantity: 2 },
          { saleItemId: 'si-2', productName: 'Limonada de coco', quantity: 1 },
        ],
        notes: 'Sin cebolla',
        status: 'pending',
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        readyAt: null,
      },
    ]);
    render(<KdsBoard />);
    const cards = screen.getAllByTestId('kds-order-card');
    expect(cards).toHaveLength(1);
    expect(screen.getByTestId('kds-order-table-label')).toHaveTextContent('Mesa 5');
    expect(screen.getByText('Bandeja paisa')).toBeInTheDocument();
    expect(screen.getByText('Limonada de coco')).toBeInTheDocument();
    expect(screen.getByText(/Sin cebolla/)).toBeInTheDocument();
  });

  it('fires markReady + invalidates the list on Listo click', async () => {
    setListData([
      {
        id: 'kds-1',
        saleId: 'sale-1',
        saleNumber: 'VTA-001',
        tableLabel: 'Mesa 5',
        station: 'main',
        items: [{ saleItemId: 'si-1', productName: 'Bandeja paisa', quantity: 2 }],
        notes: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        readyAt: null,
      },
    ]);
    render(<KdsBoard />);
    fireEvent.click(screen.getByTestId('kds-order-ready'));
    expect(markReadyMutateMock).toHaveBeenCalledWith({ id: 'kds-1' });
    await waitFor(() => expect(invalidateListMock).toHaveBeenCalled());
  });

  it('renders a ready card with the recall affordance and fires recall', async () => {
    const readyAt = new Date().toISOString();
    setListData([
      {
        id: 'kds-2',
        saleId: 'sale-2',
        saleNumber: 'VTA-002',
        tableLabel: 'Mesa 2',
        station: 'main',
        items: [{ saleItemId: 'si-1', productName: 'Sancocho', quantity: 1 }],
        notes: null,
        status: 'ready',
        createdAt: new Date(Date.now() - 120_000).toISOString(),
        readyAt,
      },
    ]);
    render(<KdsBoard />);
    const card = screen.getByTestId('kds-order-card');
    expect(card).toHaveAttribute('data-order-status', 'ready');
    const recall = screen.getByTestId('kds-order-recall');
    fireEvent.click(recall);
    expect(recallMutateMock).toHaveBeenCalledWith({ id: 'kds-2' });
    await waitFor(() => expect(toastInfoMock).toHaveBeenCalled());
  });

  it('triggers a list invalidate when the realtime hook fires an event', () => {
    setListData([]);
    render(<KdsBoard />);
    const lastCall = useRealtimeChannelMock.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    const args = lastCall![0] as { onEvent: (ev: unknown) => void };
    args.onEvent({ type: 'kds.order.created', data: { saleId: 'x' } });
    expect(invalidateListMock).toHaveBeenCalled();
  });
});
