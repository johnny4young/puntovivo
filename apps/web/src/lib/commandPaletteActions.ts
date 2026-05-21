/**
 * ENG-105 (slice A) — Command Palette action catalogue.
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

import type { NavigateFunction } from 'react-router-dom';
import {
  adminOnlyRoles,
  dashboardRoles,
  managerOrAdminRoles,
  salesRoles,
} from '@/features/auth/roleAccess';
import type { ClientModuleId } from '@/features/modules';
import type { UserRole } from '@/types';

export interface CommandActionContext {
  navigate: NavigateFunction;
  logout: () => Promise<void>;
}

export interface CommandAction {
  /** Stable id used by tests + telemetry hooks downstream. */
  id: string;
  /** i18n key under the `palette:actions` namespace. */
  labelKey: string;
  /** Optional secondary description shown below the label. */
  descriptionKey?: string;
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
export const COMMAND_ACTIONS: readonly CommandAction[] = [
  // Navigation — operator-facing surfaces.
  {
    id: 'navigate.dashboard',
    labelKey: 'actions.navigate.dashboard',
    descriptionKey: 'descriptions.navigate.dashboard',
    roles: dashboardRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/dashboard'),
  },
  {
    id: 'navigate.sales',
    labelKey: 'actions.navigate.sales',
    descriptionKey: 'descriptions.navigate.sales',
    roles: salesRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/sales'),
  },
  {
    id: 'navigate.products',
    labelKey: 'actions.navigate.products',
    descriptionKey: 'descriptions.navigate.products',
    roles: managerOrAdminRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/products'),
  },
  {
    id: 'navigate.customers',
    labelKey: 'actions.navigate.customers',
    descriptionKey: 'descriptions.navigate.customers',
    roles: managerOrAdminRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/customers'),
  },
  {
    id: 'navigate.inventory',
    labelKey: 'actions.navigate.inventory',
    descriptionKey: 'descriptions.navigate.inventory',
    roles: managerOrAdminRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/inventory'),
  },
  {
    id: 'navigate.purchases',
    labelKey: 'actions.navigate.purchases',
    descriptionKey: 'descriptions.navigate.purchases',
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
  // Admin-only surfaces.
  {
    id: 'navigate.company',
    labelKey: 'actions.navigate.company',
    descriptionKey: 'descriptions.navigate.company',
    roles: adminOnlyRoles,
    group: 'navigate',
    perform: ({ navigate }) => navigate('/company'),
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
    roles: salesRoles,
    group: 'command',
    perform: ({ navigate }) =>
      navigate('/sales', { state: { resetWorkspace: true } }),
  },
  {
    id: 'command.logout',
    labelKey: 'actions.command.logout',
    descriptionKey: 'descriptions.command.logout',
    roles: ['admin', 'manager', 'cashier', 'viewer'] as const,
    group: 'command',
    perform: async ({ logout }) => {
      await logout();
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
  modules: Partial<Record<ClientModuleId, boolean>> = {}
): readonly CommandAction[] {
  if (!role) return [];
  return COMMAND_ACTIONS.filter(action => {
    if (!action.roles.includes(role)) return false;
    if (action.requiredModule && modules[action.requiredModule] === false) {
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
  resolveDescription: (action: CommandAction) => string
): readonly CommandAction[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return actions;
  return actions.filter(action => {
    const label = resolveLabel(action).toLowerCase();
    if (label.includes(normalized)) return true;
    const description = resolveDescription(action).toLowerCase();
    return description.includes(normalized);
  });
}
