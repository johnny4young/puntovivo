import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import TillReturnSheet from './TillReturnSheet';

type ApprovalRule = { required: boolean; reason: string | null; limitAmount: number | null };

const state = vi.hoisted(() => ({
  today: [] as unknown[],
  found: null as unknown,
  sale: null as unknown,
  approvalRule: { required: false, reason: null, limitAmount: null } as ApprovalRule,
  approvalStatus: 'not_requested',
  allApproved: false,
  // A fresh owner per test: a return waiting on a manager is remembered per cashier.
  tenantId: 'tenant-1',
}));
const returnSale = vi.hoisted(() => vi.fn());
const requestApproval = vi.hoisted(() => vi.fn());
const hydrateFromReturn = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sales: {
      returnableToday: { useQuery: () => ({ data: state.today }) },
      getById: { useQuery: () => ({ data: state.sale, error: null }) },
      previewReturn: {
        useQuery: (input: { items: Array<{ quantity: number }> }, opts: { enabled: boolean }) => {
          if (!opts.enabled) return { data: undefined, isFetching: false, error: null };
          const refundAmount = input.items.reduce((sum, item) => sum + item.quantity * 1000, 0);
          return {
            data: {
              refundAmount,
              cashAmount: refundAmount,
              allocations: [
                {
                  salePaymentId: 'pay-1',
                  originalMethod: 'cash',
                  destination: 'cash',
                  amount: refundAmount,
                },
              ],
              approval: state.approvalRule,
            },
            isFetching: false,
            error: null,
          };
        },
      },
    },
    useUtils: () => ({
      sales: { findByReceipt: { fetch: () => Promise.resolve(state.found) } },
    }),
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (
    _path: string,
    options: { onSuccess?: (result: unknown) => Promise<void> | void }
  ) => ({
    mutate: (input: unknown) => {
      returnSale(input);
      void options.onSuccess?.({ returns: [{ id: 'ret-1' }] });
    },
    isPending: false,
  }),
}));

vi.mock('@/features/sales/returns/returnInvalidations', () => ({
  invalidateAfterReturn: () => Promise.resolve(),
}));

