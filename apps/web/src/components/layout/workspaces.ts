/**
 * ENG-131 (slice A) — Canonical workspace catalogue for the sidebar.
 *
 * The sidebar previously rendered four flat sections (`overview`,
 * `flow`, `surfaces`, `setup`) carrying 32 individual route entries.
 * Admin saw all of them collapsed into one wall of links — the
 * UI-REFRACTOR-V3 live audit (May 20) called that out as the
 * primary density problem in the app.
 *
 * This module is the source of truth for the new model: eight
 * role-shaped workspaces (Sell, Operate, Catalog, Inventory,
 * Procurement, Customers, Finance, Setup) that group every
 * existing route under a single click-to-expand header. NO routes
 * move — deep links and direct URLs keep working unchanged. The
 * sidebar component reads this list to render workspace groups +
 * their child NavigationItems.
 *
 * Dashboard is intentionally NOT inside any workspace; it remains a
 * top-level NavLink above the workspace stack (it serves every
 * dashboard-eligible role including viewer, who has no workspace
 * memberships otherwise).
 *
 * Surface Switcher, new `/catalog` / `/procurement` / `/finance`
 * route shells, route redirects, and mobile workspace nav stay in
 * ENG-131b..d.
 *
 * @module components/layout/workspaces
 */

import {
  Activity,
  BadgePercent,
  Building2,
  ChefHat,
  ClipboardList,
  FileDigit,
  FileSignature,
  FileText,
  FolderTree,
  HandCoins,
  type LucideIcon,
  LayoutGrid,
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
  Sparkles,
  Smartphone,
  Store,
  Table2,
  Tablet,
  Truck,
  Tv,
  Users,
  Warehouse,
} from 'lucide-react';
import type { UserRole } from '@/types';
import {
  adminOnlyRoles,
  dashboardRoles,
  managerOrAdminRoles,
  salesRoles,
} from '@/features/auth/roleAccess';
import type { ClientModuleId } from '@/features/modules';

/**
 * A single navigable entry that lives inside a workspace. Mirrors
 * the `NavigationItem` shape the old `Sidebar.tsx` declared inline
 * so the workspace-aware refactor is a drop-in replacement.
 */
export interface WorkspaceItem {
  /** i18n key under the `nav:items.*` namespace. */
  nameKey: string;
  /** Route path consumed by `react-router-dom NavLink`. */
  href: string;
  icon: LucideIcon;
  allowedRoles: readonly UserRole[];
  /**
   * Optional `RequireModule` parity gate. The sidebar reads
   * `useModulesSnapshot()` and hides items whose module is off,
   * mirroring how the router redirects away from disabled modules.
   */
  requiredModule?: ClientModuleId;
}

export interface Workspace {
  /** Stable id used by tests + localStorage keys. */
  id: string;
  /** i18n key under the `workspaces:*` namespace (label only). */
  labelKey: string;
  /** Lucide icon rendered in the workspace header. */
  icon: LucideIcon;
  /**
   * Roles eligible to see this workspace AT ALL. A workspace whose
   * children all gate to higher roles will also collapse to zero
   * visible items — `visibleWorkspacesForRole` filters those out
   * regardless.
   */
  allowedRoles: readonly UserRole[];
  /** Default landing route when (future) the workspace header is clicked. */
  defaultRoute: string;
  /** Ordered list of route entries that nest under this workspace. */
  items: readonly WorkspaceItem[];
}

/**
 * The top-level Dashboard link lives outside the workspace list.
 * Exposed here so the sidebar renders it from the same single
 * source of truth and the unit tests can pin the shape.
 */
export const TOP_LEVEL_DASHBOARD: WorkspaceItem = {
  nameKey: 'items.dashboard',
  href: '/dashboard',
  icon: LayoutGrid,
  allowedRoles: dashboardRoles,
};

/**
 * Eight workspaces from UI-REFRACTOR-V3 §3. The mapping reproduces
 * every route the old four-section sidebar declared.
 */
