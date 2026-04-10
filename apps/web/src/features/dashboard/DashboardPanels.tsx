import {
  ArrowUpRight,
  Package,
} from 'lucide-react';
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
  iconColor: string;
}

export interface DashboardStatMetric {
  title: string;
  value: string;
  label: string;
  icon: ElementType;
  iconColor: string;
}

function StatCard({ title, value, label, icon: Icon, iconColor }: StatCardProps) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <div className={cn('rounded-lg p-3', iconColor)}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-sm font-medium text-secondary-500">{title}</h3>
        <p className="mt-1 text-2xl font-bold text-secondary-900">{value}</p>
        <p className="mt-1 text-xs text-secondary-500">{label}</p>
      </div>
    </div>
  );
}

export function DashboardLoadingState({ title }: DashboardLoadingStateProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">{title}</h1>
        <p className="mt-1 text-sm text-secondary-500">Loading live store activity...</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="card animate-pulse p-6">
            <div className="h-12 w-12 rounded-lg bg-secondary-100" />
            <div className="mt-6 h-4 w-24 rounded bg-secondary-100" />
            <div className="mt-3 h-8 w-32 rounded bg-secondary-100" />
            <div className="mt-2 h-3 w-40 rounded bg-secondary-100" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="card animate-pulse p-6">
          <div className="h-5 w-48 rounded bg-secondary-100" />
          <div className="mt-6 h-64 rounded-xl bg-secondary-50" />
        </div>
        <div className="card animate-pulse p-6">
          <div className="h-5 w-32 rounded bg-secondary-100" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="h-14 rounded-xl bg-secondary-50" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardStatsGrid({ metrics }: DashboardStatsGridProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {metrics.map(metric => (
        <StatCard
          key={metric.title}
          title={metric.title}
          value={metric.value}
          label={metric.label}
          icon={metric.icon}
          iconColor={metric.iconColor}
        />
      ))}
    </div>
  );
}

export function RevenueTrendCard({
  points,
  formatCurrency,
  formatDate,
}: RevenueTrendCardProps) {
  const maxRevenue = points.reduce((highest, point) => Math.max(highest, point.revenue), 0);

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">Revenue Trend</h2>
          <p className="mt-1 text-sm text-secondary-500">Completed sales over the last 30 days</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-secondary-500">Latest day</p>
          <p className="text-lg font-semibold text-secondary-900">
            {formatCurrency(points[points.length - 1]?.revenue ?? 0)}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex h-64 items-end gap-2 rounded-2xl border border-secondary-100 bg-secondary-50/60 px-4 py-5">
          {points.map(point => {
            const height = maxRevenue === 0 ? 8 : Math.max((point.revenue / maxRevenue) * 100, 8);

            return (
              <div key={point.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <div className="text-center opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="text-[11px] font-medium text-secondary-700">
                    {formatCurrency(point.revenue)}
                  </p>
                  <p className="text-[10px] text-secondary-500">{point.orders} orders</p>
                </div>
                <div
                  className="w-full rounded-t-md bg-primary-500/85 transition-colors group-hover:bg-primary-600"
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-secondary-500">
          <span>{formatDate(points[0]?.date ?? '')}</span>
          <span>{formatDate(points[points.length - 1]?.date ?? '')}</span>
        </div>
      </div>
    </div>
  );
}

export function RecentSalesCard({
  sales,
  formatCurrency,
  formatDateTime,
}: RecentSalesCardProps) {
  return (
    <div className="card p-6">
      <div>
        <h2 className="text-lg font-semibold text-secondary-900">Recent Sales</h2>
        <p className="mt-1 text-sm text-secondary-500">Latest live sales for your current tenant</p>
      </div>

      <div className="mt-6">
        {sales.length === 0 ? (
          <p className="text-sm text-secondary-500">No sales recorded yet.</p>
        ) : (
          <div className="space-y-4">
            {sales.map(sale => (
              <div
                key={sale.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-secondary-100 bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-primary-600">{sale.saleNumber}</p>
                  <p className="truncate text-sm font-medium text-secondary-900">
                    {sale.customerName}
                  </p>
                  <p className="truncate text-xs text-secondary-500">
                    {sale.customerEmail} · {formatDateTime(sale.createdAt)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-secondary-900">
                  {formatCurrency(sale.total)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TopProductsCard({ products, formatCurrency }: TopProductsCardProps) {
  return (
    <div className="card p-6">
      <div>
        <h2 className="text-lg font-semibold text-secondary-900">Top Products</h2>
        <p className="mt-1 text-sm text-secondary-500">Best sellers from completed sales in the last 7 days</p>
      </div>

      <div className="mt-6">
        {products.length === 0 ? (
          <p className="text-sm text-secondary-500">No recent product sales data yet.</p>
        ) : (
          <div className="space-y-4">
            {products.map(product => (
              <div
                key={product.productId}
                className="flex items-center justify-between gap-4 rounded-xl border border-secondary-100 bg-white px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
                    <Package className="h-5 w-5 text-primary-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-secondary-900">{product.name}</p>
                    <p className="text-xs text-secondary-500">{product.sales} units sold</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-secondary-900">
                  {formatCurrency(product.revenue)}
                  <ArrowUpRight className="h-4 w-4 text-success-500" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function LowStockAlertsCard({ items }: LowStockAlertsCardProps) {
  return (
    <div className="card p-6">
      <div>
        <h2 className="text-lg font-semibold text-secondary-900">Low Stock Alerts</h2>
        <p className="mt-1 text-sm text-secondary-500">Products that need replenishment attention</p>
      </div>

      <div className="mt-6">
        {items.length === 0 ? (
          <p className="text-sm text-secondary-500">No low-stock products right now.</p>
        ) : (
          <div className="space-y-4">
            {items.map(item => (
              <div
                key={item.productId}
                className="flex items-center justify-between gap-4 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-secondary-900">{item.name}</p>
                  <p className="text-xs text-secondary-500">{item.sku}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-danger-600">{item.stock} in stock</p>
                  <p className="text-xs text-secondary-500">Minimum {item.minStock}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
