import { TRPCError } from '@trpc/server';
import {
  ADMIN_ONLY_ROLES,
  MANAGER_OR_ADMIN_ROLES,
  SALES_ROLES,
  type UserRole,
} from '@puntovivo/shared/roles';
import { middleware } from '../init.js';
import { tenantProcedure } from './tenant.js';

export function createRoleGuard(allowedRoles: readonly UserRole[], message: string) {
  return middleware(async ({ ctx, next }) => {
    const role = ctx.user?.role as UserRole | undefined;

    if (!role || !allowedRoles.includes(role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message,
      });
    }

    return next();
  });
}

export const adminProcedure = tenantProcedure.use(
  createRoleGuard(ADMIN_ONLY_ROLES, 'Only administrators can perform this action')
);

export const managerOrAdminProcedure = tenantProcedure.use(
  createRoleGuard(
    MANAGER_OR_ADMIN_ROLES,
    'Only administrators and managers can perform this action'
  )
);

export const cashierManagerOrAdminProcedure = tenantProcedure.use(
  createRoleGuard(
    SALES_ROLES,
    'Only cashiers, managers, and administrators can perform this action'
  )
);
