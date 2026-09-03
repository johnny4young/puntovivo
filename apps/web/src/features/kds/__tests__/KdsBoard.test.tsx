/** Render real cards; assert observed generations, rich snapshots, stale/offline and role behavior. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { KdsCardData, KitchenOutputs } from '../types';
import { KdsBoard } from '../KdsBoard';
const h = vi.hoisted(() => ({
  stations: [] as KitchenOutputs['stations'],
  items: [] as KdsCardData[],
  error: false,
  loading: false,
  more: false,
  role: 'cashier',
  site: 'site-1',
  invalidate: vi.fn().mockResolvedValue(undefined),
  refetch: vi.fn(),
  stationQuery: vi.fn(),
  stationRefetch: vi.fn(),
  realtime: vi.fn(),
  query: vi.fn(),
  ready: vi.fn(),
  recall: vi.fn(),
  resend: vi.fn(),
  line: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'cook', role: h.role } }),
}));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentSite: h.site ? { id: h.site, name: 'Central' } : null,
    currentTenant: { id: 'tenant-1' },
  }),
}));
vi.mock('@/hooks/useRealtimeChannel', () => ({
  useRealtimeChannel: (input: unknown) => h.realtime(input),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: h.toast, info: h.toast, error: h.toast }),
}));
vi.mock('../KdsConfiguration', () => ({
  KdsConfiguration: () => <div data-testid="configuration" />,
}));
vi.mock('@/lib/trpc', () => {
  const mutation = (spy: (input: unknown) => void) => ({
    useMutation: (options: { onSettled: () => Promise<void> }) => ({
      mutate: (input: unknown) => {
        spy(input);
        void options.onSettled();
      },
      isPending: false,
    }),
  });
  return {
    trpc: {
      useUtils: () => ({ kds: { list: { invalidate: h.invalidate } } }),
      kds: {
        list: {
          useQuery: (input: unknown) => {
            h.query(input);
            return {
              data: { items: h.items, hasMore: h.more, readyTtlMinutes: 5 },
              isLoading: h.loading,
              isError: h.error,
              refetch: h.refetch,
            };
          },
        },
        stations: {
          useQuery: (input: unknown, options: unknown) => {
            h.stationQuery(input, options);
            return { data: h.stations, refetch: h.stationRefetch };
          },
        },
        markReady: mutation(h.ready),
        recall: mutation(h.recall),
        resend: mutation(h.resend),
        transitionLine: mutation(h.line),
      },
    },
  };
});
function card(overrides: Partial<KdsCardData> = {}): KdsCardData {
  return {
    id: 'kds-1',
    version: 7,
    saleId: 'sale-1',
    saleNumber: 'VTA-001',
    tableId: 'table-1',
    tableLabel: 'Mesa 5',
    station: 'main',
    stationName: 'main',
    multipleDestinations: false,
    integrity: 'valid',
    status: 'pending',
    notes: 'Sin cebolla',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    readyAt: null,
    readyByUserId: null,
    items: [
      {
        id: 'line-1',
        version: 3,
        saleItemId: 'si-1',
        productId: 'product-1',
        productName: 'Bandeja paisa',
        quantity: 0.001,
        unitLabel: 'kg',
        notes: 'Sin sal',
        roundId: 'round-1',
        roundLabel: 'Ronda 2',
        courseKey: 'starter',
        dinerLabel: 'Ana',
        modifiers: [{ name: 'Salsa', quantity: 2 }],
        status: 'pending',
        currentSaleId: 'sale-1',
        currentSaleNumber: 'VTA-001',
        currentTableId: 'table-1',
        currentTableLabel: 'Mesa 5',
      },
    ],
    ...overrides,
  };
}
beforeEach(async () => {
  vi.clearAllMocks();
  h.items = [];
  h.stations = [];
  h.error = false;
  h.loading = false;
  h.more = false;
  h.role = 'cashier';
  h.site = 'site-1';
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['kds', 'restaurants']);
});
describe('KdsBoard', () => {
  it('renders empty, loading and missing-site states truthfully', () => {
    const view = render(<KdsBoard />);
    expect(screen.getByTestId('kds-empty-state')).toBeInTheDocument();
    h.loading = true;
    view.rerender(<KdsBoard />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    h.site = '';
    view.rerender(<KdsBoard />);
    expect(screen.getByTestId('kds-no-site')).toBeInTheDocument();
  });
  it('renders an error and disables cached card actions instead of claiming a fresh empty queue', () => {
    h.error = true;
    h.items = [card()];
    render(<KdsBoard />);
    expect(screen.getByTestId('kds-load-error')).toBeInTheDocument();
    expect(screen.getByTestId('kds-order-ready')).toBeDisabled();
    expect(screen.queryByTestId('kds-empty-state')).not.toBeInTheDocument();
  });
  it('renders rich frozen line details with 0.001 precision and safe plain text', () => {
    h.items = [card()];
    render(<KdsBoard />);
    expect(screen.getAllByTestId('kds-order-card')).toHaveLength(1);
    expect(screen.getByTestId('kds-order-ready')).toHaveClass('btn-primary');
    expect(screen.getByText('Bandeja paisa')).toBeInTheDocument();
    expect(screen.getByText('0.001 kg')).toBeInTheDocument();
    expect(screen.getByText('Round: Ronda 2')).toBeInTheDocument();
    expect(screen.getByText('Guest: Ana')).toBeInTheDocument();
    expect(screen.getByText('2 × Salsa')).toBeInTheDocument();
    expect(screen.getByText('Sin sal')).toBeInTheDocument();
    expect(screen.getByText(/Sin cebolla/)).toBeInTheDocument();
  });
  it('sends the displayed generation and suppresses double ready clicks while invalidating', async () => {
    h.items = [card()];
    render(<KdsBoard />);
    const button = screen.getByTestId('kds-order-ready');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(h.ready).toHaveBeenCalledExactlyOnceWith({ id: 'kds-1', expectedVersion: 7 });
    await waitFor(() => expect(h.invalidate).toHaveBeenCalled());
  });
  it('sends observed ready generation on recall', async () => {
    h.items = [card({ status: 'ready', readyAt: new Date().toISOString() })];
    render(<KdsBoard />);
    expect(screen.getByTestId('kds-order-card')).toHaveAttribute('data-order-status', 'ready');
    fireEvent.click(screen.getByTestId('kds-order-recall'));
    expect(h.recall).toHaveBeenCalledWith({ id: 'kds-1', expectedVersion: 7 });
    await waitFor(() => expect(h.invalidate).toHaveBeenCalled());
  });
  it('starts a line with its own generation and resends the same ticket identity', async () => {
    h.items = [card()];
    render(<KdsBoard />);
    fireEvent.click(screen.getByRole('button', { name: 'Start line' }));
    expect(h.line).toHaveBeenCalledWith({
      orderId: 'kds-1',
      lineId: 'line-1',
      expectedVersion: 3,
      status: 'preparing',
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Resend notification/ })).not.toBeDisabled()
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Resend notification/ }));
    });
    expect(h.resend).toHaveBeenCalledWith({ id: 'kds-1', expectedVersion: 7 });
  });
  it('invalidates from a durable SSE event and filters by station', () => {
    render(<KdsBoard />);
    const subscription = h.realtime.mock.calls.at(-1)![0] as { onEvent: () => void };
    subscription.onEvent();
    expect(h.invalidate).toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'main' } });
    expect(h.query).toHaveBeenLastCalledWith({ siteId: 'site-1', station: 'main', limit: 500 });
  });
  it('shows offline feedback, prevents actions and unsubscribes on unmount', () => {
    h.items = [card()];
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(<KdsBoard />);
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Offline');
    expect(screen.getByTestId('kds-order-ready')).toBeDisabled();
    fireEvent.click(screen.getByTestId('kds-order-ready'));
    expect(h.ready).not.toHaveBeenCalled();
    view.unmount();
    expect(remove).toHaveBeenCalledWith('offline', expect.any(Function));
  });
  it('does not expose configuration to a cashier and resets a manager dialog on site switch', () => {
    const view = render(<KdsBoard />);
    expect(screen.queryByRole('button', { name: 'Kitchen settings' })).not.toBeInTheDocument();
    h.role = 'manager';
    view.rerender(<KdsBoard />);
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen settings' }));
    expect(screen.getByTestId('configuration')).toBeInTheDocument();
    h.site = 'site-2';
    view.rerender(<KdsBoard />);
    expect(screen.queryByTestId('configuration')).not.toBeInTheDocument();
  });
  it('renders cancelled and invalid tickets without preparation actions; warns about a truncated queue', () => {
    h.items = [
      card({ id: 'cancelled', status: 'cancelled' }),
      card({ id: 'poison', integrity: 'invalid', items: [] }),
    ];
    h.more = true;
    render(<KdsBoard />);
    const cards = screen.getAllByTestId('kds-order-card');
    for (const ticket of cards)
      expect(within(ticket).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('cannot be verified');
    expect(screen.getByRole('status')).toHaveTextContent('not the complete queue');
  });
  it('shows current split destinations while preserving original ticket number', () => {
    const original = card();
    original.items[0] = {
      ...original.items[0]!,
      currentSaleId: 'sale-2',
      currentSaleNumber: 'VTA-002',
      currentTableLabel: 'Mesa 8',
    };
    original.multipleDestinations = true;
    h.items = [original];
    render(<KdsBoard />);
    expect(screen.getByText('VTA-001')).toBeInTheDocument();
    expect(screen.getByText('Mesa 8 · Check VTA-002')).toBeInTheDocument();
  });
});

it('honors configured station order instead of oldest ticket order, including main', () => {
  h.stations = [
    {
      id: 'hot',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      code: 'hot',
      name: 'Hot',
      isActive: true,
      position: 0,
      version: 1,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'main',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      code: 'main',
      name: 'main',
      isActive: true,
      position: 10,
      version: 1,
      createdAt: '',
      updatedAt: '',
    },
  ];
  h.items = [
    card({ id: 'old', station: 'main' }),
    card({ id: 'new', station: 'hot', stationName: 'Hot' }),
  ];
  render(<KdsBoard />);
  expect(
    screen
      .getAllByTestId('kds-station-column')
      .map(column => within(column).getByRole('heading').textContent)
  ).toEqual(['Hot · 1 order', 'Kitchen · 1 order']);
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
    'All stations',
    'Hot',
    'Kitchen',
  ]);
});
it('translates known course keys in Spanish', async () => {
  await i18n.changeLanguage('es');
  h.items = [card()];
  render(<KdsBoard />);
  expect(screen.getByText('Tiempo: Entrada')).toBeInTheDocument();
});

it('labels the active site and refreshes both queue and station configuration', () => {
  render(<KdsBoard />);
  expect(screen.getByRole('heading', { name: 'Kitchen · Central' })).toBeInTheDocument();
  expect(h.stationQuery).toHaveBeenLastCalledWith(
    { siteId: 'site-1' },
    { refetchInterval: 30_000 }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(h.refetch).toHaveBeenCalledOnce();
  expect(h.stationRefetch).toHaveBeenCalledOnce();
});
