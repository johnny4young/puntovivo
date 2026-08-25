/**
 * (slice A) — Command Palette action catalogue.
 *
 * Declarative list of every action the Cmd/Ctrl+K palette can
 * fire. Each entry is filtered by the active user's role before
 * being shown — so a cashier never sees `/audit-logs` or
 * `/company`. Filtering re-uses the same role tuples App.tsx
 * declares for `ShellRoute`, keeping a single source of truth.
 *
 * Actions are pure descriptors: `perform(ctx)` receives a small
 * context with `navigate` (react-router) and `logout`
 * (AuthProvider). The palette wires the actual call sites; this
 * file knows nothing about React internals.
 *
 * @module lib/commandPaletteActions
 */

import type { NavigateFunction } from 'react-router';
import { adminOnlyRoles, managerOrAdminRoles, salesRoles } from '@/features/auth/roleAccess';
import type { ClientModuleId } from '@/features/modules';
import { useQuickCreateStore } from '@/features/sales/useQuickCreateStore';
import { PRIMARY_TASKS } from '@/components/layout/taskRegistry';
import type { UserRole } from '@/types';

export interface CommandActionContext {
  navigate: NavigateFunction;
  logout: () => Promise<void>;
  /**
   * () — omnibox sell handler wired by CommandPaletteBody
   * (it needs React context: trpc utils, cart store owner, toasts). The
   * synthetic "Vender «query»" row calls it with the raw typed query.
   * Optional so the static catalogue and its tests stay context-free.
   */
  sellQuery?: (query: string) => void | Promise<void>;
}

export interface CommandAction {
  /** Stable id used by tests + telemetry hooks downstream. */
  id: string;
  /** i18n key under the `palette:actions` namespace. */
  labelKey: string;
  /** Optional secondary description shown below the label. */
  descriptionKey?: string;
  /** Optional translated synonyms used only by the task search. */
  keywordsKey?: string;
  /**
   * optional i18n interpolation values for `labelKey`. Lets a
   * synthetic action render the live query inside its label (e.g.
   * "Vender «7702001»") without a bespoke render path.
   */
  labelArgs?: Record<string, string>;
  /**
   * Reference to a `SHORTCUTS` entry id — when present the
   * palette renders the formatted key hint on the right gutter.
   */
  shortcutId?: string;
  /** Roles allowed to see / fire this action. */
  roles: readonly UserRole[];
  /** Optional feature module gate that mirrors the route's RequireModule. */
  requiredModule?: ClientModuleId;
  /** Imperative effect when the user selects the entry. */
  perform(ctx: CommandActionContext): void | Promise<void>;
  /**
   * Optional category for grouping in the palette (V1 unused but
   * declared so a follow-up can group nav vs commands without a
   * shape change).
   */
  group?: 'navigate' | 'command';
}

/**
 * V1 catalogue. Roles mirror `App.tsx` `ShellRoute` declarations
 * exactly — when a route gates by `adminOnlyRoles`, the action
 * declares the same tuple here, so the palette never offers a
 * destination the router would redirect away from.
 */
const NAV_SHORTCUT_BY_HREF: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/sales': 'nav.sales',
  '/inventory': 'nav.inventory',
  '/purchases': 'nav.purchases',
};

