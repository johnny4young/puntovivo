/**
 * Novice-first task catalogue.
 *
 * Routes and permissions remain authoritative elsewhere. This layer projects
 * the most frequent operator goals into a small, role-shaped set that can be
 * reused by navigation and the global task launcher.
 */
import {
  Boxes,
  Building2,
  CalendarCheck2,
  ClipboardCheck,
  PackageSearch,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import type { ClientModuleId } from '@/features/modules';
import type { UserRole } from '@/types';
import {
  adminOnlyRoles,
  dashboardRoles,
  managerOrAdminRoles,
  salesRoles,
} from '@/features/auth/roleAccess';

export type ExperienceMode = 'sell' | 'manage' | 'admin';

export interface PrimaryTask {
  id: 'today' | 'sell' | 'products' | 'inventory' | 'dayClose' | 'businessSetup';
  commandActionId:
    | 'navigate.dashboard'
    | 'navigate.sales'
    | 'navigate.products'
    | 'navigate.inventory'
    | 'navigate.dayClose'
    | 'navigate.company';
  href: string;
  icon: LucideIcon;
  labelKey: string;
  descriptionKey: string;
  keywordsKey: string;
  /** Roles that see the task in the compact primary navigation. */
  allowedRoles: readonly UserRole[];
  /**
   * Optional wider command-launcher audience. A useful task can stay searchable
   * without consuming one of the five novice-facing navigation slots.
   */
  commandRoles?: readonly UserRole[];
  mode: ExperienceMode;
  requiredModule?: ClientModuleId;
}

/**
 * Declaration order is also the default task-launcher order. Role filtering
 * keeps every projection at five primary decisions or fewer.
 */
export const PRIMARY_TASKS: readonly PrimaryTask[] = [
  {
    id: 'today',
    commandActionId: 'navigate.dashboard',
    href: '/dashboard',
    icon: CalendarCheck2,
    labelKey: 'tasks.today.label',
    descriptionKey: 'tasks.today.description',
    keywordsKey: 'tasks.today.keywords',
    allowedRoles: dashboardRoles,
    mode: 'manage',
  },
  {
    id: 'sell',
    commandActionId: 'navigate.sales',
    href: '/sales',
    icon: ShoppingCart,
    labelKey: 'tasks.sell.label',
    descriptionKey: 'tasks.sell.description',
    keywordsKey: 'tasks.sell.keywords',
    allowedRoles: salesRoles,
    mode: 'sell',
  },
  {
    id: 'products',
    commandActionId: 'navigate.products',
    href: '/products',
    icon: PackageSearch,
    labelKey: 'tasks.products.label',
    descriptionKey: 'tasks.products.description',
    keywordsKey: 'tasks.products.keywords',
    allowedRoles: managerOrAdminRoles,
    mode: 'manage',
  },
  {
    id: 'inventory',
    commandActionId: 'navigate.inventory',
    href: '/inventory',
    icon: Boxes,
    labelKey: 'tasks.inventory.label',
    descriptionKey: 'tasks.inventory.description',
    keywordsKey: 'tasks.inventory.keywords',
    allowedRoles: managerOrAdminRoles,
    mode: 'manage',
  },
  {
    id: 'dayClose',
    commandActionId: 'navigate.dayClose',
    href: '/day-close',
    icon: ClipboardCheck,
    labelKey: 'tasks.dayClose.label',
    descriptionKey: 'tasks.dayClose.description',
    keywordsKey: 'tasks.dayClose.keywords',
    allowedRoles: ['manager'] as const,
    commandRoles: managerOrAdminRoles,
    mode: 'manage',
  },
  {
    id: 'businessSetup',
    commandActionId: 'navigate.company',
    href: '/company',
    icon: Building2,
    labelKey: 'tasks.businessSetup.label',
    descriptionKey: 'tasks.businessSetup.description',
    keywordsKey: 'tasks.businessSetup.keywords',
    allowedRoles: adminOnlyRoles,
    mode: 'admin',
  },
];

export function taskOwnsPath(task: PrimaryTask, pathname: string): boolean {
  return pathname === task.href || pathname.startsWith(`${task.href}/`);
}

export function visiblePrimaryTasksForRole(
  role: UserRole | undefined,
  modules: Partial<Record<ClientModuleId, boolean>>,
  modulesReady = true
): readonly PrimaryTask[] {
  if (!role) return [];
  return PRIMARY_TASKS.filter(task => {
    if (!task.allowedRoles.includes(role)) return false;
    if (task.requiredModule && (!modulesReady || modules[task.requiredModule] !== true)) {
      return false;
    }
    return true;
  });
}
