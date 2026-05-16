import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BadgePercent,
  Building2,
  ChefHat,
  ChevronDown,
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
  PieChart,
  Plug,
  Receipt,
  Ruler,
  ShieldCheck,
  ShoppingBasket,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Table2,
  Tablet,
  Truck,
  Tv,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  adminOnlyRoles,
  canAccessRole,
  dashboardRoles,
  managerOrAdminRoles,
  salesRoles,
} from '@/features/auth/roleAccess';
import {
  CLIENT_MODULE_DEFAULTS,
  useModulesSnapshot,
  type ClientModuleId,
} from '@/features/modules';
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
  /**
   * ENG-068 — when set, the nav item only renders for tenants with
   * the module active. The route itself also gates server-side, so a
   * stale renderer that calls a deactivated module surface returns
   * FORBIDDEN with `MODULE_NOT_ACTIVATED`.
   */
  requiredModule?: ClientModuleId;
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
      { nameKey: 'items.coPilot', href: '/co-pilot', icon: Sparkles, allowedRoles: managerOrAdminRoles, requiredModule: 'copilot' },
      { nameKey: 'items.sales', href: '/sales', icon: ShoppingCart, allowedRoles: salesRoles },
      { nameKey: 'items.inventory', href: '/inventory', icon: Warehouse, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.operations', href: '/operations', icon: Activity, allowedRoles: managerOrAdminRoles, requiredModule: 'operations-center' },
    ],
  },
  {
    // ENG-079b — providers / categories / locations were moved from
    // here to `sections.setup`. They are configuration data (third-party
    // catalog, taxonomy, places) not operational flow; clustering them
    // with the rest of the admin-only setup screens keeps the
    // operational tab focused on day-to-day work.
    titleKey: 'sections.flow',
    items: [
      { nameKey: 'items.orders', href: '/orders', icon: ClipboardList, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.purchases', href: '/purchases', icon: ShoppingBasket, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.quotations', href: '/quotations', icon: FileText, allowedRoles: managerOrAdminRoles, requiredModule: 'quotations' },
      { nameKey: 'items.customers', href: '/customers', icon: Users, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.products', href: '/products', icon: Package, allowedRoles: managerOrAdminRoles },
    ],
  },
  {
    // ENG-069 — surface entries. Each gates behind a default-OFF
    // module so existing tenants do not see new entries appear after
    // the kernel ships. When all 4 modules are off the entire
    // section title hides because `visibleItems.length === 0` (the
    // existing filter from ENG-068's section guard).
    titleKey: 'sections.surfaces',
    items: [
      { nameKey: 'items.posTouch', href: '/touch', icon: Tablet, allowedRoles: salesRoles, requiredModule: 'pos-touch' },
      { nameKey: 'items.kds', href: '/kds', icon: ChefHat, allowedRoles: salesRoles, requiredModule: 'kds' },
      { nameKey: 'items.customerDisplay', href: '/customer-display', icon: Tv, allowedRoles: salesRoles, requiredModule: 'customer-display' },
      { nameKey: 'items.mobileWaiter', href: '/m', icon: Smartphone, allowedRoles: salesRoles, requiredModule: 'mobile-waiter' },
      // ENG-039b — restaurant table catalog. Admin-only setup but lives
      // in `sections.surfaces` because it only matters once a tenant
      // adopts the restaurant vertical. Gating on `pos-touch` keeps the
      // entry hidden for tenants who never enable any restaurant
      // surface; admins running mobile-waiter or kds alone can still
      // reach the page via direct URL.
      { nameKey: 'items.restaurantTables', href: '/restaurants/tables', icon: Table2, allowedRoles: adminOnlyRoles, requiredModule: 'pos-touch' },
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
      // ENG-079b — providers/categories/locations re-anchored here from
      // sections.flow. They cluster with the rest of the data-setup
      // catalog (customerCatalogs above; units/vatRates below).
      { nameKey: 'items.providers', href: '/providers', icon: Truck, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.categories', href: '/categories', icon: FolderTree, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.locations', href: '/locations', icon: MapPinned, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.units', href: '/units', icon: Ruler, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.vatRates', href: '/vat-rates', icon: BadgePercent, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.receiptTemplates', href: '/receipt-templates', icon: Receipt, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.peripherals', href: '/peripherals', icon: Plug, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.users', href: '/users', icon: Users, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.aiConfig', href: '/settings/ai', icon: Sparkles, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.auditLogs', href: '/audit-logs', icon: ShieldCheck, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.fiscalDocuments', href: '/fiscal-documents', icon: FileSignature, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.fiscalReports', href: '/fiscal-reports', icon: PieChart, allowedRoles: adminOnlyRoles },
    ],
  },
] satisfies readonly NavigationSection[];

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation('nav');
  // ENG-080 + ENG-080c — Puntovivo BrandMark + the "punto" 400 / "vivo"
  // 700 lowercase wordmark in Inter (primary) per the handoff
  // shell.jsx lockup. The orange punto accent is visible in both
  // expanded and collapsed rail; the tagline only renders expanded.
  return (
    <div className={cn('flex items-center gap-2.5 px-2 py-1.5', collapsed && 'justify-center px-0')}>
      <BrandMark
        className="h-9 w-9 shrink-0 drop-shadow-[0_8px_18px_color-mix(in_oklch,var(--primary)_45%,transparent)]"
        label={t('brand.title', 'Puntovivo')}
      />
      {!collapsed && (
        <div className="min-w-0 leading-none">
          <p className="text-[0.55rem] font-semibold uppercase tracking-[0.22em] text-primary-700">
            {t('brand.tagline')}
          </p>
          <h1 className="mt-1 truncate text-lg leading-none tracking-[-0.01em] text-primary lowercase">
            <span className="font-normal">punto</span>
            <span className="font-bold">vivo</span>
          </h1>
        </div>
      )}
    </div>
  );
}

