import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { render, screen } from '@/test/utils';
import { formatCurrency } from '@/lib/utils';
import type { CashSession } from '@/types';
import { ShiftHandoffSheet } from './ShiftHandoffSheet';

const state = vi.hoisted(() => ({
  hasPin: false,
  role: 'cashier',
  mutate: vi.fn(),
  options: null as null | { onError?: (error: Error) => void },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u-andres', name: 'Andrés Rojas', role: state.role } }),
}));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ tenantSettings: { cashClose: { blindClose: true } } }),
}));
vi.mock('@/features/locale/LocaleProvider', () => ({
  useResolvedLocale: () => ({ currency: 'COP', isFallback: false }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (_path: string, options: typeof state.options) => {
    state.options = options;
    return { mutate: state.mutate, isPending: false };
  },
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({}),
    cashSessions: {
      myShiftSummary: {
        useQuery: () => ({
          data: {
            sessionId: 's1',
            openedAt: '2026-11-21T11:58:00Z',
            salesCount: 41,
            revenue: 2071400,
            slices: [1, 3, 5, 4, 6, 2, 0, 0, 0, 0, 0, 0],
          },
        }),
      },
      mySigner: { useQuery: () => ({ data: { hasPin: state.hasPin }, isLoading: false }) },
    },
    sales: {
      listDrafts: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 'd1',
                saleNumber: 'V-1',
                total: 86400,
                suspendedAt: '2026-11-21T18:12:00Z',
                suspendedBy: 'u-andres',
                suspendedLabel: 'P2 Cliente espera',
                createdBy: 'u-andres',
                tableId: null,
              },
              {
                id: 'd2',
                saleNumber: 'V-2',
                total: 1000,
                suspendedAt: '2026-11-21T18:12:00Z',
                suspendedBy: 'u-other',
                suspendedLabel: 'Other',
                createdBy: 'u-other',
                tableId: null,
              },
            ],
          },
        }),
      },
    },
    managerApprovals: {
      mine: {
        useQuery: () => ({
          data: [
            {
              action: 'sale_refund',
              status: 'pending',
              summary: { label: 'Aceite Girasol 1 L', amount: 48500 },
              requestedAt: '2026-11-21T16:01:00Z',
            },
            { action: 'sale_void', status: 'pending', summary: { label: 'x' }, requestedAt: '' },
          ],
        }),
      },
    },
  },
}));

const session = {
  id: 's1',
  siteId: 'site-1',
  registerName: 'Caja 2',
  openedAt: '2026-11-21T11:58:00Z',
} as CashSession;

describe('ShiftHandoffSheet', () => {
  beforeEach(async () => {
    state.hasPin = false;
    state.role = 'cashier';
    state.mutate.mockReset();
    await i18next.changeLanguage('en');
  });

  it('counts blind, lists what passes on and hands over without a PIN', async () => {
    render(<ShiftHandoffSheet cashSession={session} hasReceiptPrinter={false} onClose={vi.fn()} />);

    fireEvent.change(await screen.findByTestId('handoff-count-0-count'), {
      target: { value: '6' },
    });
    await userEvent.click(screen.getByRole('button', { name: `Add one ${formatCurrency(500)}` }));
    expect(screen.getByTestId('handoff-count-total')).toHaveTextContent(formatCurrency(600500));

    await userEvent.click(screen.getByTestId('handoff-forward'));
    expect(screen.getByTestId('handoff-shift-summary')).toHaveTextContent(formatCurrency(2071400));
    expect(screen.getByTestId('handoff-shift-summary')).toHaveTextContent('41 sales');
    expect(screen.getByTestId('handoff-blind-count')).toHaveTextContent(
      'The administrator sees the difference'
    );
    expect(screen.getByTestId('handoff-prepared-suspended')).toHaveTextContent(
      `1 suspended sale · ${formatCurrency(86400)}`
    );
    expect(screen.getByTestId('handoff-prepared-refunds')).toHaveTextContent(
      '1 return waiting for approval'
    );
    expect(screen.getByTestId('handoff-prepared-low-change')).toHaveTextContent(
      `1 × ${formatCurrency(500)}`
    );
    expect(screen.getByTestId('handoff-prepared-printer')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('handoff-note'), ' Viene a las 3 ');
    await userEvent.click(screen.getByTestId('handoff-forward'));

    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ actualCount: 600500, note: 'Viene a las 3' })
    );
    expect(state.mutate.mock.calls[0]![0]).not.toHaveProperty('pin');
  });

  it('asks for the PIN on the sign step and shows a rejected PIN', async () => {
    state.hasPin = true;
    state.role = 'manager';
    render(<ShiftHandoffSheet cashSession={session} hasReceiptPrinter onClose={vi.fn()} />);

    await userEvent.click(await screen.findByTestId('handoff-forward'));
    expect(screen.queryByText(/The administrator sees/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('handoff-forward'));
    expect(screen.getByTestId('handoff-sign')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-forward')).toBeDisabled();

    await userEvent.type(screen.getByTestId('handoff-pin'), '48a2915');
    await userEvent.click(screen.getByTestId('handoff-forward'));
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ pin: '482915' }));

    act(() => state.options?.onError?.(new Error('nope')));
    expect(screen.getByTestId('handoff-error')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-pin')).toHaveValue('');
  });
});
