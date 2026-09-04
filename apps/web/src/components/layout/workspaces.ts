/**
 * Canonical workspace catalogue for the sidebar.
 *
 * The sidebar previously rendered four flat sections (`overview`,
 * `flow`, `surfaces`, `setup`) carrying 32 individual route entries.
 * Admin saw all of them collapsed into one wall of links — the
 * the former flat navigation made the app unnecessarily dense.
 *
 * This module is the source of truth for the new model: eight
 * role-shaped workspaces (Sell, Operate, Catalog, Inventory,
 * Procurement, Customers, Finance, Setup) that group every
 * existing route under a single click-to-expand header. NO routes
 * move — deep links and direct URLs keep working unchanged. The
 * sidebar component reads this list to render workspace groups +
 * their child NavigationItems.
 *
 * Dashboard is folded into Operate. Operate inherits the dashboard role set so viewer keeps
 * its only eligible destination, while the Operations child remains
 * manager/admin-only. Existing leaf URLs remain canonical on purpose:
 * redirecting `/products`, `/orders`, etc. would add churn without a
 * user-visible benefit and would weaken the direct-link contract.
 *
 * @module components/layout/workspaces
 */

import {
  Radio,
  BookOpenCheck,
  Activity,
  BadgePercent,
  Building2,
  CalendarDays,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  FileDigit,
  FileSignature,
  FileText,
  FileUp,
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
  allRoles,
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
  /** Route path consumed by `react-router NavLink`. */
  href: string;
  icon: LucideIcon;
  allowedRoles: readonly UserRole[];
  /**
   * Optional `RequireModule` parity gate. The sidebar reads
   * `useModulesSnapshot()` and hides items whose module is off,
   * mirroring how the router redirects away from disabled modules.
   */
  requiredModule?: ClientModuleId;
  /** Directory section used to present the route as an operator task. */
  directoryGroup?: string;
}

export interface WorkspaceDirectoryGroup {
  /** Stable identifier referenced by `WorkspaceItem.directoryGroup`. */
  id: string;
  /** i18n keys under the `workspaces:*` namespace. */
  labelKey: string;
  descriptionKey: string;
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
  /** Default landing route used by the workspace header. */
  defaultRoute: string;
  /** Ordered list of route entries that nest under this workspace. */
  items: readonly WorkspaceItem[];
  /**
   * Task-oriented sections for a dedicated workspace directory.
   * When present, the sidebar links back to the directory instead of
   * reproducing every leaf route in the shell.
   */
  directoryGroups?: readonly WorkspaceDirectoryGroup[];
}

/**
 * Eight role-shaped workspaces. The mapping preserves every route from
 * the former four-section sidebar.
 */