function NavigationLink({
  item,
  collapsed,
  onNavigate,
  badgeCount,
}: {
  item: NavigationItem;
  collapsed: boolean;
  onNavigate: () => void;
  badgeCount?: number;
}) {
  const { t } = useTranslation('nav');
  const name = t(item.nameKey);
  const showBadge = (badgeCount ?? 0) > 0;
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      title={collapsed ? name : undefined}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-[20px] px-3 py-2 text-sm font-medium transition-all duration-200',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-primary text-primary-foreground shadow-[0_18px_40px_-28px_color-mix(in_oklch,var(--primary)_75%,transparent)]'
            : 'text-secondary-600 hover:bg-secondary-100/80 hover:text-secondary-950'
        )
      }
    >
      <span className="relative inline-flex items-center justify-center">
        <item.icon className="h-5 w-5 shrink-0" />
        {showBadge && (
          <span
            className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger-700 px-1 text-[0.65rem] font-semibold leading-none text-white"
            aria-hidden="true"
          >
            {badgeCount! > 9 ? '9+' : badgeCount}
          </span>
        )}
      </span>
      {!collapsed && (
        <span className="flex-1 truncate">
          {name}
          {showBadge && (
            <span className="sr-only">
              {' '}
              ({badgeCount}
              {' '}
              {t('badges.unreadAlertsSr', { defaultValue: 'unread alerts' })})
            </span>
          )}
        </span>
      )}
    </NavLink>
  );
}

// ENG-079b — sessionStorage key for the collapsible Setup section.
// Prefix mirrors the `active_site_id:` convention in `siteStorage.ts`.
// Value is the string 'true' or 'false'; missing key = collapsed by
// default. Per-tab scope (sessionStorage) so a new browsing session
// resets to the conservative collapsed state.
const SETUP_COLLAPSED_STORAGE_KEY = 'puntovivo:sidebar:setupCollapsed';

function readSetupCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.sessionStorage.getItem(SETUP_COLLAPSED_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== 'false';
  } catch {
    // Private-mode browsers can throw on sessionStorage access. Fall back
    // to the conservative collapsed default rather than crash render.
    return true;
  }
}

function writeSetupCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SETUP_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Same private-mode guard. The UI state still flips via useState;
    // we just can't persist it.
  }
}

