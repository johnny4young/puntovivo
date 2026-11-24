/**
 * Fase 5.4 / T6 — transfer reconciliation subsection inside the Payments tab.
 *
 * Asserts:
 * - Every bucket is fed by the procedure it claims: tender counters from
 *   `payments.transferReconciliation`, open QRs from `payments.openPresentations`,
 *   expired QRs from the outbox window the panel already read.
 * - A tender whose deposit chain left a surplus shows up in the excess bucket
 *   and in the money-not-applied figure.
 * - A figure that cannot be totalled honestly (the read hit its row limit) is
 *   rendered as unavailable, never as zero.
 * - An empty day renders the empty state, not a table with headers.
 * - Only a role the server allows can open the 5.5 deposit dialog.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { formatCurrency } from '@/lib/utils';
import {
  deriveTransferBuckets,
  TRANSFER_ROW_LIMIT,
  TransferReconciliationSection,
  type PaymentOutboxRow,
  type TransferReconciliationRow,
} from './TransferReconciliationSection';

const OUTBOX_LIMIT = 20;
const depositMutate = vi.fn();

let mockRole: 'admin' | 'manager' | 'cashier' = 'admin';
let mockCounters: Record<string, number> = {};
let mockTransferRows: TransferReconciliationRow[] = [];
let mockOutboxRows: PaymentOutboxRow[] = [];
let mockOpenPresentations: Record<string, unknown[]> = {};
let mockSites: Array<{ id: string }> = [{ id: 'site-1' }];

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      payments: {
        transferReconciliation: { invalidate: vi.fn(async () => undefined) },
        pendingTransfers: { invalidate: vi.fn(async () => undefined) },
      },
    }),
    useQueries: (build: (client: unknown) => unknown[]) => {
      const siteIds: string[] = [];
      const client = {
        payments: {
          openPresentations: (input: { siteId: string }) => {
            siteIds.push(input.siteId);
            return { siteId: input.siteId };
          },
        },
      };
      build(client);
      return siteIds.map(siteId => ({
        data: mockOpenPresentations[siteId] ?? [],
        isLoading: false,
        error: null,
        isSuccess: true,
      }));
    },
    sites: {
      list: {
        useQuery: () => ({
          data: { items: mockSites },
          isLoading: false,
          error: null,
          isSuccess: true,
        }),
      },
    },
    payments: {
      transferReconciliation: {
        useQuery: () => ({
          data: { counters: mockCounters, rows: mockTransferRows },
          isLoading: false,
          error: null,
          isSuccess: true,
        }),
      },
      pendingTransfers: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          isSuccess: true,
          refetch: vi.fn(),
        }),
      },
      registerManualDeposit: {
        useMutation: (options: {
          onSuccess?: (answer: {
            appliedAmount: number;
            surplusAmount: number;
            status: string;
          }) => void;
        }) => ({
          isPending: false,
          mutate: (input: Record<string, unknown>) => {
            depositMutate(input);
            options.onSuccess?.({
              appliedAmount: 100_000,
              surplusAmount: 0,
              status: 'manual_confirmed',
            });
          },
        }),
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'demo@test', role: mockRole, tenantId: 't1' },
  }),
}));

function transferRow(
  overrides: Partial<TransferReconciliationRow> = {}
): TransferReconciliationRow {
  return {
    salePaymentId: 'pay-1',
    saleId: 'sale-1',
    saleNumber: 'V-000123',
    siteId: 'site-1',
    amount: 100_000,
    reference: 'REF-77',
    confirmationStatus: 'customer_reported',
    confirmationSource: null,
    confirmedAt: null,
    destinationSnapshot: { id: 'dest-1', label: 'Bancolombia', kind: 'bank_account' },
    createdAt: '2026-11-20T14:05:00.000Z',
    appliedAmount: 0,
    surplusAmount: 0,
    ...overrides,
  };
}

function outboxRow(overrides: Partial<PaymentOutboxRow> = {}): PaymentOutboxRow {
  return {
    id: 'outbox-1',
    railId: 'static_qr',
    kind: 'presentation',
    status: 'timeout',
    salePaymentId: null,
    amount: 100_000,
    currencyCode: 'COP',
    reference: 'QR-1',
    providerTransactionId: null,
    payloadVersion: 1,
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    priority: 0,
    idempotencyKey: null,
    createdAt: '2026-11-20T13:00:00.000Z',
    updatedAt: '2026-11-20T13:10:00.000Z',
    ...overrides,
  };
}

function renderSection(): void {
  render(
    <TransferReconciliationSection outboxRows={mockOutboxRows} outboxLimit={OUTBOX_LIMIT} />
  );
}

/** The rendered figure of one bucket tile, from the tile's own value node. */
function bucketValue(bucket: string): string {
  const tile = screen.getByTestId(`transfer-bucket-${bucket}`);
  return tile.querySelector('.val')?.textContent ?? '';
}

