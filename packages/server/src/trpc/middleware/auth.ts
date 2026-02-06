/**
 * Authentication Middleware
 * 
 * Ensures user is authenticated before accessing protected procedures
 */

import { TRPCError } from '@trpc/server';
import { middleware, publicProcedure } from '../init.js';

const isAuthenticated = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user, // Now TypeScript knows user is not null
    },
  });
});

export const protectedProcedure = publicProcedure.use(isAuthenticated);