export const WORKSPACES: readonly Workspace[] = [
  {
    id: 'sell',
    labelKey: 'sell.label',
    icon: ShoppingCart,
    allowedRoles: salesRoles,
    defaultRoute: '/sales',
    items: [
      { nameKey: 'items.sales', href: '/sales', icon: ShoppingCart, allowedRoles: salesRoles },
      {
        nameKey: 'items.coPilot',
        href: '/co-pilot',
        icon: Sparkles,
        allowedRoles: managerOrAdminRoles,
        requiredModule: 'copilot',
      },
      {
        nameKey: 'items.posTouch',
        href: '/touch',
        icon: Tablet,
        allowedRoles: salesRoles,
        requiredModule: 'pos-touch',
      },
      {
        nameKey: 'items.kds',
        href: '/kds',
        icon: ChefHat,
        allowedRoles: salesRoles,
        requiredModule: 'kds',
      },
      {
        nameKey: 'items.customerDisplay',
        href: '/customer-display',
        icon: Tv,
        allowedRoles: salesRoles,
        requiredModule: 'customer-display',
      },
      {
        nameKey: 'items.mobileWaiter',
        href: '/m',
        icon: Smartphone,
        allowedRoles: salesRoles,
        requiredModule: 'mobile-waiter',
      },
      {
        nameKey: 'items.restaurantTables',
        href: '/restaurants/tables',
        icon: Table2,
        allowedRoles: adminOnlyRoles,
        requiredModule: 'pos-touch',
      },
    ],
  },
  {
    id: 'operate',
    labelKey: 'operate.label',
    icon: Activity,
    allowedRoles: managerOrAdminRoles,
    defaultRoute: '/operations',
    items: [
      {
        nameKey: 'items.operations',
        href: '/operations',
        icon: Activity,
        allowedRoles: managerOrAdminRoles,
        requiredModule: 'operations-center',
      },
    ],
  },
  {
    id: 'catalog',
    labelKey: 'catalog.label',
    icon: Package,
    allowedRoles: managerOrAdminRoles,
    // ENG-131c — workspace landing route. Header click navigates here;
    // deep links to leaf routes (/products, /categories, …) keep
    // working unchanged.
    defaultRoute: '/catalog',
    items: [
      { nameKey: 'items.products', href: '/products', icon: Package, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.categories', href: '/categories', icon: FolderTree, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.providers', href: '/providers', icon: Truck, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.locations', href: '/locations', icon: MapPinned, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.units', href: '/units', icon: Ruler, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.vatRates', href: '/vat-rates', icon: BadgePercent, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.customerCatalogs', href: '/customer-catalogs', icon: ClipboardList, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.geography', href: '/geography', icon: Map, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.receiptTemplates', href: '/receipt-templates', icon: Receipt, allowedRoles: adminOnlyRoles },
    ],
  },
  {
    id: 'inventory',
    labelKey: 'inventory.label',
    icon: Warehouse,
    allowedRoles: managerOrAdminRoles,
    defaultRoute: '/inventory',
    items: [
      { nameKey: 'items.inventory', href: '/inventory', icon: Warehouse, allowedRoles: managerOrAdminRoles },
    ],
  },
  {
    id: 'procurement',
    labelKey: 'procurement.label',
    icon: ShoppingBasket,
    allowedRoles: managerOrAdminRoles,
    // ENG-131c — workspace landing route. Header click navigates here.
    defaultRoute: '/procurement',
    items: [
      { nameKey: 'items.orders', href: '/orders', icon: ClipboardList, allowedRoles: managerOrAdminRoles },
      { nameKey: 'items.purchases', href: '/purchases', icon: ShoppingBasket, allowedRoles: managerOrAdminRoles },
      {
        nameKey: 'items.quotations',
        href: '/quotations',
        icon: FileText,
        allowedRoles: managerOrAdminRoles,
        requiredModule: 'quotations',
      },
      {
        nameKey: 'items.delivery',
        href: '/delivery',
        icon: Truck,
        allowedRoles: managerOrAdminRoles,
        requiredModule: 'delivery',
      },
    ],
  },
  {
    id: 'customers',
    labelKey: 'customers.label',
    icon: Users,
    allowedRoles: managerOrAdminRoles,
    defaultRoute: '/customers',
    items: [
      { nameKey: 'items.customers', href: '/customers', icon: Users, allowedRoles: managerOrAdminRoles },
    ],
  },
  {
    id: 'finance',
    labelKey: 'finance.label',
    icon: HandCoins,
    allowedRoles: adminOnlyRoles,
    // ENG-131c — workspace landing route. Header click navigates here.
    defaultRoute: '/finance',
    items: [
      { nameKey: 'items.fiscalDocuments', href: '/fiscal-documents', icon: FileSignature, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.fiscalReports', href: '/fiscal-reports', icon: PieChart, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.auditLogs', href: '/audit-logs', icon: ShieldCheck, allowedRoles: adminOnlyRoles },
    ],
  },
  {
    id: 'setup',
    labelKey: 'setup.label',
    icon: Building2,
    allowedRoles: adminOnlyRoles,
    defaultRoute: '/company',
    items: [
      { nameKey: 'items.company', href: '/company', icon: Building2, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.sites', href: '/sites', icon: Store, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.sequentials', href: '/sequentials', icon: FileDigit, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.peripherals', href: '/peripherals', icon: Plug, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.users', href: '/users', icon: Users, allowedRoles: adminOnlyRoles },
      { nameKey: 'items.aiConfig', href: '/settings/ai', icon: Sparkles, allowedRoles: adminOnlyRoles },
    ],
  },
];

