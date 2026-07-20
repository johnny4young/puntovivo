/**
 * DeliveryPage component tests.
 *
 * Pins the V5 surface contract: status nav with counts, status
 * filter, master-detail interaction, advance + cancel mutation
 * shapes (`deliveryOrders.advance({ id, toStatus, courierName? })`),
 * terminal-status disabling, and i18n parity on locale flip.
 *
 * trpc + useTenant + useToast are mocked so we never hit the
 * network or pull in the full app shell. Pattern mirrors
 * `SalePaymentModal.credit.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { render, screen, within } from '@/test/utils';
import { DeliveryPage } from './DeliveryPage';

type DeliveryStatus = 'accepted' | 'preparing' | 'dispatched' | 'delivered' | 'cancelled';

interface MockRow {
  id: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  address: string;
  addressNotes?: string | null;
  courierName?: string | null;
  status: DeliveryStatus;
  totalAmount: number;
  itemsSnapshot?: string | null;
  acceptedAt: string;
  preparingAt?: string | null;
  dispatchedAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
}

let mockRowsByStatus: Record<DeliveryStatus, MockRow[]> = {
  accepted: [],
  preparing: [],
  dispatched: [],
  delivered: [],
  cancelled: [],
};
let mockSiteId: string | null = 'site-1';
const advanceMutate = vi.fn(async (_input: unknown) => ({ id: 'order-1', status: 'preparing' }));
const invalidateSpy = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    deliveryOrders: {
      list: {
        useQuery: (
          input: { siteId: string; status?: DeliveryStatus },
          options?: { enabled?: boolean }
        ) => {
          if (options?.enabled === false) {
            return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
          }
          const rows = input.status ? mockRowsByStatus[input.status] : [];
          return {
            data: rows,
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          };
        },
      },
      advance: {
        // The real `useMutation` forwards `onSuccess` so the component
        // can invalidate caches after a write. The mock replicates that
        // contract by calling `onSuccess` after `mutateAsync` resolves
        // so the invalidation assertion exercises the production wiring.
        useMutation: (opts?: { onSuccess?: () => unknown | Promise<unknown> }) => ({
          mutateAsync: async (input: unknown) => {
            const result = await advanceMutate(input);
            await opts?.onSuccess?.();
            return result;
          },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      deliveryOrders: {
        list: { invalidate: invalidateSpy },
      },
    }),
  },
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentTenant: { id: 'tenant-1', name: 'Tenant 1' },
    currentSite: mockSiteId ? { id: mockSiteId, name: 'Site 1' } : null,
    tenantSettings: { currency: 'USD' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

function makeRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 'order-1',
    customerName: 'Cliente Domicilio',
    customerPhone: '300-1234567',
    address: 'Calle 123 #45-67',
    addressNotes: 'Casa azul, segundo piso',
    courierName: null,
    status: 'accepted',
    totalAmount: 50_000,
    itemsSnapshot: JSON.stringify([{ name: 'Pizza Hawaiana', qty: 2, unitPrice: 25_000 }]),
    acceptedAt: '2026-05-18T17:00:00Z',
    ...overrides,
  };
}

describe('DeliveryPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    mockRowsByStatus = {
      accepted: [],
      preparing: [],
      dispatched: [],
      delivered: [],
      cancelled: [],
    };
    mockSiteId = 'site-1';
  });

  it('renders the no-site fallback when there is no active site', () => {
    mockSiteId = null;
    render(<DeliveryPage />);
    expect(screen.getByText(/Select an active site/i)).toBeInTheDocument();
  });

  it('renders the empty state when no orders exist in the active column', () => {
    render(<DeliveryPage />);
    expect(screen.getByTestId('delivery-cards-empty')).toBeInTheDocument();
  });

  it('shows per-status counts in the status nav', () => {
    mockRowsByStatus.accepted = [makeRow({ id: 'a-1' }), makeRow({ id: 'a-2' })];
    mockRowsByStatus.preparing = [makeRow({ id: 'p-1', status: 'preparing' })];
    mockRowsByStatus.dispatched = [];
    render(<DeliveryPage />);
    expect(screen.getByTestId('delivery-status-accepted-count')).toHaveTextContent('2');
    expect(screen.getByTestId('delivery-status-preparing-count')).toHaveTextContent('1');
    expect(screen.getByTestId('delivery-status-dispatched-count')).toHaveTextContent('0');
  });

  it('filters cards by status when a column is clicked', async () => {
    const user = userEvent.setup();
    mockRowsByStatus.accepted = [makeRow({ id: 'a-1', customerName: 'Accepted Cliente' })];
    mockRowsByStatus.preparing = [
      makeRow({ id: 'p-1', status: 'preparing', customerName: 'Preparing Cliente' }),
    ];
    render(<DeliveryPage />);
    expect(screen.getByText('Accepted Cliente')).toBeInTheDocument();
    expect(screen.queryByText('Preparing Cliente')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('delivery-status-preparing'));
    expect(screen.queryByText('Accepted Cliente')).not.toBeInTheDocument();
    expect(screen.getByText('Preparing Cliente')).toBeInTheDocument();
  });

  it('surfaces the detail panel after clicking the Detalle CTA on a card', async () => {
    const user = userEvent.setup();
    mockRowsByStatus.accepted = [makeRow({ id: 'order-detail', customerName: 'Detail Cliente' })];
    render(<DeliveryPage />);
    // Before selection, the detail panel shows the empty placeholder.
    expect(screen.queryByTestId('delivery-detail-card')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('delivery-card-order-detail-cta'));
    const detail = await screen.findByTestId('delivery-detail-card');
    expect(within(detail).getByText('Detail Cliente')).toBeInTheDocument();
    // Timeline + advance CTA are wired.
    expect(screen.getByTestId('delivery-timeline-accepted')).toBeInTheDocument();
    expect(screen.getByTestId('delivery-detail-advance')).toBeInTheDocument();
  });

  it('advance button fires deliveryOrders.advance with the next status', async () => {
    const user = userEvent.setup();
    mockRowsByStatus.accepted = [makeRow({ id: 'order-adv', status: 'accepted' })];
    render(<DeliveryPage />);
    await user.click(screen.getByTestId('delivery-card-order-adv-cta'));
    await user.type(screen.getByTestId('delivery-detail-courier'), 'Mensajero 7');
    await user.click(screen.getByTestId('delivery-detail-advance'));
    expect(advanceMutate).toHaveBeenCalledTimes(1);
    expect(advanceMutate).toHaveBeenCalledWith({
      id: 'order-adv',
      toStatus: 'preparing',
      courierName: 'Mensajero 7',
    });
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('cancel flow fires advance with toStatus=cancelled after the confirm step', async () => {
    const user = userEvent.setup();
    mockRowsByStatus.accepted = [makeRow({ id: 'order-cancel', status: 'accepted' })];
    render(<DeliveryPage />);
    await user.click(screen.getByTestId('delivery-card-order-cancel-cta'));
    await user.click(screen.getByTestId('delivery-detail-cancel'));
    await user.click(screen.getByTestId('delivery-detail-cancel-confirm-button'));
    expect(advanceMutate).toHaveBeenCalledWith({
      id: 'order-cancel',
      toStatus: 'cancelled',
      courierName: undefined,
    });
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('disables the advance button when the order status is terminal (delivered)', async () => {
    const user = userEvent.setup();
    mockRowsByStatus.delivered = [
      makeRow({
        id: 'order-done',
        status: 'delivered',
        deliveredAt: '2026-05-18T18:00:00Z',
      }),
    ];
    render(<DeliveryPage />);
    await user.click(screen.getByTestId('delivery-status-delivered'));
    await user.click(screen.getByTestId('delivery-card-order-done-cta'));
    expect(screen.getByTestId('delivery-detail-advance')).toBeDisabled();
    // Cancel does not surface on a terminal order.
    expect(screen.queryByTestId('delivery-detail-cancel')).not.toBeInTheDocument();
  });

  it('renders the Spanish copy when i18next is flipped to es', async () => {
    await i18next.changeLanguage('es');
    mockRowsByStatus.accepted = [makeRow({ id: 'es-1' })];
    render(<DeliveryPage />);
    expect(screen.getByText('Pedidos a domicilio')).toBeInTheDocument();
    expect(screen.getByTestId('delivery-status-accepted')).toHaveTextContent('Por aceptar');
  });
});
