import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';

interface QueueItem {
  id: string;
  action: 'sale_discount' | 'sale_void';
  reason: string;
  summary: { label: string; amount?: number; currencyCode?: string };
  requesterName: string;
  siteName: string;
  expiresAt: string;
}

const {
  decisionMutation,
  invalidateMock,
  queryResult,
  refetchMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  decisionMutation: { mutate: vi.fn(), isPending: false },
  invalidateMock: vi.fn(),
  refetchMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  queryResult: {
    data: null as null | {
      approver: { id: string; hasPin: boolean };
      items: QueueItem[];
    },
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      managerApprovals: { queue: { invalidate: invalidateMock } },
    }),
    managerApprovals: {
      queue: {
        useQuery: () => ({ ...queryResult, refetch: refetchMock }),
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => decisionMutation,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}));

import { ManagerApprovalQueue } from './ManagerApprovalQueue';

const pendingRequest: QueueItem = {
  id: 'approval-1',
  action: 'sale_discount',
  reason: 'Customer has a documented price match',
  summary: { label: 'Sale VTA-1042', amount: 125, currencyCode: 'USD' },
  requesterName: 'Casey Cashier',
  siteName: 'Central',
  expiresAt: '2026-07-15T01:15:00.000Z',
};

describe('ManagerApprovalQueue', () => {
  beforeEach(() => {
    decisionMutation.mutate.mockReset();
    decisionMutation.isPending = false;
    invalidateMock.mockReset();
    refetchMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    queryResult.data = {
      approver: { id: 'manager-1', hasPin: true },
      items: [pendingRequest],
    };
    queryResult.isLoading = false;
    queryResult.error = null;
  });

  it('requires a six-digit fresh PIN before approving a queued request', async () => {
    const user = userEvent.setup();
    render(<ManagerApprovalQueue />);

    expect(screen.getByText('Sale discount')).toBeInTheDocument();
    expect(screen.getByText('Requested by Casey Cashier · Central')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    const confirm = screen.getByRole('button', { name: 'Confirm approval' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Your staff PIN'), '123456');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(decisionMutation.mutate).toHaveBeenCalledWith({
      requestId: 'approval-1',
      approverId: 'manager-1',
      pin: '123456',
      decision: 'approved',
    });
  });

  it('requires and trims a rejection reason', async () => {
    const user = userEvent.setup();
    render(<ManagerApprovalQueue />);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText('Your staff PIN'), '654321');
    const confirm = screen.getByRole('button', { name: 'Confirm rejection' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Rejection reason'), '  Verify the receipt first  ');
    await user.click(confirm);

    expect(decisionMutation.mutate).toHaveBeenCalledWith({
      requestId: 'approval-1',
      approverId: 'manager-1',
      pin: '654321',
      decision: 'rejected',
      reason: 'Verify the receipt first',
    });
  });

  it('keeps decisions disabled until the signed-in manager configures a PIN', () => {
    queryResult.data = {
      approver: { id: 'manager-1', hasPin: false },
      items: [pendingRequest],
    };
    render(<ManagerApprovalQueue />);

    expect(
      screen.getByText('Configure your staff PIN in Users before deciding requests.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  it('drops the PIN form and unlocks the queue when polling removes the active request', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ManagerApprovalQueue />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.type(screen.getByLabelText('Your staff PIN'), '123456');

    queryResult.data = {
      approver: { id: 'manager-1', hasPin: true },
      items: [{ ...pendingRequest, id: 'approval-2', summary: { label: 'Sale VTA-1043' } }],
    };
    rerender(<ManagerApprovalQueue />);

    expect(screen.queryByLabelText('Your staff PIN')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('renders empty and retry states without exposing raw server errors', async () => {
    const user = userEvent.setup();
    queryResult.data = { approver: { id: 'manager-1', hasPin: true }, items: [] };
    const { rerender } = render(<ManagerApprovalQueue />);
    expect(screen.getByText('No pending requests.')).toBeInTheDocument();

    queryResult.data = null;
    queryResult.error = new Error('sensitive backend detail');
    rerender(<ManagerApprovalQueue />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to update approvals');
    expect(screen.queryByText('sensitive backend detail')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchMock).toHaveBeenCalledOnce();
  });
});
