import { NavLink } from 'react-router-dom';
import {
  BadgePercent,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileDigit,
  FolderTree,
  LayoutDashboard,
  Map,
  MapPinned,
  Package,
  Package2,
  Ruler,
  ShoppingBasket,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  adminOnlyRoles,
  canAccessRole,
  dashboardRoles,
  managerOrAdminRoles,
  salesRoles,
} from '@/features/auth/roleAccess';
import type { UserRole } from '@/types';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
}

type NavigationItem = {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  allowedRoles: readonly UserRole[];
};

type NavigationSection = {
  title: string;
  items: readonly NavigationItem[];
};

const navigationSections = [
  {
    title: 'Overview',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, allowedRoles: dashboardRoles },
      { name: 'Sales', href: '/sales', icon: ShoppingCart, allowedRoles: salesRoles },
      { name: 'Inventory', href: '/inventory', icon: Warehouse, allowedRoles: managerOrAdminRoles },
    ],
  },
  {
    title: 'Flow',
    items: [
      { name: 'Orders', href: '/orders', icon: ClipboardList, allowedRoles: managerOrAdminRoles },
      { name: 'Purchases', href: '/purchases', icon: ShoppingBasket, allowedRoles: managerOrAdminRoles },
      { name: 'Customers', href: '/customers', icon: Users, allowedRoles: managerOrAdminRoles },
      { name: 'Products', href: '/products', icon: Package, allowedRoles: managerOrAdminRoles },
      { name: 'Providers', href: '/providers', icon: Truck, allowedRoles: adminOnlyRoles },
      { name: 'Categories', href: '/categories', icon: FolderTree, allowedRoles: adminOnlyRoles },
      { name: 'Locations', href: '/locations', icon: MapPinned, allowedRoles: adminOnlyRoles },
    ],
  },
  {
    title: 'Setup',
    items: [
      { name: 'Company', href: '/company', icon: Building2, allowedRoles: adminOnlyRoles },
      { name: 'Sites', href: '/sites', icon: Store, allowedRoles: adminOnlyRoles },
      { name: 'Sequentials', href: '/sequentials', icon: FileDigit, allowedRoles: adminOnlyRoles },
      { name: 'Geography', href: '/geography', icon: Map, allowedRoles: adminOnlyRoles },
      { name: 'Customer Catalogs', href: '/customer-catalogs', icon: ClipboardList, allowedRoles: adminOnlyRoles },
      { name: 'Units', href: '/units', icon: Ruler, allowedRoles: adminOnlyRoles },
      { name: 'VAT Rates', href: '/vat-rates', icon: BadgePercent, allowedRoles: adminOnlyRoles },
      { name: 'Users', href: '/users', icon: Users, allowedRoles: adminOnlyRoles },
    ],
  },
] satisfies readonly NavigationSection[];

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="hero-surface px-4 py-4">
      <div className="relative z-10 flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-primary text-primary-foreground shadow-[0_18px_40px_-24px_color-mix(in_oklch,var(--primary)_70%,transparent)]">
          <Package2 className="h-6 w-6" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">Retail Console</p>
            <h1 className="truncate font-display text-2xl text-secondary-950">Open Yojob</h1>
            <p className="truncate text-xs text-secondary-600">
              Sales, stock, and receiving in one workspace
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function NavigationLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavigationItem;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      title={collapsed ? item.name : undefined}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-[20px] px-3 py-3 text-sm font-medium transition-all duration-200',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-primary text-primary-foreground shadow-[0_18px_40px_-28px_color-mix(in_oklch,var(--primary)_75%,transparent)]'
            : 'text-secondary-600 hover:bg-secondary-100/80 hover:text-secondary-950'
        )
      }
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="truncate">{item.name}</span>}
    </NavLink>
  );
}

function SidebarSections({
  collapsed,
  onNavigate,
  role,
}: {
  collapsed: boolean;
  onNavigate: () => void;
  role: UserRole | undefined;
}) {
  return (
    <div className="space-y-5">
      {navigationSections.map(section => {
        const visibleItems = section.items.filter(item => canAccessRole(role, item.allowedRoles));

        if (visibleItems.length === 0) {
          return null;
        }

        return (
          <section key={section.title} className="space-y-2">
            {!collapsed && (
              <p className="px-2 text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-secondary-500">
                {section.title}
              </p>
            )}
            <div className="space-y-1.5">
              {visibleItems.map(item => (
                <NavigationLink
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
}: SidebarProps) {
  const { user } = useAuth();

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-secondary-950/35 backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onCloseMobile}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[18.5rem] flex-col border-r border-line/70 bg-surface/88 px-3 py-3 backdrop-blur-2xl transition-transform duration-300 lg:translate-x-0',
          collapsed && 'lg:w-[6.5rem]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <SidebarBrand collapsed={collapsed} />
          <button
            type="button"
            className="btn-ghost btn-icon lg:hidden"
            onClick={onCloseMobile}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin pr-1">
          <SidebarSections
            collapsed={collapsed}
            onNavigate={onCloseMobile}
            role={user?.role}
          />
        </div>

        <div className={cn('mt-4 space-y-3', collapsed && 'items-center')}>
          {!collapsed && user && (
            <div className="card-inset px-4 py-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-secondary-500">
                Signed in
              </p>
              <p className="mt-2 truncate text-sm font-semibold text-secondary-950">{user.name}</p>
              <p className="truncate text-xs text-secondary-500">{user.role}</p>
            </div>
          )}

          <button
            type="button"
            className="btn-outline hidden w-full lg:inline-flex"
            onClick={onToggleCollapse}
          >
            {collapsed ? (
              <>
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">Expand navigation</span>
              </>
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                Collapse rail
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
