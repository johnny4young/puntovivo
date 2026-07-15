/**
 * Auth router — read procedures (ENG-178 split).
 *
 * `me` (protectedProcedure) — current user + tenant + schema version.
 *
 * @module trpc/routers/auth/queries
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import { protectedProcedure } from '../../middleware/auth.js';
import { cashierManagerOrAdminProcedure } from '../../middleware/roles.js';
import { users, tenants } from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';

export const authQueryProcedures = {
  /** Active same-tenant cashiers available for shared-terminal switching. */
  switchableCashiers: cashierManagerOrAdminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        staffPinHash: users.staffPinHash,
      })
      .from(users)
      .where(
        and(
          eq(users.tenantId, ctx.tenantId),
          eq(users.role, 'cashier'),
          eq(users.isActive, true),
          ne(users.id, ctx.user!.id)
        )
      )
      .orderBy(asc(users.name))
      .all();

    return rows.map(({ staffPinHash, ...cashier }) => ({
      ...cashier,
      hasPin: staffPinHash !== null,
    }));
  }),

  /**
   * Get current authenticated user info
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    // Get full user info
    const user = await ctx.db.select().from(users).where(eq(users.id, ctx.user.id)).get();

    if (!user) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'AUTH_USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    // Get tenant info
    const tenant = await ctx.db.select().from(tenants).where(eq(tenants.id, user.tenantId)).get();

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            settings: tenant.settings,
            createdAt: tenant.createdAt,
            updatedAt: tenant.updatedAt,
          }
        : null,
    };
  }),
};