beforeEach(() => {
  depositMutate.mockClear();
  mockRole = 'admin';
  mockCounters = {};
  mockTransferRows = [];
  mockOutboxRows = [];
  mockOpenPresentations = {};
  mockSites = [{ id: 'site-1' }];
});

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('deriveTransferBuckets', () => {
  const base = { outboxRows: [], outboxLimit: OUTBOX_LIMIT, pendingPresentations: 0 };

  it('reads every tender counter from the reconciliation counters', () => {
    const totals = deriveTransferBuckets({
      ...base,
      counters: {
        pending: 2,
        customer_reported: 3,
        manual_confirmed: 1,
        provider_confirmed: 4,
        rejected: 1,
        needs_reconciliation: 5,
      },
      rows: [],
    });

    expect(totals.reported).toBe(3);
    expect(totals.confirmed).toBe(5);
    expect(totals.rejected).toBe(1);
    expect(totals.awaitingReconciliation).toBe(5);
    expect(totals.pending).toBe(2);
  });

  it('derives the excess bucket and the unapplied money from the tender rows', () => {
    const totals = deriveTransferBuckets({
      ...base,
      counters: {},
      rows: [transferRow({ appliedAmount: 100_000, surplusAmount: 5_000 })],
    });

    expect(totals.excessTenders).toBe(1);
    expect(totals.unappliedAmount).toBe(5_000);
  });

  it('counts a tender whose deposits do not cover it as a pending deposit chain', () => {
    const totals = deriveTransferBuckets({
      ...base,
      counters: {},
      rows: [transferRow({ appliedAmount: 40_000, surplusAmount: 0 })],
    });

    expect(totals.partialOrMultipleDeposits).toBe(1);
    expect(totals.excessTenders).toBe(0);
    expect(totals.unappliedAmount).toBe(0);
  });

  it('counts expired presentations from the outbox and never a live one', () => {
    const totals = deriveTransferBuckets({
      ...base,
      pendingPresentations: 2,
      counters: {},
      rows: [],
      outboxRows: [
        outboxRow(),
        outboxRow({ id: 'outbox-2', status: 'presented' }),
        outboxRow({ id: 'outbox-3', kind: 'charge', status: 'declined', salePaymentId: 'pay-9' }),
      ],
    });

    expect(totals.expiredPresentations).toBe(1);
    expect(totals.pendingPresentations).toBe(2);
  });

  it('counts presentations that ended without a linked sale and skips linked ones', () => {
    const totals = deriveTransferBuckets({
      ...base,
      counters: {},
      rows: [],
      outboxRows: [
        outboxRow(),
        outboxRow({ id: 'outbox-2', status: 'linked', salePaymentId: 'pay-9' }),
        outboxRow({ id: 'outbox-3', status: 'presented' }),
      ],
    });

    expect(totals.unlinkedPresentations).toBe(1);
  });

  it('reports row totals as unavailable when the tender read hits its limit', () => {
    const rows = Array.from({ length: TRANSFER_ROW_LIMIT }, (_, index) =>
      transferRow({ salePaymentId: `pay-${index}`, surplusAmount: 100 })
    );
    const totals = deriveTransferBuckets({ ...base, counters: {}, rows });

    expect(totals.rowsTruncated).toBe(true);
    expect(totals.excessTenders).toBeNull();
    expect(totals.partialOrMultipleDeposits).toBeNull();
    expect(totals.unappliedAmount).toBeNull();
  });

  it('reports presentation totals as unavailable when the outbox window is full', () => {
    const outboxRows = Array.from({ length: OUTBOX_LIMIT }, (_, index) =>
      outboxRow({ id: `outbox-${index}` })
    );
    const totals = deriveTransferBuckets({ ...base, counters: {}, rows: [], outboxRows });

    expect(totals.outboxTruncated).toBe(true);
    expect(totals.expiredPresentations).toBeNull();
    expect(totals.unlinkedPresentations).toBeNull();
  });
});

