import {
  DashboardLoadingState,
  DashboardStatsGrid,
  LowStockAlertsCard,
  RecentSalesCard,
  RevenueTrendCard,
  TopProductsCard,
} from '@/features/dashboard/DashboardPanels';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useTenantSettings } from '@/hooks';
import { trpc } from '@/lib/trpc';

export function DashboardPage() {
  const { formatCurrency, formatDate, formatDateTime } = useTenantSettings();
  const dashboardQuery = trpc.dashboard.summary.useQuery();

  if (dashboardQuery.isLoading) {
    return <DashboardLoadingState title="Dashboard" />;
  }

  if (dashboardQuery.error) {
    return (
      <QueryErrorState
        title="Unable to load dashboard"
        message={dashboardQuery.error.message}
        onRetry={() => {
          void dashboardQuery.refetch();
        }}
      />
    );
  }

  const data = dashboardQuery.data;
  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Dashboard</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Live reporting across sales, stock pressure, and 30-day revenue activity.
          </p>
        </div>
        <p className="text-xs text-secondary-500">Updated {formatDateTime(data.generatedAt)}</p>
      </div>

      <DashboardStatsGrid stats={data.stats} formatCurrency={formatCurrency} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RevenueTrendCard
          points={data.revenueChart}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
        />
        <LowStockAlertsCard items={data.lowStockItems} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentSalesCard
          sales={data.recentSales}
          formatCurrency={formatCurrency}
          formatDateTime={formatDateTime}
        />
        <TopProductsCard products={data.topProducts} formatCurrency={formatCurrency} />
      </div>
    </div>
  );
}
