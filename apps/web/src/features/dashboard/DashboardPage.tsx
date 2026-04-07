import {
  DollarSign,
  Users,
  Package,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useTenantSettings } from '@/hooks';

interface StatCardProps {
  title: string;
  value: string;
  change?: number;
  changeLabel?: string;
  icon: React.ElementType;
  iconColor: string;
}

function StatCard({ title, value, change, changeLabel, icon: Icon, iconColor }: StatCardProps) {
  const isPositive = change !== undefined && change >= 0;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <div className={cn('p-3 rounded-lg', iconColor)}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        {change !== undefined && (
          <div
            className={cn(
              'flex items-center gap-1 text-sm font-medium',
              isPositive ? 'text-success-700' : 'text-danger-500'
            )}
          >
            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <div className="mt-4">
        <h3 className="text-sm font-medium text-secondary-500">{title}</h3>
        <p className="mt-1 text-2xl font-bold text-secondary-900">{value}</p>
        {changeLabel && <p className="mt-1 text-xs text-secondary-500">{changeLabel}</p>}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { formatCurrency } = useTenantSettings();
  const dashboardQuery = trpc.dashboard.summary.useQuery();

  if (dashboardQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Dashboard</h1>
          <p className="mt-1 text-sm text-secondary-500">Loading live store activity...</p>
        </div>
      </div>
    );
  }

  if (dashboardQuery.error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Dashboard</h1>
          <p className="mt-1 text-sm text-danger-600">
            Unable to load dashboard data: {dashboardQuery.error.message}
          </p>
        </div>
      </div>
    );
  }

  const data = dashboardQuery.data;
  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">Dashboard</h1>
        <p className="mt-1 text-sm text-secondary-500">
          Welcome back! Here's what's happening with your store today.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value={formatCurrency(data.stats.revenue.value)}
          change={data.stats.revenue.change}
          changeLabel={data.stats.revenue.label}
          icon={DollarSign}
          iconColor="bg-success-500"
        />
        <StatCard
          title="Orders"
          value={data.stats.orders.value.toLocaleString()}
          change={data.stats.orders.change}
          changeLabel={data.stats.orders.label}
          icon={ShoppingCart}
          iconColor="bg-primary-500"
        />
        <StatCard
          title="Customers"
          value={data.stats.customers.value.toLocaleString()}
          change={data.stats.customers.change}
          changeLabel={data.stats.customers.label}
          icon={Users}
          iconColor="bg-warning-500"
        />
        <StatCard
          title="Products"
          value={data.stats.products.value.toLocaleString()}
          change={data.stats.products.change}
          changeLabel={data.stats.products.label}
          icon={Package}
          iconColor="bg-secondary-500"
        />
      </div>

      {/* Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Sales */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title text-lg">Recent Sales</h2>
            <p className="card-description">Latest live sales for your current tenant</p>
          </div>
          <div className="card-content">
            {data.recentSales.length === 0 ? (
              <p className="text-sm text-secondary-500">No sales recorded yet.</p>
            ) : (
              <div className="space-y-4">
                {data.recentSales.map(sale => (
                  <div key={sale.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-secondary-100 flex items-center justify-center">
                        <span className="text-sm font-medium text-secondary-600">
                          {sale.customerName.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-secondary-900">
                          {sale.customerName}
                        </p>
                        <p className="text-xs text-secondary-500">{sale.customerEmail}</p>
                      </div>
                    </div>
                    <span className="text-sm font-medium text-secondary-900">
                      {formatCurrency(sale.total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Top Products */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title text-lg">Top Products</h2>
            <p className="card-description">Best selling products from completed sales</p>
          </div>
          <div className="card-content">
            {data.topProducts.length === 0 ? (
              <p className="text-sm text-secondary-500">No product sales data yet.</p>
            ) : (
              <div className="space-y-4">
                {data.topProducts.map(product => (
                  <div key={product.productId} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-primary-50 flex items-center justify-center">
                        <Package className="h-5 w-5 text-primary-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-secondary-900">{product.name}</p>
                        <p className="text-xs text-secondary-500">{product.sales} units sold</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-secondary-900">
                        {formatCurrency(product.revenue)}
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-success-500" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
