/**
 * +  — Tests for Operations Center Payment Health panel.
 *
 * Asserts:
 * - Initial rendering (mismatch + outbox + summary + breakdown card).
 * - Per-row admin actions (Retry, Mark settled) for admin users.
 * - Manager users see the buttons but disabled with translated tooltip.
 * - Settled rows have both action buttons disabled.
 * - Confirm modal flow → retry mutation fires → caches invalidate.
 * - Mark-settled modal carries the optional providerTransactionId input
 * and flows the typed value into the mutation payload.
 * - Breakdown card renders one row per (rail × status) aggregate and
 * handles the empty-state branch.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@/test/utils';
import { PaymentHealthPanel } from './PaymentHealthPanel';

const retryMutateAsync = vi.fn(async (_input: { outboxId: string }) => undefined);
const markSettledMutateAsync = vi.fn(
  async (_input: { outboxId: string; providerTransactionId?: string }) => undefined
);
const peekOutboxInvalidate = vi.fn(async () => undefined);
const reconciliationInvalidate = vi.fn(async () => undefined);
const methodBreakdownInvalidate = vi.fn(async () => undefined);
const attentionInvalidate = vi.fn(async () => undefined);

let mockUserRole: 'admin' | 'manager' = 'admin';
let mockOutboxRows: Array<Record<string, unknown>> = [
  {
    id: 'payment-outbox-1',
    railId: 'wompi',
    kind: 'charge',
    status: 'declined',
    salePaymentId: 'sale-payment-2',
    amount: 90_000,
    currencyCode: 'COP',
    reference: 'AUTH-DECLINED',
    providerTransactionId: 'wompi_tx_1',
    payloadVersion: 1,
    attempts: 1,
    nextRetryAt: null,
    lastError: { message: 'Provider declined' },
    priority: 0,
    idempotencyKey: null,
    createdAt: '2026-05-10T10:30:00.000Z',
    updatedAt: '2026-05-10T10:30:00.000Z',
  },
];
let mockBreakdownEntries: Array<Record<string, unknown>> = [
  { railId: 'wompi', status: 'declined', count: 1, totalAmount: 90_000 },
  { railId: 'bold', status: 'settled', count: 4, totalAmount: 250_000 },
];

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      payments: {
        peekOutbox: { invalidate: peekOutboxInvalidate },
        reconciliation: { invalidate: reconciliationInvalidate },
        methodBreakdown: { invalidate: methodBreakdownInvalidate },
      },
      operations: { needsAttention: { invalidate: attentionInvalidate } },
    }),
    payments: {
      reconciliation: {
        useQuery: () => ({
          data: {
            summary: {
              windowDays: 30,
              tendersScanned: 2,
              outboxRows: 2,
              matched: 1,
              mismatches: 2,
              missingProviderReferences: 1,
              providerIssues: 1,
              totalTenderAmount: 180_000,
              unmatchedAmount: 90_000,
            },
            byRail: [
              { railId: 'wompi', outboxRows: 1, amount: 90_000, issues: 1 },
              { railId: 'bold', outboxRows: 0, amount: 0, issues: 0 },
            ],
            mismatches: [
              {
                type: 'missing_provider_reference',
                railId: null,
                salePaymentId: 'sale-payment-1',
                paymentOutboxId: null,
                reference: 'AUTH-MISSING',
                providerTransactionId: null,
                amount: 90_000,
                providerAmount: null,
                status: null,
                createdAt: '2026-05-10T10:00:00.000Z',
                suggestedAction: 'queue_charge',
              },
              {
                type: 'provider_issue',
                railId: 'wompi',
                salePaymentId: 'sale-payment-2',
                paymentOutboxId: 'payment-outbox-1',
                reference: 'AUTH-DECLINED',
                providerTransactionId: 'wompi_tx_1',
                amount: 90_000,
                providerAmount: 90_000,
                status: 'declined',
                createdAt: '2026-05-10T10:30:00.000Z',
                suggestedAction: 'review_provider',
              },
            ],
          },
          isLoading: false,
          error: null,
        }),
      },
      peekOutbox: {
        useQuery: () => ({
          data: mockOutboxRows,
          isLoading: false,
          error: null,
        }),
      },
      methodBreakdown: {
        useQuery: () => ({
          data: { windowDays: 7, entries: mockBreakdownEntries },
          isLoading: false,
          error: null,
        }),
      },
      retryOutbox: {
        useMutation: (options: { onSuccess?: () => Promise<void> | void }) => ({
          isPending: false,
          mutateAsync: async (input: { outboxId: string }) => {
            await retryMutateAsync(input);
            await options.onSuccess?.();
          },
        }),
      },
      markSettled: {
        useMutation: (options: { onSuccess?: () => Promise<void> | void }) => ({
          isPending: false,
          mutateAsync: async (input: { outboxId: string; providerTransactionId?: string }) => {
            await markSettledMutateAsync(input);
            await options.onSuccess?.();
          },
        }),
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'demo@test', role: mockUserRole, tenantId: 't1' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

beforeEach(() => {
  retryMutateAsync.mockClear();
  retryMutateAsync.mockResolvedValue(undefined);
  markSettledMutateAsync.mockClear();
  markSettledMutateAsync.mockResolvedValue(undefined);
  peekOutboxInvalidate.mockClear();
  reconciliationInvalidate.mockClear();
  methodBreakdownInvalidate.mockClear();
  attentionInvalidate.mockClear();
  mockUserRole = 'admin';
  mockOutboxRows = [
    {
      id: 'payment-outbox-1',
      railId: 'wompi',
      kind: 'charge',
      status: 'declined',
      salePaymentId: 'sale-payment-2',
      amount: 90_000,
      currencyCode: 'COP',
      reference: 'AUTH-DECLINED',
      providerTransactionId: 'wompi_tx_1',
      payloadVersion: 1,
      attempts: 1,
      nextRetryAt: null,
      lastError: { message: 'Provider declined' },
      priority: 0,
      idempotencyKey: null,
      createdAt: '2026-05-10T10:30:00.000Z',
      updatedAt: '2026-05-10T10:30:00.000Z',
    },
  ];
  mockBreakdownEntries = [
    { railId: 'wompi', status: 'declined', count: 1, totalAmount: 90_000 },
    { railId: 'bold', status: 'settled', count: 4, totalAmount: 250_000 },
  ];
});

describe('PaymentHealthPanel — initial rendering', () => {
  it('renders the reconciliation summary, mismatch list and outbox tail', () => {
    render(<PaymentHealthPanel />);

    expect(screen.getByRole('heading', { name: /Payment Health/i })).toBeInTheDocument();
    expect(screen.getByTestId('payments-summary')).toHaveTextContent('Tenders scanned');
    expect(screen.getByText('Missing provider row')).toBeInTheDocument();
    expect(screen.getByText('Provider issue')).toBeInTheDocument();
    expect(screen.getAllByText('Wompi').length).toBeGreaterThan(0);
    expect(screen.getByText('Provider declined')).toBeInTheDocument();
  });
});

describe('PaymentHealthPanel —  row actions', () => {
  it('admin sees Retry + Mark settled buttons enabled on a declined row', () => {
    render(<PaymentHealthPanel />);
    const retry = screen.getByTestId('payment-retry-payment-outbox-1');
    const markSettled = screen.getByTestId('payment-mark-settled-payment-outbox-1');
    expect(retry).not.toBeDisabled();
    expect(markSettled).not.toBeDisabled();
    expect(retry).not.toHaveAttribute('title');
  });

  it('manager sees Retry + Mark settled buttons disabled with translated tooltip', () => {
    mockUserRole = 'manager';
    render(<PaymentHealthPanel />);
    const retry = screen.getByTestId('payment-retry-payment-outbox-1');
    const markSettled = screen.getByTestId('payment-mark-settled-payment-outbox-1');
    expect(retry).toBeDisabled();
    expect(markSettled).toBeDisabled();
    expect(retry).toHaveAttribute('title', expect.stringMatching(/administrators?/i));
  });

  it('both buttons are disabled on a row already in status=settled', () => {
    mockOutboxRows = [
      {
        id: 'payment-outbox-settled',
        railId: 'bold',
        kind: 'charge',
        status: 'settled',
        salePaymentId: 'sale-1',
        amount: 50_000,
        currencyCode: 'COP',
        reference: 'SETTLED',
        providerTransactionId: 'bold-tx',
        payloadVersion: 1,
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        priority: 0,
        idempotencyKey: null,
        createdAt: '2026-05-10T08:00:00.000Z',
        updatedAt: '2026-05-10T08:00:00.000Z',
      },
    ];
    render(<PaymentHealthPanel />);
    expect(screen.getByTestId('payment-retry-payment-outbox-settled')).toBeDisabled();
    expect(screen.getByTestId('payment-mark-settled-payment-outbox-settled')).toBeDisabled();
  });

  it('Retry is disabled on non-retriable approved rows while Mark settled stays available', () => {
    mockOutboxRows = [
      {
        id: 'payment-outbox-approved',
        railId: 'wompi',
        kind: 'charge',
        status: 'approved',
        salePaymentId: 'sale-approved',
        amount: 75_000,
        currencyCode: 'COP',
        reference: 'APPROVED',
        providerTransactionId: 'wompi-approved',
        payloadVersion: 1,
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        priority: 0,
        idempotencyKey: null,
        createdAt: '2026-05-10T09:00:00.000Z',
        updatedAt: '2026-05-10T09:00:00.000Z',
      },
    ];
    render(<PaymentHealthPanel />);
    const retry = screen.getByTestId('payment-retry-payment-outbox-approved');
    const markSettled = screen.getByTestId('payment-mark-settled-payment-outbox-approved');
    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute('title', expect.stringMatching(/Only declined/i));
    expect(markSettled).not.toBeDisabled();
  });

  it('clicking Retry opens the confirm modal, then firing confirm calls the mutation', async () => {
    render(<PaymentHealthPanel />);
    fireEvent.click(screen.getByTestId('payment-retry-payment-outbox-1'));

    expect(screen.getByText('Retry this payment')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }));

    await vi.waitFor(() => {
      expect(retryMutateAsync).toHaveBeenCalledWith({ outboxId: 'payment-outbox-1' });
      expect(attentionInvalidate).toHaveBeenCalledTimes(1);
    });
  });

  it('clicking Mark settled opens a modal with the optional providerTransactionId input and flows it into the mutation', async () => {
    render(<PaymentHealthPanel />);
    fireEvent.click(screen.getByTestId('payment-mark-settled-payment-outbox-1'));

    const input = screen.getByTestId('payment-mark-settled-provider-tx') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  wompi-tx-override  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }));

    await vi.waitFor(() => {
      expect(markSettledMutateAsync).toHaveBeenCalledWith({
        outboxId: 'payment-outbox-1',
        providerTransactionId: 'wompi-tx-override',
      });
    });
  });

  it('Mark settled without typing anything omits providerTransactionId from the payload', async () => {
    render(<PaymentHealthPanel />);
    fireEvent.click(screen.getByTestId('payment-mark-settled-payment-outbox-1'));

    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }));

    await vi.waitFor(() => {
      expect(markSettledMutateAsync).toHaveBeenCalledWith({
        outboxId: 'payment-outbox-1',
      });
    });
  });
});

describe('PaymentHealthPanel —  breakdown card', () => {
  it('renders one row per (rail × status) aggregate from methodBreakdown', () => {
    render(<PaymentHealthPanel />);
    const table = screen.getByTestId('payments-breakdown-table');
    const rows = within(table).getAllByRole('row');
    // header + 2 data rows
    expect(rows.length).toBe(3);
    expect(within(table).getByText('Bold')).toBeInTheDocument();
    expect(within(table).getByText('4')).toBeInTheDocument();
  });

  it('renders the empty state when methodBreakdown returns no entries', () => {
    mockBreakdownEntries = [];
    render(<PaymentHealthPanel />);
    expect(screen.getByText(/No payment activity in the last 7 days/i)).toBeInTheDocument();
  });
});
