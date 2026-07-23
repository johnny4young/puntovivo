import { ArrowRight, ArrowUpRight, Package, ReceiptText, TrendingUp } from 'lucide-react';
import type { ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

type DashboardSummary = inferRouterOutputs<AppRouter>['dashboard']['summary'];

interface DashboardLoadingStateProps {
  title: string;
}

interface DashboardStatsGridProps {
  metrics: DashboardStatMetric[];
}

interface RevenueTrendCardProps {
  points: DashboardSummary['revenueChart'];
  formatCurrency: (amount: number) => string;
  formatDate: (date: Date | string) => string;
}

interface RecentSalesCardProps {
  sales: DashboardSummary['recentSales'];
  formatCurrency: (amount: number) => string;
  formatDateTime: (date: Date | string) => string;
}

interface TopProductsCardProps {
  products: DashboardSummary['topProducts'];
  formatCurrency: (amount: number) => string;
}

interface LowStockAlertsCardProps {
  items: DashboardSummary['lowStockItems'];
}

export interface DashboardStatMetric {
  title: string;
  value: string;
  label: string;
  icon: ElementType;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'ink';
  mono?: boolean;
}

const DASHBOARD_STAT_SKELETON_KEYS = ['orders', 'stock', 'revenue'] as const;
const DASHBOARD_LIST_SKELETON_KEYS = ['first', 'second', 'third', 'fourth'] as const;

export function DashboardLoadingState({ title }: DashboardLoadingStateProps) {
  return (
    <div className="dashboard-command-space" aria-label={title}>
      <section className="pv-frame animate-soft-fade">
        <div className="pv-frame-core dashboard-briefing min-h-[34rem]">
          <div className="dashboard-briefing-copy">
            <div className="animate-shimmer h-7 w-36 rounded-full" />
            <div className="animate-shimmer mt-8 h-16 max-w-xl rounded-[24px]" />
            <div className="animate-shimmer mt-4 h-5 max-w-lg rounded-full" />
            <div className="animate-shimmer mt-12 h-20 w-72 rounded-[24px]" />
            <div className="animate-shimmer mt-8 h-12 w-44 rounded-full" />
          </div>
          <div className="dashboard-briefing-signals">
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              {DASHBOARD_STAT_SKELETON_KEYS.map(key => (
                <div key={key} className="dashboard-signal-card min-h-32">
                  <div className="animate-shimmer h-10 w-10 rounded-2xl" />
                  <div className="animate-shimmer mt-5 h-8 w-28 rounded-xl" />
                  <div className="animate-shimmer mt-3 h-3 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="dashboard-primary-grid">
        <div className="pv-frame min-h-[31rem]">
          <div className="pv-frame-core h-full bg-card p-6">
            <div className="animate-shimmer h-6 w-48 rounded-full" />
            <div className="animate-shimmer mt-7 h-80 rounded-[26px]" />
          </div>
        </div>
        <div className="pv-frame min-h-[31rem]">
          <div className="pv-frame-core h-full bg-card p-6">
            <div className="animate-shimmer h-6 w-40 rounded-full" />
            <div className="mt-7 space-y-3">
              {DASHBOARD_LIST_SKELETON_KEYS.map(key => (
                <div key={key} className="animate-shimmer h-20 rounded-[22px]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardStatsGrid({ metrics }: DashboardStatsGridProps) {
  return (
    <div className="dashboard-signal-grid">
      {metrics.map(metric => (
        <article key={metric.title} className="dashboard-signal-card" data-tone={metric.tone}>
          <div className="dashboard-signal-topline">
            <span className="dashboard-signal-icon">
              <metric.icon className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span className="dashboard-signal-rule" aria-hidden="true" />
          </div>
          <p className="dashboard-signal-label">{metric.title}</p>
          <p
            className={metric.mono ? 'dashboard-signal-value font-mono' : 'dashboard-signal-value'}
          >
            {metric.value}
          </p>
          <p className="dashboard-signal-context">{metric.label}</p>
        </article>
      ))}
    </div>
  );
}

function buildChartGeometry(points: RevenueTrendCardProps['points']) {
  const maxRevenue = points.reduce((highest, point) => Math.max(highest, point.revenue), 0);
  const denominator = Math.max(points.length - 1, 1);
  const coordinates = points.map((point, index) => ({
    x: (index / denominator) * 100,
    y: 35 - (maxRevenue === 0 ? 0 : (point.revenue / maxRevenue) * 29),
    point,
  }));
  const line = coordinates.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = coordinates.length > 0 ? `0,38 ${line} 100,38` : '';
  return { coordinates, line, area };
}

export function RevenueTrendCard({ points, formatCurrency, formatDate }: RevenueTrendCardProps) {
  const { t } = useTranslation('dashboard');
  const firstPoint = points.at(0);
  const lastPoint = points.at(-1);
  const totalRevenue = points.reduce((total, point) => total + point.revenue, 0);
  const totalOrders = points.reduce((total, point) => total + point.orders, 0);
  const bestPoint = points.reduce<(typeof points)[number] | undefined>(
    (best, point) => (!best || point.revenue > best.revenue ? point : best),
    undefined
  );
  const chart = buildChartGeometry(points);

  return (
    <section className="pv-frame dashboard-revenue-frame">
      <div className="pv-frame-core dashboard-panel dashboard-revenue-panel">
        <header className="dashboard-panel-heading">
          <div>
            <p className="dashboard-eyebrow dashboard-eyebrow-light">{t('revenue.kicker')}</p>
            <h2 className="dashboard-panel-title">{t('revenue.title')}</h2>
            <p className="dashboard-panel-description">{t('revenue.description')}</p>
          </div>
          <div className="dashboard-latest-value">
            <span>{t('revenue.latestDay')}</span>
            <strong>{formatCurrency(lastPoint?.revenue ?? 0)}</strong>
          </div>
        </header>

        <div className="dashboard-chart-wrap">
          {points.length === 0 ? (
            <div className="dashboard-empty-chart">{t('revenue.empty')}</div>
          ) : (
            <svg
              className="dashboard-revenue-chart"
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              role="img"
              aria-label={t('revenue.chartLabel')}
            >
              <defs>
                <linearGradient id="dashboard-revenue-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary-500)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--primary-500)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[8, 18, 28, 38].map(y => (
                <line key={y} x1="0" x2="100" y1={y} y2={y} className="dashboard-chart-grid" />
              ))}
              <polygon points={chart.area} fill="url(#dashboard-revenue-fill)" />
              <polyline points={chart.line} className="dashboard-chart-line" />
              {chart.coordinates.map(({ x, y, point }, index) => (
                <circle
                  key={point.date}
                  cx={x}
                  cy={y}
                  r={index === chart.coordinates.length - 1 ? 1.25 : 0.55}
                  className="dashboard-chart-point"
                >
                  <title>
                    {formatDate(point.date)} · {formatCurrency(point.revenue)} ·{' '}
                    {t('ordersCount', { count: point.orders })}
                  </title>
                </circle>
              ))}
            </svg>
          )}
          <div className="dashboard-chart-axis" aria-hidden="true">
            <span>{firstPoint ? formatDate(firstPoint.date) : ''}</span>
            <span>{lastPoint ? formatDate(lastPoint.date) : ''}</span>
          </div>
        </div>

        <div className="dashboard-chart-summary">
          <div>
            <span>{t('revenue.periodTotal')}</span>
            <strong>{formatCurrency(totalRevenue)}</strong>
          </div>
          <div>
            <span>{t('revenue.periodOrders')}</span>
            <strong>{totalOrders.toLocaleString()}</strong>
          </div>
          <div>
            <span>{t('revenue.bestDay')}</span>
            <strong>{bestPoint ? formatDate(bestPoint.date) : '—'}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

export function RecentSalesCard({ sales, formatCurrency, formatDateTime }: RecentSalesCardProps) {
  const { t } = useTranslation('dashboard');
  const translateCustomerName = (customerName: string) =>
    customerName === 'Walk-in customer' ? t('recentSales.walkIn') : customerName;
  const translateCustomerEmail = (customerEmail: string) =>
    customerEmail === 'No email' ? t('recentSales.noEmail') : customerEmail;

  return (
    <section className="pv-frame">
      <div className="pv-frame-core dashboard-panel">
        <header className="dashboard-list-heading">
          <div className="dashboard-list-icon" aria-hidden="true">
            <ReceiptText className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <p className="dashboard-eyebrow dashboard-eyebrow-light">{t('recentSales.kicker')}</p>
            <h2 className="dashboard-panel-title">{t('recentSales.title')}</h2>
          </div>
        </header>

        {sales.length === 0 ? (
          <div className="dashboard-list-empty">{t('recentSales.empty')}</div>
        ) : (
          <div className="dashboard-activity-list">
            {sales.map((sale, index) => (
              <article key={sale.id} className="dashboard-activity-row">
                <span className="dashboard-row-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="dashboard-activity-dot" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-secondary-950">
                      {translateCustomerName(sale.customerName)}
                    </p>
                    <span className="dashboard-sale-number">{sale.saleNumber}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-fg2">
                    {translateCustomerEmail(sale.customerEmail)} · {formatDateTime(sale.createdAt)}
                  </p>
                </div>
                <strong className="dashboard-row-value">{formatCurrency(sale.total)}</strong>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function TopProductsCard({ products, formatCurrency }: TopProductsCardProps) {
  const { t } = useTranslation('dashboard');
  return (
    <section className="pv-frame">
      <div className="pv-frame-core dashboard-panel">
        <header className="dashboard-list-heading">
          <div className="dashboard-list-icon dashboard-list-icon-warm" aria-hidden="true">
            <TrendingUp className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <p className="dashboard-eyebrow dashboard-eyebrow-light">{t('topProducts.kicker')}</p>
            <h2 className="dashboard-panel-title">{t('topProducts.title')}</h2>
          </div>
        </header>

        {products.length === 0 ? (
          <div className="dashboard-list-empty">{t('topProducts.empty')}</div>
        ) : (
          <div className="dashboard-activity-list">
            {products.map((product, index) => (
              <article key={product.productId} className="dashboard-product-row">
                <span className="dashboard-product-rank">{String(index + 1).padStart(2, '0')}</span>
                <div className="dashboard-product-icon" aria-hidden="true">
                  <Package className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-secondary-950">
                    {product.name}
                  </p>
                  <p className="mt-1 text-xs text-fg2">
                    {t('unitsSold', { count: product.sales })}
                  </p>
                </div>
                <div className="dashboard-product-value">
                  <strong>{formatCurrency(product.revenue)}</strong>
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function LowStockAlertsCard({ items }: LowStockAlertsCardProps) {
  const { t } = useTranslation('dashboard');
  return (
    <section className="pv-frame dashboard-stock-frame">
      <div className="pv-frame-core dashboard-panel dashboard-stock-panel">
        <header className="dashboard-stock-heading">
          <div>
            <p className="dashboard-eyebrow dashboard-eyebrow-light">{t('lowStock.kicker')}</p>
            <h2 className="dashboard-panel-title">{t('lowStock.title')}</h2>
            <p className="dashboard-panel-description">{t('lowStock.description')}</p>
          </div>
          <span
            className="dashboard-alert-count"
            aria-label={t('lowStock.alertCount', { count: items.length })}
          >
            {items.length}
          </span>
        </header>

        {items.length === 0 ? (
          <div className="dashboard-list-empty">{t('lowStock.empty')}</div>
        ) : (
          <div className="dashboard-stock-list">
            {items.map((item, index) => (
              <article key={item.productId} className="dashboard-stock-row">
                <span className="dashboard-stock-rank">{String(index + 1).padStart(2, '0')}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-secondary-950">{item.name}</p>
                  <p className="mt-1 font-mono text-[0.68rem] text-fg2">{item.sku}</p>
                </div>
                <div className="dashboard-stock-value">
                  <strong>{t('stockCount', { count: item.stock })}</strong>
                  <span>{t('lowStock.minimum', { count: item.minStock })}</span>
                </div>
              </article>
            ))}
          </div>
        )}

        <Link className="dashboard-text-action group" to="/inventory">
          <span>{t('lowStock.action')}</span>
          <ArrowRight
            className="h-4 w-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1"
            strokeWidth={1.6}
            aria-hidden="true"
          />
        </Link>
      </div>
    </section>
  );
}
