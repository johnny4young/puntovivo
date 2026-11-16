import { render, screen, within } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashSession } from '@/types';

const { handOutMutate, previewData, mutationOptions } = vi.hoisted(() => ({
  handOutMutate: vi.fn(),
  previewData: { current: null as unknown },
  mutationOptions: { current: null as null | { onSuccess?: (result: unknown) => Promise<void> } },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u-1', name: 'Andrés Rojas', role: 'cashier' } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (_path: string, options: typeof mutationOptions.current) => {
    mutationOptions.current = options;
    return { mutate: handOutMutate, isPending: false };
  },
}));

vi.mock('@/lib/trpc', () => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const node: object = new Proxy(
    {},
    { get: (_t, key) => (key === 'invalidate' ? invalidate : node) }
  );
  return {
    trpc: {
      useUtils: () => node,
      shiftHandoffs: {
        handOutPreview: {
          useQuery: () => ({ data: previewData.current, isLoading: false }),
        },
      },
    },
  };
});

import { HandOutShiftDialog } from './HandOutShiftDialog';

const session = {
  id: 'cs-1',
  registerName: 'Caja 2',
  openedAt: '2026-11-11T11:58:00.000Z',
} as CashSession;

beforeEach(() => {
  handOutMutate.mockReset();
  previewData.current = {
    sessionId: 'cs-1',
    registerName: 'Caja 2',
    openedAt: '2026-11-11T11:58:00.000Z',
    generatedAt: '2026-11-11T19:04:00.000Z',
    salesTotal: 2071400,
    salesCount: 41,
    salesCurve: [{ at: '2026-11-11T15:00:00.000Z', total: 2071400 }],
    countedTotal: 100000,
    drafts: [
      {
        id: 'd-1',
        label: 'P2 Cliente espera',
        total: 86400,
        suspendedAt: '2026-11-11T18:12:00.000Z',
      },
    ],
    approvals: [
      { id: 'a-1', label: 'Devolución', amount: 48500, requestedAt: '2026-11-11T16:01:00.000Z' },
    ],
    notices: [
      { kind: 'low_change', values: [50, 100], count: 0, since: null },
      { kind: 'printer', values: [], count: 2, since: '2026-11-11T18:40:00.000Z' },
    ],
  };
});

describe('HandOutShiftDialog', () => {
  it('counts blind, shows what passes on, and signs with the note', async () => {
    const user = userEvent.setup();
    const onHandedOut = vi.fn();
    render(
      <HandOutShiftDialog
        cashSession={session}
        isOpen
        onClose={vi.fn()}
        onHandedOut={onHandedOut}
      />
    );

    await user.click(screen.getByTestId('denomination-plus-50000'));
    await user.click(screen.getByTestId('denomination-plus-50000'));
    expect(screen.getByTestId('hand-out-total')).toHaveTextContent('$100,000.00');

    await user.click(screen.getByTestId('hand-out-continue'));
    expect(screen.getByTestId('hand-out-shift-total')).toHaveTextContent('$2,071,400.00');
    expect(within(screen.getByTestId('hand-out-chips')).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByTestId('hand-out-drafts')).toHaveTextContent('1 suspended sale');
    expect(screen.getByTestId('hand-out-drafts')).toHaveTextContent('passes on');
    expect(screen.getByTestId('hand-out-approval')).toHaveTextContent('stays open');
    expect(screen.getByTestId('hand-out-low-change')).toHaveTextContent('Low on change');
    expect(screen.getByTestId('hand-out-printer')).toHaveTextContent('2 prints did not come out');

    await user.type(screen.getByTestId('hand-out-note'), 'P2 pays at 3');
    await user.click(screen.getByTestId('hand-out-review'));
    expect(screen.getByTestId('hand-out-step-sign')).toHaveTextContent('Signed by Andrés Rojas');

    await user.click(screen.getByTestId('hand-out-sign'));
    expect(handOutMutate).toHaveBeenCalledWith({
      actualCount: 100000,
      denominations: expect.arrayContaining([{ value: 50000, count: 2 }]),
      note: 'P2 pays at 3',
    });

    await mutationOptions.current?.onSuccess?.({ registerName: 'Caja 2', countedTotal: 100000 });
    expect(onHandedOut).toHaveBeenCalled();
  });

  it('goes back a step without losing the count', async () => {
    const user = userEvent.setup();
    render(
      <HandOutShiftDialog cashSession={session} isOpen onClose={vi.fn()} onHandedOut={vi.fn()} />
    );
    await user.click(screen.getByTestId('denomination-plus-500'));
    await user.click(screen.getByTestId('hand-out-continue'));
    await user.click(screen.getByTestId('hand-out-back'));
    expect(screen.getByTestId('denomination-count-500')).toHaveValue('1');
  });
});
