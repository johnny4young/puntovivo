import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { DayCloseReportPage } from './DayCloseReportPage';

const refetch = vi.fn();
const signoffRefetch = vi.fn();
const invalidateSignoff = vi.fn();
const signOff = vi.fn();
let mockPending = false;
let mockError: Error | null = null;
let mockData: ReturnType<typeof reportFixture> | undefined;
let mockSignoff: ReturnType<typeof signoffFixture> | null = null;
let mockSignoffPending = false;
let mockSignoffError: Error | null = null;

vi.mock('@/lib/trpc', () => ({
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
      blockers: ['open_sessions' as const],
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

describe('DayCloseReportPage (ENG-141a/ENG-141b)', () => {
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
});
