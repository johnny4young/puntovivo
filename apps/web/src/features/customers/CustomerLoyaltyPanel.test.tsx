/**
 * the loyalty ledger inside the customer drawer.
 *
 * Two contracts matter here. First, visibility: the panel must stay silent
 * for the tenants that never enabled the program (nobody has points, so a
 * cashier never sees a dead section) while an admin always gets it — they
 * are the one who grants the first points. Second, the adjustment guard:
 * the sign carries the intent and the note is mandatory, so neither can be
 * skipped by the UI before the server ever sees the call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { CustomerLoyaltyPanel } from './CustomerLoyaltyPanel';

const adjustMock = vi.fn();
let mockRole = 'admin';
let mockData: {
  points: number;
  movements: Array<{
    id: string;
    kind: string;
    points: number;
    note: string | null;
    createdAt: string;
  }>;
} = { points: 0, movements: [] };

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u-1', role: mockRole } }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ loyalty: { forCustomer: { invalidate: vi.fn() } } }),
    loyalty: {
      forCustomer: {
        useQuery: () => ({ data: mockData, isLoading: false, error: null }),
      },
      adjust: {
        useMutation: () => ({ mutateAsync: adjustMock, isPending: false }),
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

describe('CustomerLoyaltyPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
    vi.clearAllMocks();
    mockRole = 'admin';
    mockData = {
      points: 119,
      movements: [
        {
          id: 'm-1',
          kind: 'earn',
          points: 119,
          note: null,
          createdAt: '2026-07-16T20:00:00.000Z',
        },
      ],
    };
  });

  it('shows the balance and the movements behind it', () => {
    render(<CustomerLoyaltyPanel customerId="c-1" />);
    expect(screen.getByTestId('customer-loyalty-balance')).toHaveTextContent('119 puntos');
    expect(screen.getByTestId('customer-loyalty-movements')).toHaveTextContent(
      'Ganados en una venta'
    );
    expect(screen.getByTestId('customer-loyalty-movements')).toHaveTextContent('+119');
  });

  it('keeps the sign on a returned movement', () => {
    mockData = {
      points: 0,
      movements: [
        {
          id: 'm-2',
          kind: 'revert',
          points: -119,
          note: null,
          createdAt: '2026-07-16T21:00:00.000Z',
        },
      ],
    };
    render(<CustomerLoyaltyPanel customerId="c-1" />);
    expect(screen.getByTestId('customer-loyalty-movements')).toHaveTextContent('-119');
    expect(screen.getByTestId('customer-loyalty-movements')).toHaveTextContent(
      'Devueltos por un reembolso'
    );
  });

  it('stays silent for a non-admin when the customer has no points', () => {
    mockRole = 'cashier';
    mockData = { points: 0, movements: [] };
    render(<CustomerLoyaltyPanel customerId="c-1" />);
    // A tenant without the program must not see a dead section.
    expect(screen.queryByTestId('customer-loyalty-panel')).not.toBeInTheDocument();
  });

  it('still shows a non-admin the balance they can quote to the customer', () => {
    mockRole = 'cashier';
    render(<CustomerLoyaltyPanel customerId="c-1" />);
    expect(screen.getByTestId('customer-loyalty-balance')).toHaveTextContent('119 puntos');
    // But correcting a balance is not theirs to do.
    expect(screen.queryByTestId('customer-loyalty-adjust-submit')).not.toBeInTheDocument();
  });

  it('mounts for an admin on a fresh program so the first points can be granted', () => {
    mockData = { points: 0, movements: [] };
    render(<CustomerLoyaltyPanel customerId="c-1" />);
    expect(screen.getByTestId('customer-loyalty-panel')).toBeInTheDocument();
    expect(screen.getByTestId('customer-loyalty-adjust-submit')).toBeInTheDocument();
  });

  it('refuses an adjustment without a reason', async () => {
    const user = userEvent.setup();
    render(<CustomerLoyaltyPanel customerId="c-1" />);

    await user.type(screen.getByLabelText('Puntos a sumar o restar'), '50');
    expect(screen.getByTestId('customer-loyalty-adjust-submit')).toBeDisabled();

    await user.type(screen.getByLabelText('Motivo del ajuste'), 'Promo de apertura');
    await user.click(screen.getByTestId('customer-loyalty-adjust-submit'));

    await waitFor(() =>
      expect(adjustMock).toHaveBeenCalledWith({
        customerId: 'c-1',
        points: 50,
        note: 'Promo de apertura',
      })
    );
  });

  it('refuses a zero adjustment (the sign is the intent)', async () => {
    const user = userEvent.setup();
    render(<CustomerLoyaltyPanel customerId="c-1" />);

    await user.type(screen.getByLabelText('Puntos a sumar o restar'), '0');
    await user.type(screen.getByLabelText('Motivo del ajuste'), 'Sin efecto');

    expect(screen.getByTestId('customer-loyalty-adjust-submit')).toBeDisabled();
    expect(adjustMock).not.toHaveBeenCalled();
  });

  it('passes a negative adjustment through as a claw back', async () => {
    const user = userEvent.setup();
    render(<CustomerLoyaltyPanel customerId="c-1" />);

    await user.type(screen.getByLabelText('Puntos a sumar o restar'), '-19');
    await user.type(screen.getByLabelText('Motivo del ajuste'), 'Venta mal atribuida');
    await user.click(screen.getByTestId('customer-loyalty-adjust-submit'));

    await waitFor(() =>
      expect(adjustMock).toHaveBeenCalledWith({
        customerId: 'c-1',
        points: -19,
        note: 'Venta mal atribuida',
      })
    );
  });

  it('discards an unsaved adjustment draft when the selected customer changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CustomerLoyaltyPanel key="c-1" customerId="c-1" />);

    await user.type(screen.getByLabelText('Puntos a sumar o restar'), '25');
    await user.type(screen.getByLabelText('Motivo del ajuste'), 'Compensación pendiente');

    rerender(<CustomerLoyaltyPanel key="c-2" customerId="c-2" />);

    expect(screen.getByLabelText('Puntos a sumar o restar')).toHaveValue(null);
    expect(screen.getByLabelText('Motivo del ajuste')).toHaveValue('');
    expect(screen.getByTestId('customer-loyalty-adjust-submit')).toBeDisabled();
  });
});
