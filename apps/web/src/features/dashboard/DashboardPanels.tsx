import { ArrowUpRight, Package } from 'lucide-react';
import type { ElementType } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@open-yojob/server';
import { cn } from '@/lib/utils';

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

interface StatCardProps {
  title: string;
  value: string;
  label: string;
  icon: ElementType;
  tone: 'primary' | 'success' | 'warning' | 'ink';
}

export interface DashboardStatMetric {
  title: string;
  value: string;
  label: string;
  icon: ElementType;
  tone: 'primary' | 'success' | 'warning' | 'ink';
}

const statToneClasses: Record<DashboardStatMetric['tone'], string> = {
  primary: 'bg-primary-50 text-primary-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  ink: 'bg-secondary-100 text-secondary-800',
};

function StatCard({ title, value, label, icon: Icon, tone }: StatCardProps) {
  return (
    <div className="metric-tile">
      <div className="flex items-center justify-between gap-3">
        <div className={cn('flex h-11 w-11 items-center justify-center rounded-[18px]', statToneClasses[tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
          Live
        </span>
      </div>
      <div className="mt-6">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-secondary-500">
          {title}
        </p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-secondary-950">{value}</p>
        <p className="mt-2 text-sm leading-6 text-secondary-600">{label}</p>
      </div>
    </div>
  );
}

export function DashboardLoadingState({ title }: DashboardLoadingStateProps) {
  return (
    <div className="space-y-6">
      <section className="hero-surface animate-soft-fade p-6 sm:p-8">
        <div className="relative z-10 space-y-4">
          <p className="page-kicker">{title}</p>
          <div className="animate-shimmer h-14 max-w-xl rounded-3xl" />
          <div className="animate-shimmer h-5 max-w-2xl rounded-2xl" />
          <div className="grid gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="metric-tile">
                <div className="animate-shimmer h-11 w-11 rounded-[18px]" />
                <div className="animate-shimmer mt-6 h-4 w-20 rounded-full" />
                <div className="animate-shimmer mt-3 h-9 w-32 rounded-2xl" />
                <div className="animate-shimmer mt-3 h-4 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <div className="card p-6">
          <div className="animate-shimmer h-5 w-44 rounded-full" />
          <div className="animate-shimmer mt-6 h-72 rounded-[24px]" />
        </div>
        <div className="card p-6">
          <div className="animate-shimmer h-5 w-40 rounded-full" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="animate-shimmer h-20 rounded-[22px]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardStatsGrid({ metrics }: DashboardStatsGridProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      {metrics.map(metric => (
        <StatCard
          key={metric.title}
          title={metric.title}
          value={metric.value}
          label={metric.label}
          icon={metric.icon}
          tone={metric.tone}
        />
      ))}
    </div>
  );
}

export function RevenueTrendCard({ points, formatCurrency, formatDate }: RevenueTrendCardProps) {
  const maxRevenue = points.reduce((highest, point) => Math.max(highest, point.revenue), 0);

  return (
    <section className="card p-6 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-kicker text-[0.62rem] tracking-[0.24em]">Revenue trend</p>
          <h2 className="mt-3 font-display text-3xl text-secondary-950">Thirty-day movement</h2>
          <p className="mt-2 text-sm text-secondary-600">
            Completed sales over the last 30 days with daily revenue and order volume.
          </p>
        </div>
        <div className="rounded-[22px] border border-line/70 bg-surface-2/70 px-4 py-3 text-right">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
            Latest day
          </p>
          <p className="mt-2 text-2xl font-semibold text-secondary-950">
            {formatCurrency(points[points.length - 1]?.revenue ?? 0)}
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-[28px] border border-line/70 bg-surface-2/65 px-4 py-5 sm:px-6">
        <div className="flex h-72 items-end gap-2">
          {points.map(point => {
            const height = maxRevenue === 0 ? 10 : Math.max((point.revenue / maxRevenue) * 100, 10);

            return (
              <div key={point.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <div className="text-center opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="text-[11px] font-semibold text-secondary-800">
                    {formatCurrency(point.revenue)}
                  </p>
                  <p className="text-[10px] text-secondary-500">{point.orders} orders</p>
                </div>
                <div
                  className="w-full rounded-t-[14px] bg-gradient-to-t from-primary-700 via-primary-500 to-primary-300 transition-transform duration-200 group-hover:scale-y-[1.03]"
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-secondary-500">
          <span>{formatDate(points[0]?.date ?? '')}</span>
          <span>{formatDate(points[points.length - 1]?.date ?? '')}</span>
        </div>
      </div>
    </section>
  );
}

export function RecentSalesCard({ sales, formatCurrency, formatDateTime }: RecentSalesCardProps) {
  return (
    <section className="card p-6 sm:p-7">
      <div>
        <p className="page-kicker text-[0.62rem] tracking-[0.24em]">Recent sales</p>
        <h2 className="mt-3 font-display text-3xl text-secondary-950">Latest completed receipts</h2>
      </div>

      <div className="mt-6">
        {sales.length === 0 ? (
          <div className="card-inset px-4 py-6 text-sm text-secondary-500">No sales recorded yet.</div>
        ) : (
          <div className="space-y-3">
            {sales.map(sale => (
              <article
                key={sale.id}
                className="card-inset flex items-center justify-between gap-4 px-4 py-4"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-primary-700">{sale.saleNumber}</p>
                  <p className="truncate text-sm font-semibold text-secondary-950">
                    {sale.customerName}
                  </p>
                  <p className="truncate text-xs text-secondary-500">
                    {sale.customerEmail} · {formatDateTime(sale.createdAt)}
                  </p>
                </div>
                <span className="text-base font-semibold text-secondary-950">
                  {formatCurrency(sale.total)}
                </span>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function TopProductsCard({ products, formatCurrency }: TopProductsCardProps) {
  return (
    <section className="card p-6 sm:p-7">
      <div>
        <p className="page-kicker text-[0.62rem] tracking-[0.24em]">Top products</p>
        <h2 className="mt-3 font-display text-3xl text-secondary-950">Best movers this week</h2>
      </div>

      <div className="mt-6">
        {products.length === 0 ? (
          <div className="card-inset px-4 py-6 text-sm text-secondary-500">
            No recent product sales data yet.
          </div>
        ) : (
          <div className="space-y-3">
            {products.map(product => (
              <article
                key={product.productId}
                className="card-inset flex items-center justify-between gap-4 px-4 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-primary-50 text-primary-700">
                    <Package className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-secondary-950">{product.name}</p>
                    <p className="text-xs text-secondary-500">{product.sales} units sold</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-secondary-950">
                  {formatCurrency(product.revenue)}
                  <ArrowUpRight className="h-4 w-4 text-success-700" />
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
  return (
    <section className="card p-6 sm:p-7">
      <div>
        <p className="page-kicker text-[0.62rem] tracking-[0.24em]">Replenishment</p>
        <h2 className="mt-3 font-display text-3xl text-secondary-950">Low-stock attention rail</h2>
      </div>

      <div className="mt-6">
        {items.length === 0 ? (
          <div className="card-inset px-4 py-6 text-sm text-secondary-500">
            No low-stock products right now.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(item => (
              <article
                key={item.productId}
                className="rounded-[22px] border border-warning-500/20 bg-warning-50 px-4 py-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-secondary-950">{item.name}</p>
                    <p className="text-xs text-secondary-500">{item.sku}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-danger-600">{item.stock} in stock</p>
                    <p className="text-xs text-secondary-500">Minimum {item.minStock}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
