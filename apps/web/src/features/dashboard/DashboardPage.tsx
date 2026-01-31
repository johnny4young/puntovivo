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
          value="$45,231.89"
          change={20.1}
          changeLabel="from last month"
          icon={DollarSign}
          iconColor="bg-success-500"
        />
        <StatCard
          title="Orders"
          value="2,350"
          change={10.5}
          changeLabel="from last month"
          icon={ShoppingCart}
          iconColor="bg-primary-500"
        />
        <StatCard
          title="Customers"
          value="1,234"
          change={5.2}
          changeLabel="from last month"
          icon={Users}
          iconColor="bg-warning-500"
        />
        <StatCard
          title="Products"
          value="573"
          change={-2.3}
          changeLabel="from last month"
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
            <p className="card-description">You made 265 sales this month</p>
          </div>
          <div className="card-content">
            <div className="space-y-4">
              {[
                { name: 'John Doe', email: 'john@example.com', amount: '+$1,999.00' },
                { name: 'Jane Smith', email: 'jane@example.com', amount: '+$39.00' },
                { name: 'Bob Wilson', email: 'bob@example.com', amount: '+$299.00' },
                { name: 'Alice Brown', email: 'alice@example.com', amount: '+$99.00' },
                { name: 'Charlie Davis', email: 'charlie@example.com', amount: '+$499.00' },
              ].map((sale, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-secondary-100 flex items-center justify-center">
                      <span className="text-sm font-medium text-secondary-600">
                        {sale.name.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-secondary-900">{sale.name}</p>
                      <p className="text-xs text-secondary-500">{sale.email}</p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-secondary-900">{sale.amount}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Products */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title text-lg">Top Products</h2>
            <p className="card-description">Best selling products this month</p>
          </div>
          <div className="card-content">
            <div className="space-y-4">
              {[
                { name: 'Product A', sales: 234, revenue: '$4,500' },
                { name: 'Product B', sales: 187, revenue: '$3,200' },
                { name: 'Product C', sales: 156, revenue: '$2,800' },
                { name: 'Product D', sales: 132, revenue: '$2,100' },
                { name: 'Product E', sales: 98, revenue: '$1,750' },
              ].map((product, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary-50 flex items-center justify-center">
                      <Package className="h-5 w-5 text-primary-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-secondary-900">{product.name}</p>
                      <p className="text-xs text-secondary-500">{product.sales} sales</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-secondary-900">
                      {product.revenue}
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-success-500" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