export const COMMAND_ACTIONS: readonly CommandAction[] = [
  // Primary tasks are shared with the role-shaped navigation. Existing action
  // ids stay stable so recent usage and automation do not reset.
  ...PRIMARY_TASKS.map<CommandAction>(task => ({
    id: task.commandActionId,
    labelKey: task.labelKey,
    descriptionKey: task.descriptionKey,
    keywordsKey: task.keywordsKey,
    roles: task.commandRoles ?? task.allowedRoles,
    ...(task.requiredModule ? { requiredModule: task.requiredModule } : {}),
    // the global nav combos surface as hints on the same
    // destinations, keyed by href so a route reshuffle cannot desync.
    ...(NAV_SHORTCUT_BY_HREF[task.href] ? { shortcutId: NAV_SHORTCUT_BY_HREF[task.href] } : {}),
    group: 'navigate',
    perform: ({ navigate }) => navigate(task.href),
  })),
  // Less frequent destinations remain searchable without competing for a
  // primary navigation slot.
  {
    id: 'navigate.customers',
    labelKey: 'actions.navigate.customers',
    descriptionKey: 'descriptions.navigate.customers',
    roles: managerOrAdminRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/customers'),
  },
  {
    id: 'navigate.purchases',
    labelKey: 'actions.navigate.purchases',
    descriptionKey: 'descriptions.navigate.purchases',
    shortcutId: 'nav.purchases',
    roles: managerOrAdminRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/purchases'),
  },
  {
    id: 'navigate.quotations',
    labelKey: 'actions.navigate.quotations',
    descriptionKey: 'descriptions.navigate.quotations',
    roles: managerOrAdminRoles,
    requiredModule: 'quotations',
    group: 'navigate',
    perform: ({ navigate }) => navigate('/quotations'),
  },
  {
    id: 'navigate.operations',
    labelKey: 'actions.navigate.operations',
    descriptionKey: 'descriptions.navigate.operations',
    roles: managerOrAdminRoles,
    requiredModule: 'operations-center',
    group: 'navigate',
    perform: ({ navigate }) => navigate('/operations'),
  },
  // Surface Switcher. Each surface is module-gated so the
  // palette never offers a destination the tenant has disabled, and
  // role-gated to mirror App.tsx route gates. POS Touch / KDS /
  // Customer Display / Mobile Waiter are cashier-facing shells;
  // Restaurant Tables is the admin catalog already listed in the
  // "Sell" sidebar workspace.
  {
    id: 'navigate.posTouch',
    labelKey: 'actions.navigate.posTouch',
    descriptionKey: 'descriptions.navigate.posTouch',
    roles: salesRoles,
    requiredModule: 'pos-touch',
    group: 'navigate',
    perform: ({ navigate }) => navigate('/touch'),
  },
  {
    id: 'navigate.kds',
    labelKey: 'actions.navigate.kds',
    descriptionKey: 'descriptions.navigate.kds',
    roles: salesRoles,
    requiredModule: 'kds',
    group: 'navigate',
    perform: ({ navigate }) => navigate('/kds'),
  },
  {
    id: 'navigate.customerDisplay',
    labelKey: 'actions.navigate.customerDisplay',
    descriptionKey: 'descriptions.navigate.customerDisplay',
    roles: salesRoles,
    requiredModule: 'customer-display',
    group: 'navigate',
    perform: ({ navigate }) => navigate('/customer-display'),
  },
  {
    id: 'navigate.mobileWaiter',
    labelKey: 'actions.navigate.mobileWaiter',
    descriptionKey: 'descriptions.navigate.mobileWaiter',
    roles: salesRoles,
    requiredModule: 'mobile-waiter',
    group: 'navigate',
    perform: ({ navigate }) => navigate('/m'),
  },
  {
    id: 'navigate.restaurantTables',
    labelKey: 'actions.navigate.restaurantTables',
    descriptionKey: 'descriptions.navigate.restaurantTables',
    roles: adminOnlyRoles,
    requiredModule: 'dine-in',
    group: 'navigate',
    perform: ({ navigate }) => navigate('/restaurants/tables'),
  },
  // Admin-only surfaces.
  {
    id: 'navigate.dataImport',
    labelKey: 'actions.navigate.dataImport',
    descriptionKey: 'descriptions.navigate.dataImport',
    roles: adminOnlyRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/data-import'),
  },
  {
    id: 'navigate.sites',
    labelKey: 'actions.navigate.sites',
    descriptionKey: 'descriptions.navigate.sites',
    roles: adminOnlyRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/sites'),
  },
  {
    id: 'navigate.users',
    labelKey: 'actions.navigate.users',
    descriptionKey: 'descriptions.navigate.users',
    roles: adminOnlyRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/users'),
  },
  {
    id: 'navigate.peripherals',
    labelKey: 'actions.navigate.peripherals',
    descriptionKey: 'descriptions.navigate.peripherals',
    roles: adminOnlyRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/peripherals'),
  },
  {
    id: 'navigate.auditLogs',
    labelKey: 'actions.navigate.auditLogs',
    descriptionKey: 'descriptions.navigate.auditLogs',
    roles: adminOnlyRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/audit-logs'),
  },
  {
    id: 'navigate.fiscalDocuments',
    labelKey: 'actions.navigate.fiscalDocuments',
    descriptionKey: 'descriptions.navigate.fiscalDocuments',
    roles: adminOnlyRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/fiscal-documents'),
  },
  {
    id: 'navigate.fiscalReports',
    labelKey: 'actions.navigate.fiscalReports',
    descriptionKey: 'descriptions.navigate.fiscalReports',
    roles: adminOnlyRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/fiscal-reports'),
  },

  // Command actions — affect state, not navigation.
  {
    id: 'command.newSale',
    labelKey: 'actions.command.newSale',
    descriptionKey: 'descriptions.command.newSale',
    shortcutId: 'sales.newSale',
    roles: salesRoles,
    group: 'command',
    perform: ({ navigate }) => navigate('/sales', { state: { resetWorkspace: true } }),
  },
  {
    id: 'command.logout',
    labelKey: 'actions.command.logout',
    descriptionKey: 'descriptions.command.logout',
    shortcutId: 'app.logout',
    roles: ['admin', 'manager', 'cashier', 'viewer'] as const,
    group: 'command',
    perform: async ({ logout }) => {
      await logout();
    },
  },
  // quick-create entry points. Both set a transient
  // request in `useQuickCreateStore`; SalesPage subscribes to the
  // store and mounts the corresponding form modal. Both navigate to
  // `/sales` first so the mount actually happens (modals live inside
  // SalesPage, not in the palette).
  {
    id: 'command.createProduct',
    labelKey: 'actions.command.createProduct',
    descriptionKey: 'descriptions.command.createProduct',
    roles: managerOrAdminRoles,
    group: 'command',
    perform: ({ navigate }) => {
      useQuickCreateStore.getState().requestCreateProduct({ defaultName: null });
      navigate('/sales');
    },
  },
  {
    id: 'command.createCustomer',
    labelKey: 'actions.command.createCustomer',
    descriptionKey: 'descriptions.command.createCustomer',
    roles: managerOrAdminRoles,
    group: 'command',
    perform: ({ navigate }) => {
      useQuickCreateStore.getState().requestCreateCustomer({ defaultName: null });
      navigate('/sales');
    },
  },
];

