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

import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { router, publicProcedure } from '../init.js';
import { protectedProcedure } from '../middleware/auth.js';
import { users, tenants } from '../../db/schema.js';
import { loginInput, changePasswordInput, validatePasswordStrength } from '../schemas/auth.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../security/authTokens.js';
import {
  checkIp as checkLoginIp,
  checkUsername as checkLoginUsername,
  registerFailure as registerLoginFailure,
  registerSuccess as registerLoginSuccess,
} from '../../security/loginRateLimit.js';

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
   * Login with email and password.
   *
   * ENG-008 — dual rate-limit gate runs BEFORE the credential check:
   *
   * - per-IP bucket: 10 attempts per 60s from a single origin. Stops
   *   local brute-force.
   * - per-username bucket: 5 failed attempts per 15 minutes against one
   *   email, counted even when the user does not exist (prevents
   *   enumeration via timing + 404-style responses). Stops credential
   *   stuffing that rotates IPs to target one account.
   *
   * Both buckets increment on every unauthorized branch. A successful
   * login resets the username bucket; the IP bucket decays via TTL so a
   * single legitimate login does not amnesty an active attack source.
   *
   * The global @fastify/rate-limit plugin at `/api/trpc/*` (100/min)
   * stays as a backstop for the rest of the tRPC surface.
   */
  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    const { email, password } = input;
    const ip = ctx.req.ip;

    // ENG-008 / ENG-008b — refuse before any DB work when the buckets are
    // saturated. Since ENG-008b the buckets are DB-backed so a server restart
    // no longer wipes mid-attack state; pass `ctx.db` through on every call.
    checkLoginIp(ctx.db, ip);
    checkLoginUsername(ctx.db, email);

    // Find user by email
    const user = await ctx.db.select().from(users).where(eq(users.email, email)).get();

    if (!user) {
      registerLoginFailure(ctx.db, ip, email);
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    // Check if user is active
    if (!user.isActive) {
      registerLoginFailure(ctx.db, ip, email);
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_USER_DISABLED',
        message: 'Your account has been disabled. Please contact an administrator.',
      });
    }

    // Verify password
    const isValidPassword = await argon2.verify(user.passwordHash, password);
    if (!isValidPassword) {
      registerLoginFailure(ctx.db, ip, email);
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    // Get tenant info
    const tenant = await ctx.db.select().from(tenants).where(eq(tenants.id, user.tenantId)).get();

    if (!tenant || !tenant.isActive) {
      registerLoginFailure(ctx.db, ip, email);
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_TENANT_DISABLED',
        message: 'Your organization has been disabled. Please contact support.',
      });
    }

    // ENG-008 — clear the username bucket after every field cleared.
    registerLoginSuccess(ctx.db, email);

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
   * Logout — invalidates every outstanding access token issued for
   * the current user by bumping `users.sessionVersion`. The next
   * call to `verifyAccessToken` (or `verifyRefreshToken`) for that
   * user rejects any pre-logout token because the recorded
   * `sessionVersion` no longer matches the JWT payload.
   *
   * Promoted from `publicProcedure` to `protectedProcedure` in
   * ENG-025 vector 4: only an authenticated caller can sign their
   * own session out, and the `ctx.user.id` we need for the bump
   * comes from the validated JWT.
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, ctx.user.id));
    clearRefreshCookie(ctx.res);
    return { success: true, message: 'Logged out successfully' };
  }),

  /**
   * Refresh the JWT token
   */
  refresh: publicProcedure.mutation(async ({ ctx }) => {
    const refreshPayload = await verifyRefreshToken(ctx.req);
    if (!refreshPayload) {
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_REFRESH_INVALID',
        message: 'Refresh session is invalid or missing',
      });
    }

    // Verify user still exists and is active
    const user = await ctx.db.select().from(users).where(eq(users.id, refreshPayload.userId)).get();

    if (!user || !user.isActive) {
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_USER_DISABLED',
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

  /**
   * Change password for current user
   */
  changePassword: protectedProcedure.input(changePasswordInput).mutation(async ({ ctx, input }) => {
    const { currentPassword, newPassword } = input;

    // Validate password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'AUTH_PASSWORD_POLICY',
        message: `Password does not meet security requirements: ${validation.errors.join(', ')}`,
        details: { errors: validation.errors },
      });
    }

    // Get user
    const user = await ctx.db.select().from(users).where(eq(users.id, ctx.user.id)).get();

    if (!user) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'AUTH_USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    // Verify current password
    const isValidPassword = await argon2.verify(user.passwordHash, currentPassword);
    if (!isValidPassword) {
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_CURRENT_PASSWORD_INCORRECT',
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