function canAccessRole(
  role: UserRole | undefined,
  allowedRoles: readonly UserRole[]
): boolean {
  if (!role) return false;
  return (allowedRoles as readonly string[]).includes(role);
}

/**
 * Filter a single workspace's items by role + active module map.
 * Returns the items the operator can actually navigate to right
 * now. Reused by both the sidebar renderer and the unit tests.
 */
export function visibleItemsForWorkspace(
  workspace: Workspace,
  role: UserRole | undefined,
  modules: Partial<Record<ClientModuleId, boolean>>,
  modulesReady = true
): readonly WorkspaceItem[] {
  return workspace.items.filter(item => {
    if (!canAccessRole(role, item.allowedRoles)) return false;
    if (item.requiredModule && (!modulesReady || modules[item.requiredModule] !== true)) {
      return false;
    }
    return true;
  });
}

export interface VisibleWorkspace {
  workspace: Workspace;
  items: readonly WorkspaceItem[];
}

/**
 * Return the workspaces the operator can SEE in the sidebar, paired
 * with the items that survive role + module filtering. A workspace
 * with zero visible items is omitted entirely — the header would
 * be misleading without anything to expand into.
 */
export function visibleWorkspacesForRole(
  role: UserRole | undefined,
  modules: Partial<Record<ClientModuleId, boolean>>,
  modulesReady = true
): readonly VisibleWorkspace[] {
  const out: VisibleWorkspace[] = [];
  for (const workspace of WORKSPACES) {
    if (!canAccessRole(role, workspace.allowedRoles)) continue;
    const items = visibleItemsForWorkspace(workspace, role, modules, modulesReady);
    if (items.length === 0) continue;
    out.push({ workspace, items });
  }
  return out;
}

/**
 * Test-only surface for the route-mapping invariant: every route
 * the old sidebar declared must live under exactly one workspace
 * (plus Dashboard). Adding a new route without registering it here
 * means the operator will not see it in the sidebar.
 */
export const __WORKSPACE_ROUTE_INVARIANT_FOR_TESTS = {
  topLevel: [TOP_LEVEL_DASHBOARD.href],
  workspaceHrefs: WORKSPACES.flatMap(w => w.items.map(item => item.href)),
};
