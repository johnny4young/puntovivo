import { useTranslation } from 'react-i18next';
import {
  DashboardLoadingState,
  DashboardStatsGrid,
  type DashboardStatMetric,
  LowStockAlertsCard,
  RecentSalesCard,
  RevenueTrendCard,
  TopProductsCard,
} from '@/features/dashboard/DashboardPanels';
import { AnomalyDetectionCard } from '@/features/dashboard/AnomalyDetectionCard';
import { useAuth } from '@/features/auth/AuthProvider';
import { managerOrAdminRoles } from '@/features/auth/roleAccess';
import { useIsModuleActive } from '@/features/modules';
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

function getMetricLabel(_metric: unknown, fallback: string) {
  return fallback;
}

function getStatMetric(
  stats: Record<string, unknown>,
  primaryKey: string,
  fallbackKey: string
): unknown {
  return primaryKey in stats ? stats[primaryKey] : stats[fallbackKey];
}

export function DashboardPage() {
  const { formatCurrency, formatDate, formatDateTime } = useTenantSettings();
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const anomalyModuleActive = useIsModuleActive('anomaly-detection');
  // + : anomaly detection is manager+ AND module-gated.
  // Do not render a card that would always call a gated procedure and
  // return MODULE_NOT_ACTIVATED/role FORBIDDEN for the current user.
  const showAnomalyCard = user
    ? (managerOrAdminRoles as readonly string[]).includes(user.role) && anomalyModuleActive
    : false;
  const dashboardQuery = trpc.dashboard.summary.useQuery();

  if (dashboardQuery.isLoading) {
    return <DashboardLoadingState title={t('page.kicker')} />;
  }

  if (dashboardQuery.error) {
    return (
      <QueryErrorState
        title={t('page.kicker')}
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

  const stats: Record<string, unknown> = isObject(data) && isObject(data.stats) ? data.stats : {};

  const metrics: DashboardStatMetric[] = [
    {
      title: t('metrics.todaySales.title'),
      value: formatCurrency(getMetricValue(getStatMetric(stats, 'todayRevenue', 'revenue'))),
      label: getMetricLabel(
        getStatMetric(stats, 'todayRevenue', 'revenue'),
        t('metrics.todaySales.fallbackLabel')
      ),
      icon: DollarSign,
      tone: 'success',
      mono: true,
    },
    {
      title: t('metrics.ordersToday.title'),
      value: getMetricValue(getStatMetric(stats, 'todayOrders', 'orders')).toLocaleString(),
      label: getMetricLabel(
        getStatMetric(stats, 'todayOrders', 'orders'),
        t('metrics.ordersToday.fallbackLabel')
      ),
      icon: ShoppingCart,
      tone: 'primary',
    },
    {
      title: t('metrics.lowStockAlerts.title'),
      value: getMetricValue(getStatMetric(stats, 'lowStockCount', 'products')).toLocaleString(),
      label: getMetricLabel(
        getStatMetric(stats, 'lowStockCount', 'products'),
        t('metrics.lowStockAlerts.fallbackLabel')
      ),
      icon: AlertTriangle,
      tone: 'danger',
    },
    {
      title: t('metrics.thirtyDayRevenue.title'),
      value: formatCurrency(getMetricValue(getStatMetric(stats, 'revenueThirtyDays', 'revenue'))),
      label: getMetricLabel(
        getStatMetric(stats, 'revenueThirtyDays', 'revenue'),
        t('metrics.thirtyDayRevenue.fallbackLabel')
      ),
      icon: BarChart3,
      tone: 'ink',
      mono: true,
    },
  ];

  const revenueChart = Array.isArray(data.revenueChart) ? data.revenueChart : [];
  const lowStockItems = Array.isArray(data.lowStockItems) ? data.lowStockItems : [];
  const recentSales = Array.isArray(data.recentSales) ? data.recentSales : [];
  const topProducts = Array.isArray(data.topProducts) ? data.topProducts : [];
  const generatedAt =
    typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString();

  return (
    <div className="space-y-6">
      <section className="hero-surface p-6 sm:p-8">
        <div className="relative z-10 grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(17rem,20rem)] xl:items-start">
          <div className="space-y-4">
            <DashboardStatsGrid metrics={metrics} />
          </div>

          <div className="card-inset space-y-4 p-5">
            <div>
              <h2 className="text-xl font-semibold text-secondary-950">
                {t('page.freshness.title')}
              </h2>
              <p className="mt-2 text-sm text-secondary-600">
                {t('page.freshness.description', { time: formatDateTime(generatedAt) })}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="metric-tile p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                  {t('page.revenueWindow.label')}
                </p>
                <p className="mt-2 text-base font-semibold text-secondary-950">
                  {t('page.revenueWindow.value')}
                </p>
              </div>
              <div className="metric-tile p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                  {t('page.focus.label')}
                </p>
                <p className="mt-2 text-base font-semibold text-secondary-950">
                  {t('page.focus.value')}
                </p>
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

      {/* Sección secundaria de análisis: las tarjetas de ventas recientes y
          productos destacados viven al fondo, separadas del core (KPIs +
          tendencia + reposición) que encabeza la página. */}
      <section className="space-y-4">
        <header>
          <p className="pv-kicker">{t('analysis.kicker')}</p>
          <h2 className="pv-title text-2xl">{t('analysis.title')}</h2>
        </header>

        <div className="grid gap-6 xl:grid-cols-2">
          <RecentSalesCard
            sales={recentSales}
            formatCurrency={formatCurrency}
            formatDateTime={formatDateTime}
          />
          <TopProductsCard products={topProducts} formatCurrency={formatCurrency} />
        </div>
      </section>

      {showAnomalyCard && <AnomalyDetectionCard />}
    </div>
  );
}