describe('TransferReconciliationSection — buckets', () => {
  it('renders every tender counter from the reconciliation read', () => {
    mockCounters = {
      pending: 2,
      customer_reported: 3,
      manual_confirmed: 1,
      provider_confirmed: 4,
      rejected: 1,
      needs_reconciliation: 5,
    };
    renderSection();

    expect(bucketValue('reported')).toBe('3');
    expect(bucketValue('confirmed')).toBe('5');
    expect(bucketValue('rejected')).toBe('1');
    expect(bucketValue('awaitingReconciliation')).toBe('5');
    expect(bucketValue('pending')).toBe('2');
  });

  it('shows a tender with a surplus in the excess bucket and its unapplied money', () => {
    mockTransferRows = [transferRow({ appliedAmount: 100_000, surplusAmount: 5_000 })];
    renderSection();

    expect(bucketValue('excess')).toBe('1');
    expect(bucketValue('unappliedAmount')).toBe(formatCurrency(5_000));
  });

  it('counts expired presentations from the outbox while the live one stays open', () => {
    mockOutboxRows = [
      outboxRow(),
      outboxRow({ id: 'outbox-2', status: 'presented' }),
      outboxRow({ id: 'outbox-3', status: 'linked', salePaymentId: 'pay-9' }),
    ];
    mockOpenPresentations = { 'site-1': [{}, {}] };
    renderSection();

    expect(bucketValue('expiredPresentations')).toBe('1');
    expect(bucketValue('pendingPresentations')).toBe('2');
    expect(bucketValue('unlinkedPresentations')).toBe('1');
  });

  it('renders the empty state instead of a table with headers when nothing is pending', () => {
    renderSection();

    expect(screen.getByText('No transfers to reconcile')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders unavailable instead of zero when the tender read is truncated', () => {
    mockTransferRows = Array.from({ length: TRANSFER_ROW_LIMIT }, (_, index) =>
      transferRow({ salePaymentId: `pay-${index}`, surplusAmount: 100 })
    );
    renderSection();

    expect(bucketValue('unappliedAmount')).toBe('Unavailable');
    expect(bucketValue('unappliedAmount')).not.toBe(formatCurrency(0));
    expect(bucketValue('excess')).toBe('Unavailable');
  });
});

describe('TransferReconciliationSection — tenders', () => {
  it('renders the pending tender with the accumulated deposits the server sent', () => {
    mockTransferRows = [
      transferRow({
        appliedAmount: 40_000,
        surplusAmount: 0,
        confirmationStatus: 'needs_reconciliation',
      }),
    ];
    renderSection();

    const table = screen.getByRole('table');
    expect(within(table).getByText('V-000123')).toBeInTheDocument();
    expect(within(table).getByText('REF-77')).toBeInTheDocument();
    expect(within(table).getByText(formatCurrency(100_000))).toBeInTheDocument();
    expect(within(table).getByText(formatCurrency(40_000))).toBeInTheDocument();
    expect(within(table).getByText('To reconcile')).toBeInTheDocument();
  });

  it('opens the 5.5 deposit dialog for an administrator over the selected tender', () => {
    mockTransferRows = [transferRow()];
    renderSection();

    fireEvent.click(screen.getByTestId('transfer-deposit-pay-1'));

    expect(screen.getByTestId('manual-deposit-tender')).toBeInTheDocument();
    expect(screen.getByTestId('manual-deposit-expected-amount')).toHaveTextContent(
      formatCurrency(100_000)
    );
    expect(screen.getByTestId('manual-deposit-reported-reference')).toHaveTextContent('REF-77');
  });

  it('keeps the deposit dialog closed for a role the server would refuse', () => {
    mockRole = 'cashier';
    mockTransferRows = [transferRow()];
    renderSection();

    const depositButton = screen.getByTestId('transfer-deposit-pay-1');
    expect(depositButton).toBeDisabled();
    expect(depositButton).toHaveAttribute('title', expect.stringMatching(/manager|administrator/i));

    fireEvent.click(depositButton);
    expect(screen.queryByTestId('manual-deposit-tender')).not.toBeInTheDocument();
  });
});
