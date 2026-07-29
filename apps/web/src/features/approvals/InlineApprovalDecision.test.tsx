import userEvent from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { InlineApprovalDecision } from './InlineApprovalDecision';

const invalidateMine = vi.hoisted(() => vi.fn());
const invalidateApprovers = vi.hoisted(() => vi.fn());
const refetchApprovers = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
let mutationOptions:
  | {
      onSuccess?: () => Promise<void> | void;
      onError?: (error: unknown) => void;
    }
  | undefined;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      managerApprovals: {
        mine: { invalidate: invalidateMine },
        availableApprovers: { invalidate: invalidateApprovers },
      },
    }),
    managerApprovals: {
      availableApprovers: {
        useQuery: () => ({
          data: [
            { id: 'manager-1', name: 'Marta Manager', role: 'manager', hasPin: true },
            { id: 'admin-1', name: 'Ada Admin', role: 'admin', hasPin: false },
          ],
          isLoading: false,
          error: null,
          refetch: refetchApprovers,
        }),
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (
    _path: string,
    options?: {
      onSuccess?: () => Promise<void> | void;
      onError?: (error: unknown) => void;
    }
  ) => {
    mutationOptions = options;
    return { mutate, isPending: false };
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

describe('InlineApprovalDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationOptions = undefined;
  });

  it('submits only a configured manager with a fresh six-digit PIN', async () => {
    const user = userEvent.setup();
    render(
      <InlineApprovalDecision
        action="sale_discount"
        requestId="approval-1"
        onDecided={vi.fn()}
      />
    );

    expect(screen.getByRole('option', { name: 'Marta Manager' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Ada Admin' })).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Approve checkout' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Their staff PIN'), '97a5310');
    expect(screen.getByLabelText('Their staff PIN')).toHaveValue('975310');
    await user.click(submit);

    expect(mutate).toHaveBeenCalledWith({
      requestId: 'approval-1',
      approverId: 'manager-1',
      pin: '975310',
      decision: 'approved',
    });
  });

  it('refreshes request and eligible approvers after a successful decision', async () => {
    const onDecided = vi.fn();
    render(
      <InlineApprovalDecision
        action="sale_discount"
        requestId="approval-1"
        onDecided={onDecided}
      />
    );

    await act(async () => {
      await mutationOptions?.onSuccess?.();
    });

    expect(invalidateMine).toHaveBeenCalledOnce();
    expect(invalidateApprovers).toHaveBeenCalledWith({
      action: 'sale_discount',
      requestId: 'approval-1',
    });
    expect(onDecided).toHaveBeenCalledOnce();
    expect(toastSuccess).toHaveBeenCalledWith({ title: 'Checkout approved' });
  });
});
