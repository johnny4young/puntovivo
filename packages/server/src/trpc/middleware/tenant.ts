/**
 * Tenant Middleware
 * 
 * Ensures tenant context exists for multi-tenant operations
 */

import { TRPCError } from '@trpc/server';
import { middleware } from '../init.js';
import { protectedProcedure } from './auth.js';

const requireTenant = middleware(async ({ ctx, next }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Restricted access - tenant context required',
    });
  }

  return next({
    ctx: {
      ...ctx,
      tenantId: ctx.tenantId, // Now TypeScript knows tenantId is not null
    },
  });
});

export const tenantProcedure = protectedProcedure.use(requireTenant);