export const WORKSPACES: readonly Workspace[] = [
  {
    id: 'sell',
    labelKey: 'sell.label',
    icon: ShoppingCart,
    // Viewer sees only Companion when that opt-in module is enabled; the
    // remaining Sell items keep their narrower child-level role gates.
    allowedRoles: allRoles,
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
        // Read-only owner/viewer view backed by the minimal Companion snapshot.
        // Cashiers remain excluded even though they can access other Sell tools.
        nameKey: 'items.companion',
        href: '/c/',
        icon: Radio,
        allowedRoles: dashboardRoles,
        requiredModule: 'companion',
      },
      {
        nameKey: 'items.reservations',
        href: '/reservations',
        icon: CalendarDays,
        allowedRoles: salesRoles,
        requiredModule: 'dine-in',
      },
      {
        nameKey: 'items.restaurantTables',
        href: '/restaurants/tables',
        icon: Table2,
        allowedRoles: adminOnlyRoles,
        // the table map is dine-in, not merely touch: a quick-service
        // counter runs pos-touch and must not see it.
        requiredModule: 'dine-in',
      },
    ],
  },
  {
    id: 'operate',
    labelKey: 'operate.label',
    icon: Activity,
    // viewer previously reached Dashboard through a separate
    // top-level link. Operate now owns that route, so its workspace gate
    // must match the Dashboard route while the Operations child keeps the
    // narrower manager/admin gate below.
    allowedRoles: dashboardRoles,
    defaultRoute: '/dashboard',
    items: [
      {
        nameKey: 'items.dashboard',
        href: '/dashboard',
        icon: LayoutGrid,
        allowedRoles: dashboardRoles,
      },
      {
        nameKey: 'items.operations',
        href: '/operations',
        icon: Activity,
        allowedRoles: managerOrAdminRoles,
        requiredModule: 'operations-center',
      },
      {
        nameKey: 'items.dayClose',
        href: '/day-close',
        icon: ClipboardCheck,
        allowedRoles: managerOrAdminRoles,
      },
      {
        nameKey: 'items.schedule',
        href: '/schedule',
        icon: CalendarDays,
        allowedRoles: managerOrAdminRoles,
      },
    ],
  },
  {
    id: 'catalog',
    labelKey: 'catalog.label',
    icon: Package,
    allowedRoles: managerOrAdminRoles,
    // workspace landing route. Header click navigates here;
    // deep links to leaf routes (/products, /categories, …) keep
    // working unchanged.
    defaultRoute: '/catalog',
    directoryGroups: [
      {
        id: 'offer',
        labelKey: 'directories.catalog.offer.label',
        descriptionKey: 'directories.catalog.offer.description',
      },
      {
        id: 'supply',
        labelKey: 'directories.catalog.supply.label',
        descriptionKey: 'directories.catalog.supply.description',
      },
      {
        id: 'fiscal',
        labelKey: 'directories.catalog.fiscal.label',
        descriptionKey: 'directories.catalog.fiscal.description',
      },
    ],
    items: [
      {
        nameKey: 'items.products',
        href: '/products',
        icon: Package,
        allowedRoles: managerOrAdminRoles,
        directoryGroup: 'offer',
      },
      {
        nameKey: 'items.promotions',
        href: '/promotions',
        icon: BadgePercent,
        allowedRoles: managerOrAdminRoles,
        directoryGroup: 'offer',
      },
      {
        nameKey: 'items.categories',
        href: '/categories',
        icon: FolderTree,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'offer',
      },
      {
        nameKey: 'items.providers',
        href: '/providers',
        icon: Truck,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'supply',
      },
      {
        nameKey: 'items.locations',
        href: '/locations',
        icon: MapPinned,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'supply',
      },
      {
        nameKey: 'items.units',
        href: '/units',
        icon: Ruler,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'supply',
      },
      {
        nameKey: 'items.vatRates',
        href: '/vat-rates',
        icon: BadgePercent,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'fiscal',
      },
      {
        nameKey: 'items.customerCatalogs',
        href: '/customer-catalogs',
        icon: ClipboardList,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'fiscal',
      },
      {
        nameKey: 'items.geography',
        href: '/geography',
        icon: Map,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'fiscal',
      },
      {
        nameKey: 'items.receiptTemplates',
        href: '/receipt-templates',
        icon: Receipt,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'fiscal',
      },
    ],
  },
  {
    id: 'inventory',
    labelKey: 'inventory.label',
    icon: Warehouse,
    allowedRoles: managerOrAdminRoles,
    defaultRoute: '/inventory',
    items: [
      {
        nameKey: 'items.inventory',
        href: '/inventory',
        icon: Warehouse,
        allowedRoles: managerOrAdminRoles,
      },
    ],
  },
  {
    id: 'procurement',
    labelKey: 'procurement.label',
    icon: ShoppingBasket,
    allowedRoles: managerOrAdminRoles,
    // workspace landing route. Header click navigates here.
    defaultRoute: '/procurement',
    directoryGroups: [
      {
        id: 'plan',
        labelKey: 'directories.procurement.plan.label',
        descriptionKey: 'directories.procurement.plan.description',
      },
      {
        id: 'receive',
        labelKey: 'directories.procurement.receive.label',
        descriptionKey: 'directories.procurement.receive.description',
      },
    ],
    items: [
      {
        nameKey: 'items.orders',
        href: '/orders',
        icon: ClipboardList,
        allowedRoles: managerOrAdminRoles,
        directoryGroup: 'plan',
      },
      {
        nameKey: 'items.purchases',
        href: '/purchases',
        icon: ShoppingBasket,
        allowedRoles: managerOrAdminRoles,
        directoryGroup: 'receive',
      },
      {
        nameKey: 'items.providerPayables',
        href: '/provider-payables',
        icon: Receipt,
        allowedRoles: managerOrAdminRoles,
        directoryGroup: 'receive',
      },
      {
        nameKey: 'items.quotations',
        href: '/quotations',
        icon: FileText,
        allowedRoles: managerOrAdminRoles,
        requiredModule: 'quotations',
        directoryGroup: 'plan',
      },
      {
        nameKey: 'items.externalOrders',
        href: '/external-orders',
        icon: Truck,
        allowedRoles: managerOrAdminRoles,
        requiredModule: 'delivery',
        directoryGroup: 'receive',
      },
      {
        nameKey: 'items.delivery',
        href: '/delivery',
        icon: Truck,
        allowedRoles: managerOrAdminRoles,
        requiredModule: 'delivery',
        directoryGroup: 'receive',
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
      {
        nameKey: 'items.customers',
        href: '/customers',
        icon: Users,
        allowedRoles: managerOrAdminRoles,
      },
    ],
  },
  {
    id: 'finance',
    labelKey: 'finance.label',
    icon: HandCoins,
    allowedRoles: adminOnlyRoles,
    // workspace landing route. Header click navigates here.
    defaultRoute: '/finance',
    directoryGroups: [
      {
        id: 'billing',
        labelKey: 'directories.finance.billing.label',
        descriptionKey: 'directories.finance.billing.description',
      },
      {
        id: 'control',
        labelKey: 'directories.finance.control.label',
        descriptionKey: 'directories.finance.control.description',
      },
    ],
    items: [
      {
        nameKey: 'items.fiscalDocuments',
        href: '/fiscal-documents',
        icon: FileSignature,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'billing',
      },
      {
        nameKey: 'items.fiscalReports',
        href: '/fiscal-reports',
        icon: PieChart,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'billing',
      },
      {
        nameKey: 'items.profitability',
        href: '/profitability',
        icon: BadgePercent,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'control',
      },
      {
        nameKey: 'items.accountingExport',
        href: '/accounting-export',
        icon: BookOpenCheck,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'control',
      },
      {
        nameKey: 'items.auditLogs',
        href: '/audit-logs',
        icon: ShieldCheck,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'control',
      },
    ],
  },
  {
    id: 'setup',
    labelKey: 'setup.label',
    icon: Building2,
    allowedRoles: adminOnlyRoles,
    defaultRoute: '/setup',
    directoryGroups: [
      {
        id: 'business',
        labelKey: 'directories.setup.business.label',
        descriptionKey: 'directories.setup.business.description',
      },
      {
        id: 'continuity',
        labelKey: 'directories.setup.continuity.label',
        descriptionKey: 'directories.setup.continuity.description',
      },
      {
        id: 'experience',
        labelKey: 'directories.setup.experience.label',
        descriptionKey: 'directories.setup.experience.description',
      },
    ],
    items: [
      {
        nameKey: 'items.company',
        href: '/company',
        icon: Building2,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'business',
      },
      {
        nameKey: 'items.designSystem',
        href: '/design-system',
        icon: LayoutGrid,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'experience',
      },
      {
        nameKey: 'items.dataImport',
        href: '/data-import',
        icon: FileUp,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'continuity',
      },
      {
        nameKey: 'items.sites',
        href: '/sites',
        icon: Store,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'business',
      },
      {
        nameKey: 'items.sequentials',
        href: '/sequentials',
        icon: FileDigit,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'continuity',
      },
      {
        nameKey: 'items.peripherals',
        href: '/peripherals',
        icon: Plug,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'business',
      },
      {
        nameKey: 'items.users',
        href: '/users',
        icon: Users,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'business',
      },
      {
        nameKey: 'items.aiConfig',
        href: '/settings/ai',
        icon: Sparkles,
        allowedRoles: adminOnlyRoles,
        directoryGroup: 'experience',
      },
    ],
  },
];

function canAccessRole(role: UserRole | undefined, allowedRoles: readonly UserRole[]): boolean {
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
  /** First route this role can actually open, or the dedicated directory. */
  landingRoute: string;
}

/** Match a canonical route and its descendants, including trailing-slash roots. */
export function routeOwnsPath(route: string, pathname: string): boolean {
  const base = route.length > 1 ? route.replace(/\/$/, '') : route;
  return pathname === base || pathname === `${base}/` || pathname.startsWith(`${base}/`);
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
    const hasDirectory = (workspace.directoryGroups?.length ?? 0) > 0;
    const landingRoute =
      hasDirectory || items.some(item => item.href === workspace.defaultRoute)
        ? workspace.defaultRoute
        : items[0]!.href;
    out.push({ workspace, items, landingRoute });
  }
  return out;
}

/**
 * Test-only surface for the route-mapping invariant: every route
 * the old sidebar declared must live under exactly one workspace.
 * Adding a new route without registering it here
 * means the operator will not see it in the sidebar.
 */
export const __WORKSPACE_ROUTE_INVARIANT_FOR_TESTS = {
  workspaceHrefs: WORKSPACES.flatMap(w => w.items.map(item => item.href)),
};
