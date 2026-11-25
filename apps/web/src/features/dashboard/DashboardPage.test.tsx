/**
 * Dashboard module-gate regression.
 *
 * The anomaly tile calls `ai.anomalies.list`, now guarded by the
 * `anomaly-detection` module. Dashboard must hide the tile when the
 * module is off so a normal dashboard load does not 403.
 */

import { act, render, screen } from '@/test/utils';
import i18n from '@/i18n';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, useIsModuleActiveMock, dashboardError, refetchMock, todayData } = vi.hoisted(
  () => ({
    todayData: { current: undefined as undefined | { generatedAt: string } },
    dashboardError: { current: null as null | { message: string; data: { errorCode: string } } },
    refetchMock: vi.fn(),
    useAuthMock: vi.fn(),
    useIsModuleActiveMock: vi.fn(),
  })
);

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/features/modules', () => ({
  useIsModuleActive: useIsModuleActiveMock,
}));

vi.mock('@/hooks', () => ({
  useTenantSettings: () => ({
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
    formatDateTime: (value: string) => value,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    operations: {
      today: { useQuery: () => ({ data: todayData.current }) },
    },
    dashboard: {
      summary: {
        useQuery: () => ({
          data: {
            stats: {
              todayRevenue: { value: 100 },
              todayOrders: { value: 2 },
              lowStockCount: { value: 1 },
              revenueThirtyDays: { value: 3000 },
            },
            revenueChart: [],
            lowStockItems: [],
            recentSales: [],
            topProducts: [],
            generatedAt: '2026-05-07T00:00:00.000Z',
          },
          error: dashboardError.current,
          isLoading: false,
          refetch: refetchMock,
        }),
      },
    },
  },
}));

vi.mock('@/features/dashboard/DashboardPanels', () => ({
  DashboardLoadingState: () => <div data-testid="dashboard-loading" />,
  DashboardStatsGrid: ({ metrics }: { metrics: Array<{ title: string }> }) => (
    <div data-testid="dashboard-stats">{metrics.map(metric => metric.title).join(' | ')}</div>
  ),
  LowStockAlertsCard: () => <div data-testid="low-stock-card" />,
  RecentSalesCard: () => <div data-testid="recent-sales-card" />,
  RevenueTrendCard: ({ hideLatestDay }: { hideLatestDay?: boolean }) => (
    <div data-testid="revenue-trend-card" data-hide-latest-day={String(Boolean(hideLatestDay))} />
  ),
  TopProductsCard: () => <div data-testid="top-products-card" />,
}));

vi.mock('@/features/fiscal/NumberingAlertBanner', () => ({
  NumberingAlertBanner: () => null,
}));
vi.mock('@/features/dashboard/AnomalyDetectionCard', () => ({
  AnomalyDetectionCard: () => <div data-testid="anomaly-card" />,
}));
vi.mock('@/features/dashboard/today/TodayOverview', () => ({
  TodayOverview: () => <div data-testid="today-overview" />,
}));

import { DashboardPage } from './DashboardPage';

beforeEach(() => {
  dashboardError.current = null;
  todayData.current = { generatedAt: '2026-05-07T00:00:00.000Z' };
  refetchMock.mockReset();
  useAuthMock.mockReset();
  useIsModuleActiveMock.mockReset();
  useAuthMock.mockReturnValue({
    user: { id: 'u-1', role: 'manager' },
  });
});

describe('DashboardPage module gates', () => {
  it('hides the anomaly card when anomaly-detection is deactivated', async () => {
    useIsModuleActiveMock.mockReturnValue(false);

    render(<DashboardPage />);
    await screen.findByTestId('today-overview');

    expect(screen.queryByTestId('anomaly-card')).not.toBeInTheDocument();
    expect(useIsModuleActiveMock).toHaveBeenCalledWith('anomaly-detection');
  });

  it('shows the anomaly card for manager+ when anomaly-detection is active', async () => {
    useIsModuleActiveMock.mockReturnValue(true);

    render(<DashboardPage />);
    await screen.findByTestId('today-overview');

    expect(screen.getByTestId('anomaly-card')).toBeInTheDocument();
  });
});

describe('DashboardPage audience', () => {
  it('opens on the manager day for managers and keeps the rest of the dashboard below', async () => {
    useIsModuleActiveMock.mockReturnValue(false);
    render(<DashboardPage />);
    expect(await screen.findByTestId('today-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-briefing')).not.toBeInTheDocument();
    // Hoy already shows today's sales, so the 30-day card drops its latest-day figure.
    expect(screen.getByTestId('revenue-trend-card')).toHaveAttribute(
      'data-hide-latest-day',
      'true'
    );
    expect(screen.getByTestId('low-stock-card')).toBeInTheDocument();
  });

  it('keeps the latest-day figure while Hoy has no day to show', async () => {
    todayData.current = undefined;
    useIsModuleActiveMock.mockReturnValue(false);
    render(<DashboardPage />);
    await screen.findByTestId('today-overview');
    expect(screen.getByTestId('revenue-trend-card')).toHaveAttribute(
      'data-hide-latest-day',
      'false'
    );
  });

  it('keeps the read-only briefing for viewers', () => {
    useIsModuleActiveMock.mockReturnValue(false);
    useAuthMock.mockReturnValue({ user: { id: 'u-2', role: 'viewer' } });
    render(<DashboardPage />);
    expect(screen.getByTestId('dashboard-briefing')).toBeInTheDocument();
    expect(screen.queryByTestId('today-overview')).not.toBeInTheDocument();
    // The count metric counts completed sales, not purchase or customer orders.
    expect(screen.getByTestId('dashboard-stats')).toHaveTextContent('Sales count today');
    expect(screen.getByTestId('dashboard-stats')).not.toHaveTextContent(/orders/i);
    // Viewers cannot open a till, so the briefing offers no way into sales.
    expect(
      screen.queryByRole('link', { name: /go to sales|ir a ventas/i })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('revenue-trend-card')).toHaveAttribute(
      'data-hide-latest-day',
      'false'
    );
  });
});

describe('DashboardPage timezone recovery', () => {
  it.each([
    [
      'en',
      'The company time zone is invalid. Ask an administrator to correct or clear the time zone override in Company settings, then retry.',
    ],
    [
      'es',
      'La zona horaria de la empresa no es válida. Pida a un administrador que corrija o borre la zona horaria personalizada en Empresa y vuelva a intentar.',
    ],
  ])(
    'shows actionable localized configuration errors in %s, not stale totals',
    async (locale, message) => {
      await act(async () => {
        await i18n.changeLanguage(locale);
      });
      dashboardError.current = {
        message: 'Private timezone diagnostic',
        data: { errorCode: 'TENANT_TIMEZONE_INVALID' },
      };
      try {
        const user = userEvent.setup();
        render(<DashboardPage />);
        expect(screen.getByText(message)).toBeInTheDocument();
        expect(screen.queryByText('Private timezone diagnostic')).not.toBeInTheDocument();
        expect(screen.queryByTestId('dashboard-stats')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button'));
        expect(refetchMock).toHaveBeenCalledOnce();
      } finally {
        dashboardError.current = null;
        refetchMock.mockReset();
        await act(async () => {
          await i18n.changeLanguage('en');
        });
      }
    }
  );
});
