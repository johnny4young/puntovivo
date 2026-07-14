import {
  ADMIN_ONLY_ROLES,
  DASHBOARD_ROLES,
  MANAGER_OR_ADMIN_ROLES,
  SALES_ROLES,
  type UserRole,
} from '@puntovivo/shared/roles';

export interface WorkspaceRoleTemplate {
  id: string;
  labelKey: string;
  allowedRoles: readonly UserRole[];
}

/**
 * ENG-129a — Data-only role template for the permission audit.
 *
 * Keep this module free of React and icon imports: the Users route can explain
 * workspace access without pulling the icon-heavy sidebar catalogue into its
 * lazy chunk or changing ownership of unrelated route modules. A parity test
 * pins this catalogue to the navigation allowlists without coupling their
 * runtime chunks.
 */
export const WORKSPACE_ROLE_TEMPLATES = {
  sell: {
    id: 'sell',
    labelKey: 'workspaces:sell.label',
    allowedRoles: SALES_ROLES,
  },
  operate: {
    id: 'operate',
    labelKey: 'workspaces:operate.label',
    // ENG-131e — Dashboard is the first Operate item, so viewer must keep
    // the same workspace-level access it had through the former top-level
    // Dashboard row. The Operations child remains manager/admin-only.
    allowedRoles: DASHBOARD_ROLES,
  },
  catalog: {
    id: 'catalog',
    labelKey: 'workspaces:catalog.label',
    allowedRoles: MANAGER_OR_ADMIN_ROLES,
  },
  inventory: {
    id: 'inventory',
    labelKey: 'workspaces:inventory.label',
    allowedRoles: MANAGER_OR_ADMIN_ROLES,
  },
  procurement: {
    id: 'procurement',
    labelKey: 'workspaces:procurement.label',
    allowedRoles: MANAGER_OR_ADMIN_ROLES,
  },
  customers: {
    id: 'customers',
    labelKey: 'workspaces:customers.label',
    allowedRoles: MANAGER_OR_ADMIN_ROLES,
  },
  finance: {
    id: 'finance',
    labelKey: 'workspaces:finance.label',
    allowedRoles: ADMIN_ONLY_ROLES,
  },
  setup: {
    id: 'setup',
    labelKey: 'workspaces:setup.label',
    allowedRoles: ADMIN_ONLY_ROLES,
  },
} as const satisfies Record<string, WorkspaceRoleTemplate>;

export const ROLE_PERMISSION_TEMPLATES: readonly WorkspaceRoleTemplate[] =
  Object.values(WORKSPACE_ROLE_TEMPLATES);
