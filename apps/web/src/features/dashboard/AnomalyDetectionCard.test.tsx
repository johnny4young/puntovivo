import { render, screen } from '@/test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';

import { AnomalyDetectionCard } from './AnomalyDetectionCard';

const mocks = vi.hoisted(() => ({
  anomaliesQuery: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ai: {
      anomalies: {
        list: { useQuery: () => mocks.anomaliesQuery() },
      },
    },
  },
}));

// AnomalyDetailsModal calls useTenantSettings which requires the
// TenantProvider tree; the test wrapper does not include it (test
// utils only mount QueryClient + MemoryRouter), so we mock the hook.
vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');
  return {
    ...actual,
    useTenantSettings: () => ({
      formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
      formatDate: (iso: string) => iso.slice(0, 10),
      formatDateTime: (iso: string) => iso.slice(0, 16).replace('T', ' '),
    }),
  };
});

const baseAnomalies = {
  enabled: true,
  alerts: [],
  totalCount: 0,
  severityCounts: { medium: 0, high: 0 },
  kindCounts: {
    ticketsPerHourSpike: 0,
    voidRate: 0,
    refundAmount: 0,
    noSaleSessions: 0,
  },
  computedAt: '2026-04-30T12:00:00.000Z',
};

beforeEach(async () => {
  await i18next.changeLanguage('en');
  vi.clearAllMocks();
});

describe('AnomalyDetectionCard', () => {
  it('renders the loading state while either query is loading', () => {
    mocks.anomaliesQuery.mockReturnValue({ isLoading: true, data: undefined });
    render(<AnomalyDetectionCard />);
    expect(screen.getByText(/Computing anomalies/i)).toBeInTheDocument();
  });

  it('renders the disabled state with a settings link when ai.enabled is false', () => {
    mocks.anomaliesQuery.mockReturnValue({
      isLoading: false,
      data: { ...baseAnomalies, enabled: false },
    });
    render(<AnomalyDetectionCard />);
    expect(screen.getByText(/AI features are turned off/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /AI settings/i })).toHaveAttribute('href', '/company');
  });

  it('renders the empty state when there are zero alerts', () => {
    mocks.anomaliesQuery.mockReturnValue({ isLoading: false, data: baseAnomalies });
    render(<AnomalyDetectionCard />);
    expect(screen.getByText(/No anomalies detected/i)).toBeInTheDocument();
  });

  it('renders the has-alerts state with severity pills + counter + view-details button', () => {
    mocks.anomaliesQuery.mockReturnValue({
      isLoading: false,
      data: {
        ...baseAnomalies,
        alerts: [
          {
            id: 'a1',
            kind: 'voidRate',
            cashierId: 'u1',
            cashierName: 'Carlos',
            severity: 'high',
            observed: 0.5,
            baselineMean: 0.05,
            baselineStdDev: 0.01,
            distance: 99,
            occurredAt: '2026-04-30T12:00:00.000Z',
            evidenceRef: null,
          },
          {
            id: 'a2',
            kind: 'noSaleSessions',
            cashierId: 'u2',
            cashierName: 'Andrés',
            severity: 'medium',
            observed: 8,
            baselineMean: 2,
            baselineStdDev: 1,
            distance: 4,
            occurredAt: '2026-04-30T12:00:00.000Z',
            evidenceRef: null,
          },
        ],
        totalCount: 2,
        severityCounts: { medium: 1, high: 1 },
        kindCounts: {
          ticketsPerHourSpike: 0,
          voidRate: 1,
          refundAmount: 0,
          noSaleSessions: 1,
        },
      },
    });
    render(<AnomalyDetectionCard />);
    expect(screen.getByTestId('anomaly-summary')).toHaveTextContent(/2 alerts/i);
    expect(screen.getByTestId('anomaly-pill-high')).toHaveTextContent(/High/);
    expect(screen.getByTestId('anomaly-pill-medium')).toHaveTextContent(/Medium/);
    expect(screen.getByRole('button', { name: /View details/i })).toBeInTheDocument();
  });

  it('renders the error state when the anomalies query fails', () => {
    mocks.anomaliesQuery.mockReturnValue({
      isLoading: false,
      data: undefined,
      error: new Error('boom'),
    });
    render(<AnomalyDetectionCard />);
    expect(screen.getByText(/Could not load anomalies/i)).toBeInTheDocument();
  });
});
