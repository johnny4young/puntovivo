import { render, screen } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingHandoff } from './shiftHandoffModel';

const { receiveMutate, changeMutate, mutationOptions } = vi.hoisted(() => ({
  receiveMutate: vi.fn(),
  changeMutate: vi.fn(),
  mutationOptions: { current: null as null | { onSuccess?: (result: unknown) => Promise<void> } },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u-2', name: 'Camila', role: 'cashier' } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (_path: string, options: typeof mutationOptions.current) => {
    mutationOptions.current = options;
    return { mutate: receiveMutate, isPending: false };
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
      registerIncidents: {
        report: {
          useMutation: () => ({ mutate: changeMutate, isPending: false, isSuccess: false }),
        },
      },
    },
  };
});

import { ReceiveShiftDialog } from './ReceiveShiftDialog';

const handoff: PendingHandoff = {
  id: 'h-1',
  registerName: 'Caja 2',
  fromUserId: 'u-1',
  fromUserName: 'Andrés',
  createdAt: '2026-11-11T19:04:00.000Z',
  note: 'P2 pays at 3',
  countedTotal: 100500,
  countedDenominations: [
    { value: 50000, count: 2 },
    { value: 500, count: 1 },
  ],
  notices: [{ kind: 'low_change', values: [50, 100], count: 0, since: null }],
  drafts: [
    {
      id: 'd-1',
      label: 'P2 Cliente espera',
      total: 86400,
      suspendedAt: '2026-11-11T18:12:00.000Z',
    },
  ],
};

function renderDialog(overrides: Partial<Parameters<typeof ReceiveShiftDialog>[0]> = {}) {
  const props = {
    handoff,
    pinRequired: true,
    isOpen: true,
    onClose: vi.fn(),
    onOpenWithout: vi.fn(),
    onReceived: vi.fn(),
    ...overrides,
  };
  render(<ReceiveShiftDialog {...props} />);
  return props;
}

beforeEach(() => {
  receiveMutate.mockReset();
  changeMutate.mockReset();
});

describe('ReceiveShiftDialog', () => {
  it('compares the recount with the outgoing count and shows the note', async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByTestId('receive-mode-counted_drawer')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByTestId('receive-their-count')).toHaveTextContent('$100,500.00');
    expect(screen.getByTestId('receive-note')).toHaveTextContent('P2 pays at 3');

    await user.click(screen.getByTestId('denomination-plus-50000'));
    expect(screen.getByTestId('receive-match')).toHaveAttribute('data-state', 'difference');
    await user.click(screen.getByTestId('denomination-plus-50000'));
    await user.click(screen.getByTestId('denomination-plus-500'));
    expect(screen.getByTestId('receive-match')).toHaveAttribute('data-state', 'match');
    expect(screen.getByTestId('receive-match')).toHaveTextContent('Matches');
  });

  it('needs the PIN, sends the recount and resumes the chosen draft', async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.click(screen.getByTestId('denomination-plus-500'));
    expect(screen.getByTestId('receive-submit')).toBeDisabled();
    await user.type(screen.getByTestId('receive-pin'), '12a3456');
    expect(screen.getByTestId('receive-pin')).toHaveValue('123456');

    await user.click(screen.getByTestId('receive-resume-d-1'));
    expect(screen.getByTestId('receive-resume-d-1')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('receive-submit'));
    expect(receiveMutate).toHaveBeenCalledWith({
      handoffId: 'h-1',
      mode: 'counted_drawer',
      denominations: [{ value: 500, count: 1 }],
      pin: '123456',
    });

    await mutationOptions.current?.onSuccess?.({
      matches: false,
      recountDifference: -100000,
      reassignedSaleIds: ['d-1'],
    });
    expect(props.onReceived).toHaveBeenCalledWith({
      id: 'd-1',
      label: 'P2 Cliente espera',
      suspendedAt: '2026-11-11T18:12:00.000Z',
    });
  });

  it('opens a new float without a PIN when the cashier has none', async () => {
    const user = userEvent.setup();
    renderDialog({ pinRequired: false });
    await user.click(screen.getByTestId('receive-mode-new_float'));
    expect(screen.queryByTestId('receive-their-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receive-pin')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('denomination-plus-20000'));
    await user.click(screen.getByTestId('receive-submit'));
    expect(receiveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'new_float', pin: null })
    );
  });

  it('asks for change and lets the cashier open without receiving', async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.click(screen.getByTestId('receive-request-change'));
    expect(changeMutate).toHaveBeenCalledWith({
      kind: 'change_request',
      note: expect.stringContaining('Caja 2 needs change'),
    });
    await user.click(screen.getByTestId('receive-open-without'));
    expect(props.onOpenWithout).toHaveBeenCalled();
  });
});