vi.mock('@/features/approvals/useManagerApproval', () => ({
  useManagerApproval: () => ({
    views: [
      {
        action: 'sale_refund',
        requestId: state.approvalStatus === 'not_requested' ? null : 'req-1',
        status: state.approvalStatus,
        decisionReason: null,
        approvalsCollected: 0,
        requiredApprovals: 1,
      },
    ],
    approvalRequestId: state.allApproved ? 'req-1' : null,
    allApproved: state.allApproved,
    isLoading: false,
    error: null,
    isRequesting: false,
    requestApproval,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/features/approvals/InlineApprovalDecision', () => ({
  InlineApprovalDecision: () => <div data-testid="inline-approval-sale_refund" />,
}));

vi.mock('@/features/sales/useCartWorkspaceStore', () => ({
  useCartWorkspaceStore: { getState: () => ({ hydrateFromReturn }) },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'cashier' } }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentTenant: { id: state.tenantId } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({ useToast: () => toast }));

const receipt = {
  id: 'sale-1',
  saleNumber: 'VTA-N-000842',
  total: 23400,
  currencyCode: 'COP',
  completedAt: new Date().toISOString(),
  registerName: 'Caja 1',
  customerName: null,
};

function line(id: string, name: string, quantity: number, remaining = quantity) {
  return {
    id,
    productId: `p-${id}`,
    productNameSnapshot: name,
    quantity,
    remainingQuantity: remaining,
    returnableAmount: remaining * 1000,
    total: quantity * 1000,
    unitEquivalence: 1,
    lots: [],
    serials: [],
  };
}

function sale(items = [line('l-oil', 'Aceite 1 L', 1), line('l-rice', 'Arroz 500 g', 2)]) {
  return {
    id: 'sale-1',
    saleNumber: 'VTA-N-000842',
    currencyCode: 'COP',
    customerId: null,
    priceTier: 1,
    items,
  };
}

async function scan(user: ReturnType<typeof userEvent.setup>, code = 'VTA-N-000842') {
  await user.type(screen.getByTestId('till-return-code'), `${code}{Enter}`);
}

let testRun = 0;

describe('TillReturnSheet', () => {
  beforeEach(() => {
    testRun += 1;
    state.tenantId = `tenant-${testRun}`;
    state.today = [receipt];
    state.found = receipt;
    state.sale = sale();
    state.approvalRule = { required: false, reason: null, limitAmount: null };
    state.approvalStatus = 'not_requested';
    state.allApproved = false;
    returnSale.mockReset();
    requestApproval.mockReset();
    hydrateFromReturn.mockReset();
    toast.success.mockReset();
  });

  it('opens a scanned receipt with its lines and says it was read', async () => {
    const user = userEvent.setup();
    render(<TillReturnSheet onClose={vi.fn()} />);
    await scan(user);
    expect(await screen.findByTestId('till-return-form')).toBeInTheDocument();
    expect(screen.getByTestId('till-return-read')).toHaveTextContent('receipt read');
    expect(screen.getByTestId('till-return-receipt')).toHaveTextContent(
      /VTA-N-000842 · today .+ · Caja 1/
    );
    expect(screen.getByText('Aceite 1 L')).toBeInTheDocument();
    expect(screen.getByText('Arroz 500 g')).toBeInTheDocument();
  });

  it('says when a receipt is not found and keeps the lookup open', async () => {
    const user = userEvent.setup();
    state.found = null;
    render(<TillReturnSheet onClose={vi.fn()} />);
    await scan(user, 'V-999999');
    expect(await screen.findByRole('alert')).toHaveTextContent('That receipt was not found.');
    expect(screen.queryByTestId('till-return-form')).not.toBeInTheDocument();
  });

  it('opens a sale picked from today without the read pill', async () => {
    const user = userEvent.setup();
    render(<TillReturnSheet onClose={vi.fn()} />);
    await user.click(screen.getByTestId('till-return-sale-VTA-N-000842'));
    expect(await screen.findByTestId('till-return-form')).toBeInTheDocument();
    expect(screen.queryByTestId('till-return-read')).not.toBeInTheDocument();
  });

  it('refunds the ticked quantity with the chosen reason when no approval is needed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TillReturnSheet onClose={onClose} />);
    await scan(user);
    const submit = await screen.findByTestId('till-return-submit');
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId('till-return-check-l-rice'));
    await user.clear(screen.getByTestId('till-return-quantity-l-rice'));
    await user.type(screen.getByTestId('till-return-quantity-l-rice'), '1');
    await user.click(screen.getByTestId('till-return-reason-charge_error'));
    expect(screen.getByTestId('till-return-amount')).toHaveTextContent('Refund in cash');
    expect(screen.getByTestId('till-return-amount')).toHaveTextContent('as it was paid');
    expect(screen.queryByTestId('till-return-approval')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('till-return-submit'));
    expect(returnSale).toHaveBeenCalledWith({
      id: 'sale-1',
      items: [{ saleItemId: 'l-rice', quantity: 1 }],
      destination: 'original',
      reason: 'charge_error',
    });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hydrateFromReturn).not.toHaveBeenCalled();
  });

  it('asks a manager first and never refunds while the request is open', async () => {
    const user = userEvent.setup();
    state.approvalRule = { required: true, reason: 'shift_amount', limitAmount: 10000 };
    render(<TillReturnSheet onClose={vi.fn()} />);
    await scan(user);
    await user.click(await screen.findByTestId('till-return-check-l-oil'));
    await user.click(screen.getByTestId('till-return-reason-expired'));

    expect(screen.getByTestId('till-return-approval')).toHaveTextContent(
      /Over your .*10.000 limit: a manager approves it/
    );
    expect(screen.getByTestId('till-return-submit')).toHaveTextContent('Ask for approval');
    await user.click(screen.getByTestId('till-return-submit'));
    expect(requestApproval).toHaveBeenCalledWith('sale_refund', 'Damaged item');
    expect(returnSale).not.toHaveBeenCalled();
  });

  it('shows the PIN form at the till for a pending request', async () => {
    const user = userEvent.setup();
    state.approvalRule = { required: true, reason: 'role', limitAmount: null };
    state.approvalStatus = 'pending';
    render(<TillReturnSheet onClose={vi.fn()} />);
    await scan(user);
    await user.click(await screen.findByTestId('till-return-check-l-oil'));
    await user.click(screen.getByTestId('till-return-reason-other'));
    expect(screen.getByTestId('till-return-submit')).toHaveTextContent('Waiting for approval');
    expect(screen.getByTestId('till-return-submit')).toBeDisabled();

    await user.click(screen.getByTestId('till-return-pin'));
    expect(await screen.findByTestId('inline-approval-sale_refund')).toBeInTheDocument();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('refunds with the grant once approved and opens the replacement sale for an exchange', async () => {
    const user = userEvent.setup();
    state.approvalRule = { required: true, reason: 'role', limitAmount: null };
    state.approvalStatus = 'approved';
    state.allApproved = true;
    render(<TillReturnSheet onClose={vi.fn()} />);
    await scan(user);
    await user.click(await screen.findByTestId('till-return-check-l-oil'));
    await user.click(screen.getByTestId('till-return-reason-wrong_item'));
    expect(screen.getByTestId('till-return-approval')).toHaveTextContent('Approved');

    await user.click(screen.getByTestId('till-return-submit'));
    expect(returnSale).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'wrong_item', approvalRequestId: 'req-1' })
    );
    await vi.waitFor(() =>
      expect(hydrateFromReturn).toHaveBeenCalledWith({
        ownerKey: `${state.tenantId}:user-1`,
        returnId: 'ret-1',
        saleNumber: 'VTA-N-000842',
        customerId: null,
        customerName: null,
        priceTier: 1,
      })
    );
  });

  it('resumes a return waiting on a manager after the sheet closes', async () => {
    const user = userEvent.setup();
    state.approvalRule = { required: true, reason: 'role', limitAmount: null };
    state.approvalStatus = 'pending';
    const first = render(<TillReturnSheet onClose={vi.fn()} />);
    await scan(user);
    await user.click(await screen.findByTestId('till-return-check-l-oil'));
    await user.click(screen.getByTestId('till-return-reason-other'));
    first.unmount();

    render(<TillReturnSheet onClose={vi.fn()} />);
    expect(await screen.findByTestId('till-return-check-l-oil')).toBeChecked();
    expect(screen.getByTestId('till-return-reason-other')).toBeChecked();
    expect(screen.queryByTestId('till-return-code')).not.toBeInTheDocument();
  });

  it('forgets a return nobody is approving', async () => {
    const user = userEvent.setup();
    const first = render(<TillReturnSheet onClose={vi.fn()} />);
    await scan(user);
    await user.click(await screen.findByTestId('till-return-check-l-oil'));
    first.unmount();

    render(<TillReturnSheet onClose={vi.fn()} />);
    expect(screen.getByTestId('till-return-code')).toBeInTheDocument();
  });

  it('preselects the only line of a one-line receipt', async () => {
    const user = userEvent.setup();
    state.sale = sale([line('l-oil', 'Aceite 1 L', 1)]);
    render(<TillReturnSheet onClose={vi.fn()} />);
    await scan(user);
    expect(await screen.findByTestId('till-return-check-l-oil')).toBeChecked();
  });

  it('says when nothing is left to return', async () => {
    const user = userEvent.setup();
    state.sale = sale([line('l-oil', 'Aceite 1 L', 1, 0)]);
    render(<TillReturnSheet onClose={vi.fn()} />);
    await scan(user);
    expect(await screen.findByTestId('till-return-nothing')).toHaveTextContent(
      'This sale has already been fully returned.'
    );
  });
});
