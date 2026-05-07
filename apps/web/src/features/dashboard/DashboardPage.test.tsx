/**
 * ENG-068 — Dashboard module-gate regression.
 *
 * The anomaly tile calls `ai.anomalies.list`, now guarded by the
 * `anomaly-detection` module. Dashboard must hide the tile when the
 * module is off so a normal dashboard load does not 403.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, useIsModuleActiveMock } = vi.hoisted(() => ({
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
    formatDate: (value: string) => value,
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
          error: null,
          isLoading: false,
          refetch: vi.fn(),
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

describe('DashboardPage module gates', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useIsModuleActiveMock.mockReset();
    useAuthMock.mockReturnValue({
      user: { id: 'u-1', role: 'manager' },
    });
  });

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
