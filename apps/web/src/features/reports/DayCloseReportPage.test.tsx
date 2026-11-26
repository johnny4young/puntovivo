import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { DayCloseReportPage } from './DayCloseReportPage';
import type { DayCloseTransferConfirmations } from './dayCloseTransferSection';
import { setActiveTenantLocale } from '@/lib/utils';

const refetch = vi.fn();
const signoffRefetch = vi.fn();
const invalidateSignoff = vi.fn();
const signOff = vi.fn();
let mockPending = false;
let mockError: Error | null = null;
type DayCloseReadinessCode =
  inferRouterOutputs<AppRouter>['reports']['dayClose']['preview']['readiness']['blockers'][number];
let mockData:
  | (ReturnType<typeof reportFixture> & {
      transferConfirmations?: DayCloseTransferConfirmations;
    })
  | undefined;
let mockSignoff: ReturnType<typeof signoffFixture> | null = null;
let mockSignoffPending = false;
let mockSignoffError: Error | null = null;

let mockUserRole = 'admin';
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u-1', role: mockUserRole } }),
}));

vi.mock('@/lib/trpc', async () => ({
  ...(await vi.importActual<typeof import('@/lib/trpc')>('@/lib/trpc')),
  fetchProtectedApi: vi.fn(),
  trpc: {
    useUtils: () => ({
      reports: { dayClose: { signoff: { invalidate: invalidateSignoff } } },
    }),
    reports: {
      dayClose: {
        signoff: {
          useQuery: () => ({
            data: mockSignoff,
            isPending: mockSignoffPending,
            isSuccess: !mockSignoffPending && mockSignoffError === null,
            error: mockSignoffError,
            isFetching: false,
            refetch: signoffRefetch,
          }),
        },
        preview: {
          useQuery: () => ({
            data: mockData,
            isPending: mockPending,
            isError: mockError !== null,
            error: mockError,
            isFetching: false,
            refetch,
          }),
        },
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutate: signOff, isPending: false }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/translateServerError', () => ({
  translateServerError: (_error: unknown, _t: unknown, fallback: string) => fallback,
}));

function reportFixture() {
  return {
    date: '2026-07-14',
    timeZone: 'America/Bogota',
    currencyCode: 'COP',
    generatedAt: '2026-07-15T02:00:00.000Z',
    window: {
      start: '2026-07-14T05:00:00.000Z',
      endExclusive: '2026-07-15T05:00:00.000Z',
    },
    sales: {
      count: 12,
      subtotal: 900_000,
      discounts: 30_000,
      taxes: 171_000,
      tips: 20_000,
      serviceCharges: 10_000,
      grossRevenue: 1_096_000,
      refundAmount: 50_000,
      netRevenue: 1_021_000,
    },
    payments: [
      { method: 'cash' as const, amount: 600_000, transactionCount: 7 },
      { method: 'card' as const, amount: 471_000, transactionCount: 5 },
      { method: 'other' as const, amount: 10_000, transactionCount: 1 },
    ],
    cash: {
      closedSessions: 2,
      openSessions: 1,
      expected: 600_000,
      counted: 595_000,
      overShort: -5_000,
      balancedSessions: 1,
      discrepancySessions: 1,
    },
    fiscal: {
      total: 12,
      totalAmount: 1_071_000,
      byStatus: {
        pending: 1,
        sent: 0,
        accepted: 10,
        rejected: 1,
        contingency: 0,
        voided: 0,
        notified_correction: 0,
        partial_send: 0,
      },
    },
    adjustments: {
      voids: { count: 1, amount: 25_000 },
      refunds: { count: 1, amount: 50_000 },
    },
    anomalies: {
      total: 2,
      high: 1,
      medium: 1,
      byKind: { ticketsPerHourSpike: 0, voidRate: 1, refundAmount: 1, noSaleSessions: 0 },
    },
    capabilities: { commissions: 'not_tracked' as const, waste: 'not_tracked' as const },
    readiness: {
      readyToSign: false,
      blockers: ['open_sessions'] as DayCloseReadinessCode[],
      warnings: [
        'cash_discrepancies' as const,
        'fiscal_pending' as const,
        'fiscal_rejected' as const,
        'high_anomalies' as const,
        'commissions_not_tracked' as const,
        'waste_not_tracked' as const,
      ],
    },
  };
}

// The served block: confirmed and pending are separate figures on purpose, and
// superseded money is evidence that was already replaced, not extra income.
function transferFixture(
  overrides: Partial<DayCloseTransferConfirmations> = {}
): DayCloseTransferConfirmations {
  return {
    saleTotal: 400_000,
    reported: 350_000,
    confirmed: 200_000,
    pending: 100_000,
    rejected: 30_000,
    legacy: 20_000,
    unapplied: 15_000,
    superseded: 25_000,
    notApplied: {
      count: 2,
      amount: 52_000,
      byReason: {
        tender_rejected: { count: 1, amount: 40_000 },
        tender_cancelled: { count: 0, amount: 0 },
        other: { count: 1, amount: 12_000 },
      },
    },
    destinations: [
      {
        destinationId: 'dest-bank',
        label: 'Bancolombia ****1234',
        kind: 'bank_account',
        confirmed: 200_000,
        pending: 100_000,
        count: 3,
        references: ['REF-2', 'REF-7'],
      },
      {
        destinationId: null,
        label: null,
        kind: null,
        confirmed: 0,
        pending: 50_000,
        count: 1,
        references: [],
      },
    ],
    ...overrides,
  };
}

function signoffFixture() {
  return {
    id: 'signoff-1',
    date: '2026-07-14',
    schemaVersion: 1 as const,
    timeZone: 'America/Bogota',
    currencyCode: 'COP',
    reportHash: 'a'.repeat(64),
    signedAt: '2026-07-15T03:00:00.000Z',
    signedBy: { id: 'manager-1', name: 'María Manager' },
    pdf: {
      id: 'artifact-1',
      rendererVersion: 1 as const,
      locale: 'es-CO',
      filename: 'puntovivo-cierre-2026-07-14-aaaaaaaa.pdf',
      mimeType: 'application/pdf' as const,
      byteSize: 12_288,
      payloadHash: 'b'.repeat(64),
      createdAt: '2026-07-15T03:00:00.000Z',
    },
    report: reportFixture(),
  };
}

beforeEach(() => {
  mockPending = false;
  mockError = null;
  mockData = undefined;
  mockSignoff = null;
  mockSignoffPending = false;
  mockSignoffError = null;
  refetch.mockReset();
  signoffRefetch.mockReset();
  invalidateSignoff.mockReset();
  signOff.mockReset();
});

describe('DayCloseReportPage (-141b)', () => {
  afterEach(() => setActiveTenantLocale(null));

  it('renders loading and error states', () => {
    mockPending = true;
    const { rerender } = render(<DayCloseReportPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/Cargando|Preparando|Building/i);

    // A disabled preview query stays in TanStack's pending state. When the
    // signoff lookup itself fails, the page must show only the error rather
    // than an error and a permanent loading card together.
    mockSignoffError = new Error('boom');
    rerender(<DayCloseReportPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo|could not/i);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the complete report, blockers, payment methods, and honest coverage gaps', () => {
    mockData = reportFixture();
    render(<DayCloseReportPage />);

    expect(screen.getByTestId('day-close-readiness')).toHaveTextContent(
      /Sesiones de caja abiertas|Open cash sessions/i
    );
    expect(screen.getByTestId('day-close-report-page')).toHaveTextContent(/1[.,]?021[.,]?000/);
    expect(screen.getByTestId('day-close-report-page')).toHaveTextContent(/1 devolución|1 refund/i);
    expect(screen.getByTestId('day-close-payments-section')).toHaveTextContent(/Efectivo|Cash/);
    expect(screen.getByTestId('day-close-payments-section')).toHaveTextContent(/Tarjeta|Card/);
    expect(screen.getByTestId('day-close-payments-section')).toHaveTextContent(/Otro|Other/);
    expect(screen.getByTestId('day-close-payments-section')).toHaveTextContent(
      /anulaciones y devoluciones|voids and refunds/i
    );
    expect(screen.getByTestId('day-close-cash-section')).toHaveTextContent(/595[.,]?000/);
    expect(screen.getByTestId('day-close-fiscal-section')).toHaveTextContent(/10/);
    expect(screen.getByTestId('day-close-adjustments-section')).toHaveTextContent(/50[.,]?000/);
    expect(screen.getByTestId('day-close-anomalies-section')).toHaveTextContent(/2/);
    expect(screen.getByTestId('day-close-capabilities-section')).toHaveTextContent(
      /Comisiones|Commissions/
    );
    expect(screen.getByTestId('day-close-capabilities-section')).toHaveTextContent(/Mermas|Waste/);
  });

  it('renders the ready state and a payment empty state', () => {
    mockData = {
      ...reportFixture(),
      payments: [],
      cash: { ...reportFixture().cash, openSessions: 0, discrepancySessions: 0 },
      readiness: { readyToSign: true, blockers: [], warnings: [] },
    };
    render(<DayCloseReportPage />);
    expect(screen.getByTestId('day-close-readiness')).toHaveTextContent(/listo|ready/i);
    expect(screen.getByTestId('day-close-payments-section')).toHaveTextContent(
      /Sin pagos|No settled/i
    );
  });

  it('turns each check into a row with its state and a way to resolve it', () => {
    mockData = {
      ...reportFixture(),
      cash: { ...reportFixture().cash, openSessions: 2, expected: 1000, counted: 700 },
      readiness: {
        readyToSign: false,
        blockers: ['open_sessions'],
        warnings: ['fiscal_rejected', 'waste_not_tracked'],
      },
    };
    render(<DayCloseReportPage />);

    const open = screen.getByTestId('day-close-check-open_sessions');
    expect(open).toHaveAttribute('data-state', 'blocker');
    expect(open).toHaveTextContent('2 registers still open');
    expect(screen.getByTestId('day-close-check-link-open_sessions')).toHaveAttribute(
      'href',
      '/operations?tab=cash'
    );
    expect(screen.getByTestId('day-close-check-fiscal_rejected')).toHaveAttribute(
      'data-state',
      'warning'
    );
    expect(screen.getByTestId('day-close-check-link-fiscal_rejected')).toHaveAttribute(
      'href',
      '/fiscal-documents'
    );
    expect(screen.getByTestId('day-close-check-high_anomalies')).toHaveAttribute(
      'data-state',
      'done'
    );
    expect(screen.queryByTestId('day-close-check-link-high_anomalies')).not.toBeInTheDocument();
    expect(screen.getByTestId('day-close-check-waste_not_tracked')).toBeInTheDocument();
    expect(screen.getByTestId('day-close-checklist-summary')).toHaveTextContent(
      '5 of 7 checks clear'
    );
    expect(screen.getByText(/Counted .*700.* − Expected .*1,000/)).toBeInTheDocument();
    expect(screen.getByText(/2 open sessions not counted yet/)).toBeInTheDocument();
  });

  it('sends differences without a reason and parked sales to the guided close for that day', () => {
    mockData = {
      ...reportFixture(),
      readiness: {
        readyToSign: false,
        blockers: ['unexplained_differences', 'unresolved_drafts'],
        warnings: ['cash_discrepancies'],
      },
    };
    render(<DayCloseReportPage />);
    for (const code of ['unexplained_differences', 'unresolved_drafts']) {
      expect(screen.getByTestId(`day-close-check-${code}`)).toHaveAttribute(
        'data-state',
        'blocker'
      );
      expect(screen.getByTestId(`day-close-check-link-${code}`)).toHaveAttribute(
        'href',
        `/dashboard?close=${reportFixture().date}`
      );
    }
    expect(screen.getByTestId('day-close-check-unresolved_drafts')).toHaveTextContent(
      'Discard them or leave them for tomorrow in the guided close'
    );
  });

  it('keeps fiscal links away from managers, who cannot open those pages', () => {
    mockUserRole = 'manager';
    mockData = {
      ...reportFixture(),
      readiness: {
        readyToSign: false,
        blockers: ['open_sessions'],
        warnings: ['fiscal_rejected'],
      },
    };
    render(<DayCloseReportPage />);

    expect(screen.getByTestId('day-close-check-fiscal_rejected')).toBeInTheDocument();
    expect(screen.queryByTestId('day-close-check-link-fiscal_rejected')).not.toBeInTheDocument();
    expect(screen.getByTestId('day-close-check-link-open_sessions')).toBeInTheDocument();
    mockUserRole = 'admin';
  });

  it('drops empty cents on whole amounts and keeps real cents visible', () => {
    setActiveTenantLocale({
      locale: 'es-CO',
      currency: 'COP',
      displayDecimals: 0,
      timezone: 'America/Bogota',
      dateFormatShort: 'dd/MM/yyyy',
    });
    mockData = {
      ...reportFixture(),
      currencyCode: 'COP',
      cash: { ...reportFixture().cash, expected: 1491700, counted: 200000.5 },
    };
    render(<DayCloseReportPage />);

    const cash = screen.getByTestId('day-close-cash-section');
    expect(cash).toHaveTextContent('1.491.700');
    expect(cash).not.toHaveTextContent('1.491.700,00');
    expect(cash).toHaveTextContent('200.000,50');
  });

  it('renders the verified frozen snapshot instead of a mutable preview', () => {
    mockData = {
      ...reportFixture(),
      sales: { ...reportFixture().sales, count: 99 },
    };
    mockSignoff = signoffFixture();

    render(<DayCloseReportPage />);

    expect(screen.getByTestId('day-close-signed-evidence')).toHaveTextContent(/María Manager/);
    expect(screen.getByTestId('day-close-signed-evidence')).toHaveTextContent('a'.repeat(64));
    expect(screen.getByTestId('day-close-readiness')).toHaveTextContent(/firmada|signed evidence/i);
    expect(screen.getByTestId('day-close-report-page')).not.toHaveTextContent(/99 sales/i);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('reports every transfer figure as its own value and never adds confirmed to pending', () => {
    mockData = { ...reportFixture(), transferConfirmations: transferFixture() };
    render(<DayCloseReportPage />);

    const figures: Array<[string, RegExp]> = [
      ['saleTotal', /400[.,]?000/],
      ['reported', /350[.,]?000/],
      ['confirmed', /200[.,]?000/],
      ['pending', /100[.,]?000/],
      ['rejected', /30[.,]?000/],
      ['legacy', /20[.,]?000/],
      ['unapplied', /15[.,]?000/],
      ['superseded', /25[.,]?000/],
    ];
    for (const [key, expected] of figures) {
      expect(screen.getByTestId(`day-close-transfer-figure-${key}`)).toHaveTextContent(expected);
    }

    const section = screen.getByTestId('day-close-transfer-confirmation-section');
    // confirmed (200.000) + pending (100.000) is a figure this page must never print.
    expect(section).not.toHaveTextContent(/300[.,]?000/);
    // superseded (25.000) is already inside reported (350.000); never added twice.
    expect(section).not.toHaveTextContent(/375[.,]?000/);
  });

  it('splits not-applied money by reason instead of folding it into any total', () => {
    mockData = { ...reportFixture(), transferConfirmations: transferFixture() };
    render(<DayCloseReportPage />);

    const bucket = screen.getByTestId('day-close-transfer-not-applied');
    expect(bucket).toHaveTextContent(/2 movimientos|2 movements/);
    expect(
      screen.getByTestId('day-close-transfer-not-applied-reason-tender_rejected')
    ).toHaveTextContent(/40[.,]?000/);
    expect(
      screen.getByTestId('day-close-transfer-not-applied-reason-tender_cancelled')
    ).toHaveTextContent(/0/);
    expect(screen.getByTestId('day-close-transfer-not-applied-reason-other')).toHaveTextContent(
      /12[.,]?000/
    );
  });

  it('keeps the frozen destination label and its bank references', () => {
    mockData = { ...reportFixture(), transferConfirmations: transferFixture() };
    render(<DayCloseReportPage />);

    const bank = screen.getByTestId('day-close-transfer-destination-dest-bank');
    expect(bank).toHaveTextContent('Bancolombia ****1234');
    expect(bank).toHaveTextContent('REF-2');
    expect(bank).toHaveTextContent('REF-7');
    expect(bank).toHaveTextContent(/200[.,]?000/);
    expect(bank).toHaveTextContent(/100[.,]?000/);
    expect(screen.getByTestId('day-close-transfer-destination-unlabelled-1')).toHaveTextContent(
      /Destino sin etiqueta|Unlabelled destination/
    );
  });

  it('renders an older snapshot that lacks the newer transfer fields', () => {
    const { superseded: _superseded, notApplied: _notApplied, ...older } = transferFixture();
    mockData = { ...reportFixture(), transferConfirmations: older };
    render(<DayCloseReportPage />);

    expect(screen.getByTestId('day-close-transfer-figure-confirmed')).toHaveTextContent(
      /200[.,]?000/
    );
    expect(screen.getByTestId('day-close-transfer-figure-unapplied')).toHaveTextContent(
      /15[.,]?000/
    );
    expect(screen.queryByTestId('day-close-transfer-figure-superseded')).not.toBeInTheDocument();
    expect(screen.queryByTestId('day-close-transfer-not-applied')).not.toBeInTheDocument();
    expect(screen.getByTestId('day-close-transfer-destination-dest-bank')).toBeInTheDocument();
  });

  it('renders no transfer section when the report carries no block', () => {
    mockData = reportFixture();
    render(<DayCloseReportPage />);
    expect(
      screen.queryByTestId('day-close-transfer-confirmation-section')
    ).not.toBeInTheDocument();
  });

  it('shows an empty state on a day without transfers instead of a header-only table', () => {
    mockData = {
      ...reportFixture(),
      transferConfirmations: {
        saleTotal: 0,
        reported: 0,
        confirmed: 0,
        pending: 0,
        rejected: 0,
        legacy: 0,
        unapplied: 0,
        notApplied: {
          count: 0,
          amount: 0,
          byReason: {
            tender_rejected: { count: 0, amount: 0 },
            tender_cancelled: { count: 0, amount: 0 },
            other: { count: 0, amount: 0 },
          },
        },
        destinations: [],
      },
    };
    render(<DayCloseReportPage />);

    const section = screen.getByTestId('day-close-transfer-confirmation-section');
    expect(section).toHaveTextContent(/Sin transferencias este d[ií]a|No transfers on this day/i);
    expect(screen.queryByTestId('day-close-transfer-destinations')).not.toBeInTheDocument();
  });

  it('leaves cash, expected cash and net revenue untouched when transfers are present', () => {
    mockData = { ...reportFixture(), transferConfirmations: transferFixture() };
    render(<DayCloseReportPage />);

    const cash = screen.getByTestId('day-close-cash-section');
    expect(cash).toHaveTextContent(/600[.,]?000/);
    expect(cash).toHaveTextContent(/595[.,]?000/);
    expect(screen.getByTestId('day-close-report-page')).toHaveTextContent(/1[.,]?021[.,]?000/);
    expect(screen.getByTestId('day-close-sales-section')).toHaveTextContent(/900[.,]?000/);
  });
});
