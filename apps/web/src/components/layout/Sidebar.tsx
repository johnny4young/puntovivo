import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2 as Building,
  Package,
  Ruler,
  Users,
  Truck,
  BadgePercent,
  FileDigit,
  ShoppingCart,
  Warehouse,
  ChevronLeft,
  ChevronRight,
  Package2 as AppLogo,
  Store,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Company', href: '/company', icon: Building },
  { name: 'Sites', href: '/sites', icon: Store },
  { name: 'Sequentials', href: '/sequentials', icon: FileDigit },
  { name: 'Providers', href: '/providers', icon: Truck },
  { name: 'Units', href: '/units', icon: Ruler },
  { name: 'VAT Rates', href: '/vat-rates', icon: BadgePercent },
  { name: 'Products', href: '/products', icon: Package },
  { name: 'Customers', href: '/customers', icon: Users },
  { name: 'Sales', href: '/sales', icon: ShoppingCart },
  { name: 'Inventory', href: '/inventory', icon: Warehouse },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-white border-r border-secondary-200 transition-all duration-300',
        collapsed ? 'w-20' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-secondary-200">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary-600 flex items-center justify-center flex-shrink-0">
            <AppLogo className="h-6 w-6 text-white" />
          </div>
          {!collapsed && <span className="text-lg font-bold text-secondary-900">Open Yojob</span>}
        </div>
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-secondary-100 text-secondary-500"
        >
          {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col h-[calc(100vh-4rem)] justify-between p-4">
        <ul className="space-y-1">
          {navigation.map(item => (
            <li key={item.name}>
              <NavLink
                to={item.href}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900'
                  )
                }
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <span>{item.name}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
