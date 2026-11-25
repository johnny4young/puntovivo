import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { formatCurrency } from '@/lib/utils';
import { render, screen } from '@/test/utils';
import type { PendingCashHandoff, RegisterAssignment } from '@/types';
import { ReceiveHandoffSheet } from './ReceiveHandoffSheet';

const state = vi.hoisted(() => ({
  hasPin: true,
  mutate: vi.fn(),
  options: null as null | {
    onSuccess?: (result: unknown) => Promise<void>;
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u-camila', name: 'Camila Pérez', role: 'cashier' } }),
}));
vi.mock('@/features/locale/LocaleProvider', () => ({
  useResolvedLocale: () => ({ currency: 'COP', isFallback: false }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/invalidateGroups', () => ({
  CASH_SESSION_OPEN_INVALIDATIONS: [],
  invalidateGroups: vi.fn(async () => {}),
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
      mySigner: { useQuery: () => ({ data: { hasPin: state.hasPin }, isLoading: false }) },
    },
  },
}));

const handoff = {
  id: 'h1',
  registerName: 'Caja 2',
  fromCashierName: 'Andrés Rojas',
  outgoingCount: 600700,
  outgoingDenominations: [
    { value: 100000, count: 6 },
    { value: 500, count: 1 },
    { value: 200, count: 1 },
  ],
  note: 'Viene a las 3 por P2',
  handedOverAt: '2026-11-21T19:04:00Z',
  drafts: [
    { id: 'd1', saleNumber: 'V-1', label: 'P2 Cliente espera', total: 86400, suspendedAt: null },
  ],
} as unknown as PendingCashHandoff;

const assignment = {
  registerName: 'Caja 2',
  openingFloat: 200000,
  denominations: [{ value: 50000, count: 4 }],
} as RegisterAssignment;

describe('ReceiveHandoffSheet', () => {
  beforeEach(async () => {
    state.hasPin = true;
    state.mutate.mockReset();
    await i18next.changeLanguage('en');
  });

  it('recounts the kept drawer against the outgoing count and signs with the PIN', async () => {
    const onReceived = vi.fn();
    render(
      <ReceiveHandoffSheet
        handoff={handoff}
        assignment={assignment}
        onClose={vi.fn()}
        onReceived={onReceived}
      />
    );

    expect(await screen.findByTestId('handoff-received-note')).toHaveTextContent(
      'Note from Andrés'
    );
    // Only the rows the outgoing cashier counted until asked for the rest.
    expect(screen.queryByTestId('handoff-recount-1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('handoff-recount-0-count'), { target: { value: '6' } });
    fireEvent.change(screen.getByTestId('handoff-recount-7-count'), { target: { value: '1' } });
    expect(screen.getByTestId('handoff-recount-verdict')).toHaveTextContent(
      `Short${formatCurrency(200)}`
    );
    fireEvent.change(screen.getByTestId('handoff-recount-8-count'), { target: { value: '1' } });
    expect(screen.getByTestId('handoff-recount-verdict')).toHaveTextContent('Matches');
    await userEvent.click(screen.getByTestId('handoff-recount-show-all'));
    expect(screen.getByTestId('handoff-recount-1')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('handoff-resume-toggle'));
    await userEvent.click(screen.getByTestId('handoff-request-change'));
    expect(screen.getByTestId('handoff-receive')).toBeDisabled();
    await userEvent.type(screen.getByTestId('handoff-pin'), '482915');
    await userEvent.click(screen.getByTestId('handoff-receive'));

    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffId: 'h1',
        mode: 'counted_drawer',
        count: 600700,
        pin: '482915',
      })
    );
    await act(async () => {
      await state.options?.onSuccess?.({
        session: { registerName: 'Caja 2' },
        handoff: { reassignedDraftCount: 1 },
      });
    });
    expect(onReceived).toHaveBeenCalledWith({
      resumeDraft: expect.objectContaining({ id: 'd1' }),
      requestChange: true,
    });
  });

  it('starts a new drawer from the register float without a comparison', async () => {
    state.hasPin = false;
    render(
      <ReceiveHandoffSheet
        handoff={handoff}
        assignment={assignment}
        onClose={vi.fn()}
        onReceived={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByTestId('handoff-mode-new_drawer'));
    expect(screen.getByTestId('handoff-mode-new_drawer')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('handoff-recount-verdict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('handoff-received-low-change')).not.toBeInTheDocument();
    expect(screen.getByTestId('handoff-recount-result')).toHaveTextContent(formatCurrency(200000));
    expect(screen.queryByTestId('handoff-pin')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('handoff-receive'));
    expect(state.mutate).toHaveBeenCalledWith({
      handoffId: 'h1',
      mode: 'new_drawer',
      count: 200000,
      denominations: [{ value: 50000, count: 4 }],
    });
  });
});
