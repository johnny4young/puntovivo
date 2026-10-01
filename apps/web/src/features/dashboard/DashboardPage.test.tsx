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

const { useAuthMock, useIsModuleActiveMock, dashboardError, refetchMock } = vi.hoisted(() => ({
  dashboardError: { current: null as null | { message: string; data: { errorCode: string } } },
  refetchMock: vi.fn(),
  useAuthMock: vi.fn(),
  useIsModuleActiveMock: vi.fn(),
}));

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
  DashboardStatsGrid: () => <div data-testid="dashboard-stats" />,
  LowStockAlertsCard: () => <div data-testid="low-stock-card" />,
  RecentSalesCard: () => <div data-testid="recent-sales-card" />,
  RevenueTrendCard: () => <div data-testid="revenue-trend-card" />,
  TopProductsCard: () => <div data-testid="top-products-card" />,
}));

vi.mock('@/features/dashboard/AnomalyDetectionCard', () => ({
  AnomalyDetectionCard: () => <div data-testid="anomaly-card" />,
}));

import { DashboardPage } from './DashboardPage';

beforeEach(() => {
  dashboardError.current = null;
  refetchMock.mockReset();
  useAuthMock.mockReset();
  useIsModuleActiveMock.mockReset();
  useAuthMock.mockReturnValue({
    user: { id: 'u-1', role: 'manager' },
  });
});

describe('DashboardPage module gates', () => {
  it('hides the anomaly card when anomaly-detection is deactivated', () => {
    useIsModuleActiveMock.mockReturnValue(false);

    render(<DashboardPage />);

    expect(screen.queryByTestId('anomaly-card')).not.toBeInTheDocument();
    expect(useIsModuleActiveMock).toHaveBeenCalledWith('anomaly-detection');
  });

  it('shows the anomaly card for manager+ when anomaly-detection is active', () => {
    useIsModuleActiveMock.mockReturnValue(true);

    render(<DashboardPage />);

    expect(screen.getByTestId('anomaly-card')).toBeInTheDocument();
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
      'La zona horaria de la empresa no es válida. Pide a un administrador que corrija o borre la zona horaria personalizada en Empresa y vuelve a intentar.',
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
