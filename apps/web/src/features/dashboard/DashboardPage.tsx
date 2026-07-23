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
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CircleCheck,
  DollarSign,
  ShoppingCart,
} from 'lucide-react';
import { Link } from 'react-router-dom';

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
  const headlineMetric = metrics[0];
  const supportingMetrics = metrics.slice(1);

  return (
    <div className="dashboard-command-space">
      <section className="pv-frame pv-reveal" data-testid="dashboard-briefing">
        <div className="pv-frame-core dashboard-briefing">
          <div className="dashboard-briefing-copy">
            <div className="dashboard-live-pill">
              <span className="dashboard-live-dot" aria-hidden="true" />
              <span>{t('page.liveStatus')}</span>
            </div>

            <div className="max-w-2xl">
              <p className="dashboard-eyebrow">{t('page.kicker')}</p>
              <h1 className="dashboard-display-title">{t('page.title')}</h1>
              <p className="dashboard-lede">{t('page.description')}</p>
            </div>

            {headlineMetric && (
              <div className="dashboard-headline-metric">
                <div>
                  <p className="dashboard-headline-label">{headlineMetric.title}</p>
                  <p className="dashboard-headline-value">{headlineMetric.value}</p>
                </div>
                <div className="dashboard-headline-context">
                  <CircleCheck className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                  <span>{headlineMetric.label}</span>
                </div>
              </div>
            )}

            <Link className="pv-action-pill group" to="/sales">
              <span>{t('page.primaryAction')}</span>
              <span className="pv-action-island" aria-hidden="true">
                <ArrowUpRight className="h-4 w-4" strokeWidth={1.7} />
              </span>
            </Link>
          </div>

          <div className="dashboard-briefing-signals">
            <DashboardStatsGrid metrics={supportingMetrics} />
            <div className="dashboard-sync-card">
              <div>
                <p className="dashboard-sync-label">{t('page.freshness.title')}</p>
                <p className="dashboard-sync-time">
                  {t('page.freshness.description', { time: formatDateTime(generatedAt) })}
                </p>
              </div>
              <div className="dashboard-sync-meta">
                <span>{t('page.revenueWindow.value')}</span>
                <span aria-hidden="true">·</span>
                <span>{t('page.focus.value')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="dashboard-primary-grid pv-reveal pv-reveal-delay-1">
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
      <section className="dashboard-analysis pv-reveal pv-reveal-delay-2">
        <header className="dashboard-section-heading">
          <div>
            <p className="dashboard-eyebrow dashboard-eyebrow-light">{t('analysis.kicker')}</p>
            <h2 className="dashboard-section-title">{t('analysis.title')}</h2>
          </div>
          <p className="dashboard-section-description">{t('analysis.description')}</p>
        </header>

        <div className="dashboard-secondary-grid">
          <RecentSalesCard
            sales={recentSales}
            formatCurrency={formatCurrency}
            formatDateTime={formatDateTime}
          />
          <TopProductsCard products={topProducts} formatCurrency={formatCurrency} />
        </div>
      </section>

      {showAnomalyCard && (
        <div className="pv-reveal pv-reveal-delay-3">
          <AnomalyDetectionCard />
        </div>
      )}
    </div>
  );
}