/**
 * Filter the catalogue by the active user's role. Anonymous
 * (`role === undefined`) sees nothing — the palette is only
 * useful inside an authenticated session.
 */
export function visibleActionsForRole(
  role: UserRole | undefined,
  modules: Partial<Record<ClientModuleId, boolean>> = {},
  modulesReady = true
): readonly CommandAction[] {
  if (!role) return [];
  return COMMAND_ACTIONS.filter(action => {
    if (!action.roles.includes(role)) return false;
    if (action.requiredModule && (!modulesReady || modules[action.requiredModule] !== true)) {
      return false;
    }
    return true;
  });
}

/**
 * Substring filter over translated label + description. Returns
 * the actions in the original catalogue order. Empty query
 * returns the full visible list.
 */
export function filterActionsByQuery(
  actions: readonly CommandAction[],
  query: string,
  resolveLabel: (action: CommandAction) => string,
  resolveDescription: (action: CommandAction) => string,
  resolveKeywords: (action: CommandAction) => string = () => ''
): readonly CommandAction[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return actions;
  return actions.filter(action => {
    const label = resolveLabel(action).toLowerCase();
    if (label.includes(normalized)) return true;
    const description = resolveDescription(action).toLowerCase();
    if (description.includes(normalized)) return true;
    return resolveKeywords(action).toLowerCase().includes(normalized);
  });
}
