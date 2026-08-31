import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import type { Provider } from '@/types';
import { ProviderPayablesModal } from './ProviderPayablesModal';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(async () => undefined),
  createInvoice: vi.fn(),
  createOpening: vi.fn(),
  recordPayment: vi.fn(),
  recordCredit: vi.fn(),
}));

const overview = {
  totals: { invoices: 150, payments: 20, credits: 10, balance: 120 },
  aging: { current: 40, days1To30: 80, days31To60: 0, days61To90: 0, daysOver90: 0 },
  invoices: [
    {
      id: 'invoice-old',
      kind: 'invoice',
      documentNumber: 'FAC-1',
      purchaseId: 'purchase-1',
      purchaseNumber: 'COM-1',
      siteId: 'site-1',
      siteName: 'Main Site',
      issuedAt: '2026-08-01',
      dueAt: '2026-08-15',
      amount: 100,
      notes: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      allocated: 20,
      outstanding: 80,
      status: 'partial',
    },
    {
      id: 'invoice-new',
      kind: 'invoice',
      documentNumber: 'FAC-2',
      purchaseId: null,
      purchaseNumber: null,
      siteId: 'site-1',
      siteName: 'Main Site',
      issuedAt: '2026-08-20',
      dueAt: '2026-09-15',
      amount: 40,
      notes: null,
      createdAt: '2026-08-20T00:00:00.000Z',
      allocated: 0,
      outstanding: 40,
      status: 'open',
    },
  ],
  openInvoices: [
    { id: 'invoice-old', outstanding: 80, dueAt: '2026-08-15' },
    { id: 'invoice-new', outstanding: 40, dueAt: '2026-09-15' },
  ],
  statement: [
    {
      id: 'payment-1',
      kind: 'payment',
      occurredAt: '2026-08-25',
      amount: -20,
      reference: 'TRX-1',
      note: null,
      balanceAfter: 120,
    },
  ],
  availablePurchases: [
    {
      id: 'purchase-2',
      purchaseNumber: 'COM-2',
      total: 55,
      siteId: 'site-1',
      siteName: 'Main Site',
      createdAt: '2026-08-29T00:00:00.000Z',
    },
  ],
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ providerPayables: { overview: { invalidate: mocks.invalidate } } }),
    providerPayables: {
      overview: {
        useQuery: () => ({
          data: overview,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => {
    const mutate =
      path === 'providerPayables.createInvoice'
        ? mocks.createInvoice
        : path === 'providerPayables.createOpeningBalance'
          ? mocks.createOpening
          : path === 'providerPayables.recordPayment'
            ? mocks.recordPayment
            : mocks.recordCredit;
    return { mutate, isPending: false };
  },
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const provider = { id: 'provider-1', name: 'ACME Supplier' } as Provider;

describe('ProviderPayablesModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
  });

  it('shows reconciled totals, aging, invoices, statement, and uninvoiced purchases', () => {
    render(<ProviderPayablesModal isOpen provider={provider} onClose={vi.fn()} />);

    expect(screen.getByTestId('provider-payables-overview')).toHaveTextContent('Outstanding');
    expect(screen.getByText('1–30 days')).toBeInTheDocument();
    expect(screen.getByText('FAC-1')).toBeInTheDocument();
    expect(screen.getByText('TRX-1')).toBeInTheDocument();
    expect(screen.getByText('Completed purchases without supplier invoice')).toBeInTheDocument();
  });

  it('allocates a payment across oldest invoices before dispatching the critical command', async () => {
    const user = userEvent.setup();
    render(<ProviderPayablesModal isOpen provider={provider} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Save payment' }));

    expect(mocks.recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'provider-1',
        amount: 100,
        paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        allocations: [
          { invoiceId: 'invoice-old', amount: 80 },
          { invoiceId: 'invoice-new', amount: 20 },
        ],
      })
    );
  });

  it('requires an explicit note for an opening balance', async () => {
    const user = userEvent.setup();
    render(<ProviderPayablesModal isOpen provider={provider} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Opening balance' }));
    await user.type(screen.getByLabelText('Amount'), '75');
    expect(screen.getByRole('button', { name: 'Save opening balance' })).toBeDisabled();

    await user.type(screen.getByLabelText('Required opening-balance note'), 'Imported statement');
    await user.click(screen.getByRole('button', { name: 'Save opening balance' }));
    expect(mocks.createOpening).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 75, note: 'Imported statement' })
    );
  });
});
