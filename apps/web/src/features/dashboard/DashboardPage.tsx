import {
  DashboardLoadingState,
  DashboardStatsGrid,
  type DashboardStatMetric,
  LowStockAlertsCard,
  RecentSalesCard,
  RevenueTrendCard,
  TopProductsCard,
} from '@/features/dashboard/DashboardPanels';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useTenantSettings } from '@/hooks';
import { trpc } from '@/lib/trpc';
import { AlertTriangle, BarChart3, DollarSign, ShoppingCart } from 'lucide-react';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getMetricValue(metric: unknown) {
  if (!isObject(metric)) {
    return 0;
  }

  const value = metric.value;
  return typeof value === 'number' ? value : 0;
}

function getMetricLabel(metric: unknown, fallback: string) {
  if (!isObject(metric)) {
    return fallback;
  }

  return typeof metric.label === 'string' ? metric.label : fallback;
}

function buildDashboardMetrics(
  summary: unknown,
  formatCurrency: (amount: number) => string
): DashboardStatMetric[] {
  const stats = isObject(summary) && isObject(summary.stats) ? summary.stats : {};

  return [
    {
      title: "Today's Sales",
      value: formatCurrency(getMetricValue('todayRevenue' in stats ? stats.todayRevenue : stats.revenue)),
      label: getMetricLabel(
        'todayRevenue' in stats ? stats.todayRevenue : stats.revenue,
        'completed sales in the active tenant'
      ),
      icon: DollarSign,
      tone: 'success',
    },
    {
      title: 'Orders Today',
      value: getMetricValue('todayOrders' in stats ? stats.todayOrders : stats.orders).toLocaleString(),
      label: getMetricLabel(
        'todayOrders' in stats ? stats.todayOrders : stats.orders,
        'completed orders today'
      ),
      icon: ShoppingCart,
      tone: 'primary',
    },
    {
      title: 'Low Stock Alerts',
      value: getMetricValue('lowStockCount' in stats ? stats.lowStockCount : stats.products).toLocaleString(),
      label: getMetricLabel(
        'lowStockCount' in stats ? stats.lowStockCount : stats.products,
        'products at or below minimum stock'
      ),
      icon: AlertTriangle,
      tone: 'warning',
    },
    {
      title: '30-Day Revenue',
      value: formatCurrency(
        getMetricValue('revenueThirtyDays' in stats ? stats.revenueThirtyDays : stats.revenue)
      ),
      label: getMetricLabel(
        'revenueThirtyDays' in stats ? stats.revenueThirtyDays : stats.revenue,
        'completed sales over the last 30 days'
      ),
      icon: BarChart3,
      tone: 'ink',
    },
  ];
}

export function DashboardPage() {
  const { formatCurrency, formatDate, formatDateTime } = useTenantSettings();
  const dashboardQuery = trpc.dashboard.summary.useQuery();

  if (dashboardQuery.isLoading) {
    return <DashboardLoadingState title="Command center" />;
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

  const metrics = buildDashboardMetrics(data, formatCurrency);
  const revenueChart = Array.isArray(data.revenueChart) ? data.revenueChart : [];
  const lowStockItems = Array.isArray(data.lowStockItems) ? data.lowStockItems : [];
  const recentSales = Array.isArray(data.recentSales) ? data.recentSales : [];
  const topProducts = Array.isArray(data.topProducts) ? data.topProducts : [];
  const generatedAt = typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString();

  return (
    <div className="space-y-6">
      <section className="hero-surface p-6 sm:p-8">
        <div className="relative z-10 grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="page-kicker">Command center</p>
              <h1 className="font-display text-5xl leading-[0.92] text-balance text-secondary-950">
                Live pulse for checkout, revenue, and stock pressure.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-secondary-600">
                Watch completed sales, low-stock pressure, and top-moving products without leaving the
                operating workspace.
              </p>
            </div>

            <DashboardStatsGrid metrics={metrics} />
          </div>

          <div className="card-inset flex flex-col justify-between gap-5 p-5 sm:p-6">
            <div>
              <p className="page-kicker text-[0.62rem] tracking-[0.24em]">System freshness</p>
              <h2 className="mt-3 font-display text-3xl text-secondary-950">Snapshot aligned</h2>
              <p className="mt-3 text-sm leading-6 text-secondary-600">
                This tenant dashboard was refreshed at {formatDateTime(generatedAt)} and includes
                completed-sale metrics plus current low-stock attention points.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="metric-tile">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                  Revenue window
                </p>
                <p className="mt-3 text-lg font-semibold text-secondary-950">Last 30 days</p>
              </div>
              <div className="metric-tile">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                  Focus
                </p>
                <p className="mt-3 text-lg font-semibold text-secondary-950">Sales + replenishment</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <RevenueTrendCard
          points={revenueChart}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
        />
        <LowStockAlertsCard items={lowStockItems} />
      </div>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <RecentSalesCard
          sales={recentSales}
          formatCurrency={formatCurrency}
          formatDateTime={formatDateTime}
        />
        <TopProductsCard products={topProducts} formatCurrency={formatCurrency} />
      </div>
    </div>
  );
}
