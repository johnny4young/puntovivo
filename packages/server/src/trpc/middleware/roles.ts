import { TRPCError } from '@trpc/server';
import { userRoleEnum } from '../../db/schema.js';
import { middleware } from '../init.js';
import { tenantProcedure } from './tenant.js';

type AppUserRole = (typeof userRoleEnum)[number];

function createRoleGuard(
  allowedRoles: readonly AppUserRole[],
  message: string
) {
  return middleware(async ({ ctx, next }) => {
    const role = ctx.user?.role as AppUserRole | undefined;

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
  createRoleGuard(['admin'], 'Only administrators can perform this action')
);

export const managerOrAdminProcedure = tenantProcedure.use(
  createRoleGuard(
    ['admin', 'manager'],
    'Only administrators and managers can perform this action'
  )
);
