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
import { AlertTriangle, BarChart3, DollarSign, Package, ShoppingCart, Users } from 'lucide-react';

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

  if ('todayRevenue' in stats && 'todayOrders' in stats && 'lowStockCount' in stats) {
    return [
      {
        title: "Today's Sales",
        value: formatCurrency(getMetricValue(stats.todayRevenue)),
        label: getMetricLabel(stats.todayRevenue, 'completed sales today'),
        icon: DollarSign,
        iconColor: 'bg-success-500',
      },
      {
        title: 'Orders Today',
        value: getMetricValue(stats.todayOrders).toLocaleString(),
        label: getMetricLabel(stats.todayOrders, 'completed orders today'),
        icon: ShoppingCart,
        iconColor: 'bg-primary-500',
      },
      {
        title: 'Low Stock Alerts',
        value: getMetricValue(stats.lowStockCount).toLocaleString(),
        label: getMetricLabel(stats.lowStockCount, 'products at or below min stock'),
        icon: AlertTriangle,
        iconColor: 'bg-warning-500',
      },
      {
        title: '30-Day Revenue',
        value: formatCurrency(getMetricValue(stats.revenueThirtyDays)),
        label: getMetricLabel(stats.revenueThirtyDays, 'completed sales over the last 30 days'),
        icon: BarChart3,
        iconColor: 'bg-secondary-500',
      },
    ];
  }

  return [
    {
      title: 'Revenue',
      value: formatCurrency(getMetricValue(stats.revenue)),
      label: getMetricLabel(stats.revenue, 'vs last month'),
      icon: DollarSign,
      iconColor: 'bg-success-500',
    },
    {
      title: 'Orders',
      value: getMetricValue(stats.orders).toLocaleString(),
      label: getMetricLabel(stats.orders, 'vs last month'),
      icon: ShoppingCart,
      iconColor: 'bg-primary-500',
    },
    {
      title: 'Customers',
      value: getMetricValue(stats.customers).toLocaleString(),
      label: getMetricLabel(stats.customers, 'new this month vs last month'),
      icon: Users,
      iconColor: 'bg-warning-500',
    },
    {
      title: 'Products',
      value: getMetricValue(stats.products).toLocaleString(),
      label: getMetricLabel(stats.products, 'added this month vs last month'),
      icon: Package,
      iconColor: 'bg-secondary-500',
    },
  ];
}

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

  const metrics = buildDashboardMetrics(data, formatCurrency);
  const revenueChart = Array.isArray(data.revenueChart) ? data.revenueChart : [];
  const lowStockItems = Array.isArray(data.lowStockItems) ? data.lowStockItems : [];
  const recentSales = Array.isArray(data.recentSales) ? data.recentSales : [];
  const topProducts = Array.isArray(data.topProducts) ? data.topProducts : [];
  const generatedAt = typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Dashboard</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Live reporting across sales, stock pressure, and 30-day revenue activity.
          </p>
        </div>
        <p className="text-xs text-secondary-500">Updated {formatDateTime(generatedAt)}</p>
      </div>

      <DashboardStatsGrid metrics={metrics} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RevenueTrendCard points={revenueChart} formatCurrency={formatCurrency} formatDate={formatDate} />
        <LowStockAlertsCard items={lowStockItems} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentSalesCard sales={recentSales} formatCurrency={formatCurrency} formatDateTime={formatDateTime} />
        <TopProductsCard products={topProducts} formatCurrency={formatCurrency} />
      </div>
    </div>
  );
}