function SidebarCollapsibleSectionTitle({
  title,
  isOpen,
  onToggle,
  controlsId,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  controlsId: string;
}) {
  // ENG-079b — clickable section header for collapsible groups.
  // Mirrors the static `<p>` styling used by other sections so the
  // visual rhythm stays consistent; only the chevron + button affordance
  // are new. aria-expanded + aria-controls give screen readers the
  // disclosure semantics for free.
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-controls={controlsId}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[0.65rem] font-semibold uppercase text-secondary-500 transition-colors hover:bg-secondary-100/60 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
    >
      <span className="truncate">{title}</span>
      <ChevronDown
        className={cn(
          'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
          !isOpen && '-rotate-90'
        )}
        aria-hidden="true"
      />
    </button>
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
  // ENG-068 — read the effective module map once per render. Items
  // with `requiredModule` are filtered out when the module is off,
  // mirroring how `RequireModule` hides routes. Defaults apply while
  // the query is loading so the sidebar doesn't flash hidden entries
  // on cold boot.
  const { modules } = useModulesSnapshot();
  // ENG-047 — sidebar badge for high-severity anomalies on the
  // Dashboard nav item. Only manager+ can call ai.anomalies.list (it
  // is gated by managerOrAdminProcedure server-side); we additionally
  // gate client-side so cashiers/viewers do not even attempt the
  // query. The endpoint short-circuits to enabled=false + zero counts
  // when ai.enabled is off, so an unconfigured tenant pays only one
  // cheap settings read.
  // ENG-068 — also short-circuit when the `anomaly-detection` module
  // is off so the disabled badge query doesn't fire against a gated
  // procedure (it would FORBIDDEN-out and surface as a console toast
  // for no operator benefit).
  const isManagerOrAdmin = (managerOrAdminRoles as readonly string[]).includes(role ?? '');
  const anomalyModuleActive = modules['anomaly-detection'] ?? CLIENT_MODULE_DEFAULTS['anomaly-detection'];
  const anomaliesQuery = trpc.ai.anomalies.list.useQuery(
    {},
    {
      enabled: isManagerOrAdmin && anomalyModuleActive,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
    }
  );
  // Show the count on the Dashboard tile. We only surface high-severity
  // alerts as the badge — medium ones still appear inside the dashboard
  // tile but are quiet enough not to chase the operator across screens.
  const dashboardBadge = anomaliesQuery.data?.severityCounts.high ?? 0;

  // ENG-079b — `sections.setup` is the only collapsible group today.
  // Default collapsed (settings are session-occasional, not daily);
  // sessionStorage remembers within the tab so the operator doesn't
  // re-collapse on every navigation. Collapsed-rail mode (`collapsed`
  // prop true) bypasses this — every icon renders regardless because
  // the section labels are hidden anyway and power users navigate by
  // icon position.
  const [setupCollapsed, setSetupCollapsed] = useState<boolean>(readSetupCollapsed);
  const toggleSetup = () => {
    setSetupCollapsed(prev => {
      const next = !prev;
      writeSetupCollapsed(next);
      return next;
    });
  };

  return (
    // ENG-079a — tighter section gap (was space-y-5 / 20 px). Collapsed
    // mode shrinks further since section labels are hidden anyway.
    <div className={cn('space-y-3', collapsed && 'space-y-2')}>
      {navigationSections.map(section => {
        // ENG-079b — annotate item as NavigationItem so the optional
        // `requiredModule` field survives the union narrowing that
        // `satisfies readonly NavigationSection[]` introduces (the
        // setup section's items now all share `requiredModule?: never`
        // since none of them gate on a module, which makes the union
        // forget the optional shape).
        const visibleItems = (section.items as readonly NavigationItem[]).filter(item => {
          if (!canAccessRole(role, item.allowedRoles)) {
            return false;
          }
          if (item.requiredModule && !modules[item.requiredModule]) {
            return false;
          }
          return true;
        });

        if (visibleItems.length === 0) {
          return null;
        }

        const isSetup = section.titleKey === 'sections.setup';
        // ENG-079b — only the setup section collapses in expanded-rail
        // mode. In collapsed-rail mode the section labels are hidden
        // anyway and the icons always render.
        const isCollapsible = isSetup && !collapsed;
        const itemsHidden = isCollapsible && setupCollapsed;
        const controlsId = `sidebar-section-${section.titleKey.replace('.', '-')}`;

        return (
          <section key={section.titleKey} className="space-y-2">
            {!collapsed &&
              (isCollapsible ? (
                <SidebarCollapsibleSectionTitle
                  title={t(section.titleKey)}
                  isOpen={!setupCollapsed}
                  onToggle={toggleSetup}
                  controlsId={controlsId}
                />
              ) : (
                <p className="px-2 text-[0.65rem] font-semibold uppercase text-secondary-500">
                  {t(section.titleKey)}
                </p>
              ))}
            <div id={controlsId} hidden={itemsHidden} className="space-y-1">
              {visibleItems.map(item => (
                <NavigationLink
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                  badgeCount={item.href === '/dashboard' ? dashboardBadge : undefined}
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
  const { t } = useTranslation('nav');

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
          {/*
            ENG-079b — collapse-rail button moved from the footer up to
            the header so the controls live together (Notion / Linear /
            GitHub pattern). The mobile X close button stays on the
            opposite breakpoint so only one icon is visible at a time.
          */}
          <button
            type="button"
            className="btn-outline btn-icon hidden xl:inline-flex"
            onClick={onToggleCollapse}
            aria-label={t(collapsed ? 'nav:actions.expandNavigation' : 'nav:actions.collapseRail')}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronLeft className="h-4 w-4 shrink-0" />
            )}
          </button>
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

        {/*
          ENG-079a dropped the SESIÓN INICIADA card here (the same
          user.name + role + email surface in the Header user menu).
          ENG-079b moved the collapse-rail button to the top header so
          the footer block is now empty and the chrome shrinks to fit.
        */}
      </aside>
    </>
  );
}
