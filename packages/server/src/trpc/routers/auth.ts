/**
 * Auth tRPC Router
 *
 * Handles user authentication with JWT tokens.
 * Replaces REST routes/auth.ts with type-safe tRPC procedures.
 *
 * Procedures:
 * - auth.login    (public)    - Authenticate user with email/password
 * - auth.logout   (public)    - Logout (client-side token removal)
 * - auth.refresh  (public)    - Refresh access JWT using refresh cookie
 * - auth.me       (protected) - Get current user info
 * - auth.changePassword (protected) - Change password
 *
 * @module trpc/routers/auth
 */

import { TRPCError } from '@trpc/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { router, publicProcedure } from '../init.js';
import { protectedProcedure } from '../middleware/auth.js';
import { users, tenants } from '../../db/schema.js';
import { loginInput, changePasswordInput, validatePasswordStrength } from '../schemas/auth.js';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../security/authTokens.js';

const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function shouldUseSecureCookies(request: {
  headers: Record<string, unknown>;
  protocol?: string;
}): boolean {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const normalizedForwardedProto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto;

  return request.protocol === 'https' || normalizedForwardedProto === 'https';
}

function setRefreshCookie(request: FastifyRequest, reply: FastifyReply, token: string): void {
  if (typeof reply.setCookie !== 'function') {
    return;
  }

  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    path: '/',
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
}

export const authRouter = router({
  /**
   * Login with email and password
   *
   * NOTE: Rate limiting is handled at the Fastify level via @fastify/rate-limit
   * on the /api/trpc route. Per-procedure rate limiting requires access to the
   * raw Fastify request, which we do via ctx.req in middleware if needed later.
   */
  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    const { email, password } = input;

    // Find user by email
    const user = await ctx.db.select().from(users).where(eq(users.email, email)).get();

    if (!user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Email or password is incorrect',
      });
    }

    // Check if user is active
    if (!user.isActive) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Your account has been disabled. Please contact an administrator.',
      });
    }

    // Verify password
    const isValidPassword = await argon2.verify(user.passwordHash, password);
    if (!isValidPassword) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Email or password is incorrect',
      });
    }

    // Get tenant info
    const tenant = await ctx.db.select().from(tenants).where(eq(tenants.id, user.tenantId)).get();

    if (!tenant || !tenant.isActive) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Your organization has been disabled. Please contact support.',
      });
    }

    const token = signAccessToken(ctx.req.server, user);
    const refreshToken = signRefreshToken(ctx.req.server, user);
    setRefreshCookie(ctx.req, ctx.res, refreshToken);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
    };
  }),

  /**
   * Logout (client-side token removal)
   * Provided for API completeness
   */
  logout: publicProcedure.mutation(({ ctx }) => {
    clearRefreshCookie(ctx.res);
    return { success: true, message: 'Logged out successfully' };
  }),

  /**
   * Refresh the JWT token
   */
  refresh: publicProcedure.mutation(async ({ ctx }) => {
    const refreshPayload = await verifyRefreshToken(ctx.req);
    if (!refreshPayload) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Refresh session is invalid or missing',
      });
    }

    // Verify user still exists and is active
    const user = await ctx.db.select().from(users).where(eq(users.id, refreshPayload.userId)).get();

    if (!user || !user.isActive) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'User not found or disabled',
      });
    }

    const token = signAccessToken(ctx.req.server, user);
    const refreshToken = signRefreshToken(ctx.req.server, user);
    setRefreshCookie(ctx.req, ctx.res, refreshToken);

    return { token };
  }),

  /**
   * Get current authenticated user info
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    // Get full user info
    const user = await ctx.db.select().from(users).where(eq(users.id, ctx.user.id)).get();

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
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

  /**
   * Change password for current user
   */
  changePassword: protectedProcedure.input(changePasswordInput).mutation(async ({ ctx, input }) => {
    const { currentPassword, newPassword } = input;

    // Validate password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Password does not meet security requirements: ${validation.errors.join(', ')}`,
      });
    }

    // Get user
    const user = await ctx.db.select().from(users).where(eq(users.id, ctx.user.id)).get();

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    }

    // Verify current password
    const isValidPassword = await argon2.verify(user.passwordHash, currentPassword);
    if (!isValidPassword) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Current password is incorrect',
      });
    }

    // Hash new password
    const newPasswordHash = await argon2.hash(newPassword);

    // Update password
    await ctx.db
      .update(users)
      .set({
        passwordHash: newPasswordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, ctx.user.id));

    clearRefreshCookie(ctx.res);

    return { success: true, message: 'Password changed successfully' };
  }),
});
