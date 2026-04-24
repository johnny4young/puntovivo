import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BadgePercent,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileDigit,
  FileSignature,
  FileText,
  FolderTree,
  LayoutDashboard,
  Map,
  MapPinned,
  Package,
  Package2,
  PieChart,
  Receipt,
  Ruler,
  ShieldCheck,
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

// Navigation item stores a translation key instead of a resolved string
type NavigationItem = {
  nameKey: string;
  href: string;
  icon: typeof LayoutDashboard;
  allowedRoles: readonly UserRole[];
};

type NavigationSection = {
  titleKey: string;
  items: readonly NavigationItem[];
};

const navigationSections = [
  {
    titleKey: 'sections.overview',
    items: [
      { nameKey: 'items.dashboard', href: '/dashboard', icon: LayoutDashboard, allowedRoles: dashboardRoles },
      { nameKey: 'items.sales', href: '/sales', icon: ShoppingCart, allowedRoles: salesRoles },
      { nameKey: 'items.inventory', href: '/inventory', icon: Warehouse, allowedRoles: managerOrAdminRoles },
    ],
  },
  {
    titleKey: 'sections.flow',
    items: [
      { nameKey: 'items.orders', href: '/orders', icon: ClipboardList, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.purchases', href: '/purchases', icon: ShoppingBasket, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.quotations', href: '/quotations', icon: FileText, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.customers', href: '/customers', icon: Users, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.products', href: '/products', icon: Package, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.providers', href: '/providers', icon: Truck, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.categories', href: '/categories', icon: FolderTree, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.locations', href: '/locations', icon: MapPinned, allowedRoles: adminOnlyRoles },
    ],
  },
  {
    titleKey: 'sections.setup',
    items: [
      { nameKey: 'items.company', href: '/company', icon: Building2, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.sites', href: '/sites', icon: Store, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.sequentials', href: '/sequentials', icon: FileDigit, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.geography', href: '/geography', icon: Map, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.customerCatalogs', href: '/customer-catalogs', icon: ClipboardList, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.units', href: '/units', icon: Ruler, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.vatRates', href: '/vat-rates', icon: BadgePercent, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.receiptTemplates', href: '/receipt-templates', icon: Receipt, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.users', href: '/users', icon: Users, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.auditLogs', href: '/audit-logs', icon: ShieldCheck, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.fiscalDocuments', href: '/fiscal-documents', icon: FileSignature, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.fiscalReports', href: '/fiscal-reports', icon: PieChart, allowedRoles: adminOnlyRoles },
    ],
  },
] satisfies readonly NavigationSection[];

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation('nav');
  return (
    <div className="hero-surface px-4 py-4">
      <div className="relative z-10 flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-primary text-primary-foreground shadow-[0_18px_40px_-24px_color-mix(in_oklch,var(--primary)_70%,transparent)]">
          <Package2 className="h-6 w-6" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('brand.kicker')}</p>
            <h1 className="truncate font-display text-2xl text-secondary-950">{t('brand.title')}</h1>
            <p className="truncate text-xs text-secondary-600">{t('brand.tagline')}</p>
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
  const { t } = useTranslation('nav');
  const name = t(item.nameKey);
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      title={collapsed ? name : undefined}
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
      {!collapsed && <span className="truncate">{name}</span>}
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
  const { t } = useTranslation('nav');
  return (
    <div className="space-y-5">
      {navigationSections.map(section => {
        const visibleItems = section.items.filter(item => canAccessRole(role, item.allowedRoles));

        if (visibleItems.length === 0) {
          return null;
        }

        return (
          <section key={section.titleKey} className="space-y-2">
            {!collapsed && (
              <p className="px-2 text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-secondary-500">
                {t(section.titleKey)}
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
  const { t } = useTranslation(['nav', 'common']);

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-secondary-950/35 backdrop-blur-sm transition-opacity duration-200 xl:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onCloseMobile}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex min-h-0 w-[18.5rem] flex-col border-r border-line/70 bg-surface/88 px-3 py-3 backdrop-blur-2xl transition-transform duration-300 xl:translate-x-0',
          collapsed && 'xl:w-[6.5rem]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="mb-4 shrink-0 flex items-center justify-between gap-2">
          <SidebarBrand collapsed={collapsed} />
          <button
            type="button"
            className="btn-outline btn-icon mobile-shell-toggle xl:hidden"
            onClick={onCloseMobile}
            aria-label={t('nav:actions.closeNavigation')}
          >
            <X className="h-5.5 w-5.5 shrink-0" strokeWidth={2.35} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin pr-1">
          <SidebarSections
            collapsed={collapsed}
            onNavigate={onCloseMobile}
            role={user?.role}
          />
        </div>

        <div className={cn('mt-4 shrink-0 space-y-3', collapsed && 'items-center')}>
          {!collapsed && user && (
            <div className="card-inset px-4 py-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-secondary-500">
                {t('common:signedIn')}
              </p>
              <p className="mt-2 truncate text-sm font-semibold text-secondary-950">{user.name}</p>
              <p className="truncate text-xs text-secondary-500">{user.role}</p>
            </div>
          )}

          <button
            type="button"
            className="btn-outline hidden w-full xl:inline-flex"
            onClick={onToggleCollapse}
          >
            {collapsed ? (
              <>
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">{t('nav:actions.expandNavigation')}</span>
              </>
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                {t('nav:actions.collapseRail')}
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
