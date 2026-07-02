/**
 * Auth router — write procedures (ENG-178 split).
 *
 * `login` / `refresh` (publicProcedure — pre-auth, rate-limited), `logout` /
 * `changePassword` (protected / critical-command), `realtimeToken` /
 * `registerDevice` (tenant). The public-vs-protected boundary is carried by
 * each procedure's builder, preserved verbatim. ENG-008/025/052/074/166, ADR-0002.
 *
 * @module trpc/routers/auth/mutations
 */
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { publicProcedure } from '../../init.js';
import { protectedProcedure } from '../../middleware/auth.js';
import { tenantProcedure } from '../../middleware/tenant.js';
import { criticalCommandProcedure } from '../../middleware/criticalCommand.js';
import { users, tenants } from '../../../db/schema.js';
import { loginInput, changePasswordInput, validatePasswordStrength } from '../../schemas/auth.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { registerDevice as registerDeviceService } from '../../../services/devices/devicesService.js';
import { assertTenantSite, claimPairingCodeForDevice, inferAuthorityRole } from '../../../services/devices/authority.js';
import { getCurrentSchemaVersion } from '../../../lib/runtimeMetadata.js';
import { REALTIME_TOKEN_MAX_AGE_SECONDS, clearRefreshCookie, signAccessToken, signRealtimeToken, signRefreshToken, verifyRefreshToken } from '../../../security/authTokens.js';
import { checkIp as checkLoginIp, checkUsername as checkLoginUsername, registerFailure as registerLoginFailure, registerSuccess as registerLoginSuccess } from '../../../security/loginRateLimit.js';
import { getDummyPasswordHash, hashPasswordSecurely, needsRehash, verifyPasswordSecurely } from '../../../security/passwords.js';
import { createRefreshFamily, pruneExpiredRefreshFamilies, revokeRefreshFamiliesForUser, rotateRefreshFamily } from '../../../security/refreshTokenFamilies.js';
import { rateLimitFor } from '../../middleware/procedureRateLimit.js';
import { setRefreshCookie, setRealtimeCookie } from './helpers.js';

export const authMutationProcedures = {
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
      // ENG-166 — equalise login timing. Burn roughly one Argon2 verify on
      // the not-found branch against a cached dummy hash so an attacker
      // cannot enumerate accounts by measuring response time. The result
      // is intentionally ignored; the surrounding error is still raised.
      const dummyHash = await getDummyPasswordHash();
      await verifyPasswordSecurely(dummyHash, password);
      registerLoginFailure(ctx.db, ip, email);
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    // Verify password (ENG-166 — wrapped helper pins Argon2 params).
    // The verify runs BEFORE the `isActive` check so a disabled-account
    // probe pays the same Argon2 cost as the not-found probe. Without
    // this re-ordering, an attacker could distinguish "user exists but
    // is disabled" from "user does not exist" via response timing.
    const isValidPassword = await verifyPasswordSecurely(user.passwordHash, password);
    if (!isValidPassword) {
      registerLoginFailure(ctx.db, ip, email);
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    // Check if user is active (after the password verify so the
    // disabled-account branch carries the same latency profile).
    if (!user.isActive) {
      registerLoginFailure(ctx.db, ip, email);
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_USER_DISABLED',
        message: 'Your account has been disabled. Please contact an administrator.',
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

    // ENG-166 — lazy rehash: if the stored hash was produced with
    // weaker Argon2 params (or a legacy library default), upgrade it
    // now while we have the plaintext. Failure of the rehash itself
    // must never block a valid login — it is best-effort hardening.
    if (needsRehash(user.passwordHash)) {
      try {
        const upgradedHash = await hashPasswordSecurely(password);
        await ctx.db
          .update(users)
          .set({ passwordHash: upgradedHash, updatedAt: new Date().toISOString() })
          .where(eq(users.id, user.id));
      } catch {
        // Swallow — the user is already authenticated; the next login
        // will retry the rehash.
      }
    }

    // Auditoría 2026-07 — refresh rotation: each login starts a token
    // family so `auth.refresh` can detect replay of rotated tokens.
    // Login is also the low-frequency hook for pruning expired families.
    pruneExpiredRefreshFamilies(ctx.db);
    const family = createRefreshFamily(ctx.db, {
      tenantId: user.tenantId,
      userId: user.id,
    });

    const token = signAccessToken(ctx.req.server, user);
    const refreshToken = signRefreshToken(ctx.req.server, user, family);
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
    // The sessionVersion bump already invalidates every refresh JWT;
    // dropping the family rows keeps the table free of dead sessions.
    revokeRefreshFamiliesForUser(ctx.db, ctx.user.id);
    clearRefreshCookie(ctx.req, ctx.res);
    return { success: true, message: 'Logged out successfully' };
  }),

  /**
   * Refresh the JWT token. ENG-166 — per-IP cap of 30/min to blunt
   * refresh-storm probing without affecting normal session lifecycles
   * (a renderer refreshes every ~14 minutes against the 15-min access
   * token TTL).
   */
  refresh: publicProcedure
    .use(rateLimitFor({ name: 'auth.refresh', max: 30, windowMs: 60_000, keyBy: ['ip'] }))
    .mutation(async ({ ctx }) => {
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

    // Auditoría 2026-07 — rotation with replay detection. A verified
    // token whose jti was already rotated away is a stolen copy: the
    // rotate call revoked the family and bumped sessionVersion, so we
    // clear the cookie and reject. Tokens without a familyId were signed
    // before this feature — accept once and upgrade into a fresh family
    // (the grace closes itself when those tokens age out at 7 days).
    let family: { familyId: string; jti: string };
    if (refreshPayload.familyId && refreshPayload.jti) {
      const rotation = rotateRefreshFamily(ctx.db, {
        familyId: refreshPayload.familyId,
        presentedJti: refreshPayload.jti,
        userId: user.id,
      });
      if (rotation.status !== 'rotated') {
        clearRefreshCookie(ctx.req, ctx.res);
        throwServerError({
          trpcCode: 'UNAUTHORIZED',
          errorCode: 'AUTH_REFRESH_INVALID',
          message: 'Refresh session is invalid or missing',
        });
      }
      family = { familyId: rotation.familyId, jti: rotation.jti };
    } else {
      family = createRefreshFamily(ctx.db, {
        tenantId: user.tenantId,
        userId: user.id,
      });
    }

    const token = signAccessToken(ctx.req.server, user);
    const refreshToken = signRefreshToken(ctx.req.server, user, family);
    setRefreshCookie(ctx.req, ctx.res, refreshToken);

    return { token };
  }),

  /**
   * Issue a short-lived bearer for browser-native EventSource
   * subscriptions. EventSource cannot attach custom Authorization
   * headers, so the web client exchanges its normal authenticated tRPC
   * session for this scoped token and passes it on the subscribe URL.
   */
  realtimeToken: tenantProcedure.mutation(async ({ ctx }) => {
    if (!ctx.user) {
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        message: 'authenticated tenant context required',
      });
    }

    const user = await ctx.db.select().from(users).where(eq(users.id, ctx.user.id)).get();

    if (!user || !user.isActive || user.tenantId !== ctx.tenantId) {
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        message: 'authenticated tenant context required',
      });
    }

    setRealtimeCookie(ctx.req, ctx.res, signRealtimeToken(ctx.req.server, user));

    return {
      expiresInSeconds: REALTIME_TOKEN_MAX_AGE_SECONDS,
    };
  }),

  /**
   * Change password for current user.
   *
   * ENG-052 — wrapped with `criticalCommandProcedure` (ADR-0002).
   * Caller must include the `x-device-id` header (after registering
   * via `auth.registerDevice`) and a fresh `x-puntovivo-envelope`
   * JSON header per request. Replays with the same idempotency key
   * return the cached result; mismatched payload hash raises
   * `IDEMPOTENCY_KEY_CONFLICT`.
   */
  changePassword: criticalCommandProcedure
    .use(
      rateLimitFor({
        name: 'auth.changePassword',
        max: 5,
        windowMs: 15 * 60_000,
        keyBy: ['userId'],
      })
    )
    .input(changePasswordInput)
    .mutation(async ({ ctx, input }) => {
    const { currentPassword, newPassword } = input;

    // Defensive narrowing — the criticalCommandProcedure chain
    // already requires an authenticated tenant context, but tRPC
    // type inference loses the `ctx.user` narrowing across our
    // envelope middleware's bespoke return shape. Cheap belt-and-
    // suspenders so the rest of the body can dereference cleanly.
    if (!ctx.user) {
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        message: 'authenticated context required',
      });
    }
    const actorId = ctx.user.id;

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
    const user = await ctx.db.select().from(users).where(eq(users.id, actorId)).get();

    if (!user) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'AUTH_USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    // Verify current password (ENG-166 — pinned Argon2 params).
    const isValidPassword = await verifyPasswordSecurely(user.passwordHash, currentPassword);
    if (!isValidPassword) {
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'AUTH_CURRENT_PASSWORD_INCORRECT',
        message: 'Current password is incorrect',
      });
    }

    // Hash new password (ENG-166 — pinned Argon2 params).
    const newPasswordHash = await hashPasswordSecurely(newPassword);

    // Update password
    await ctx.db
      .update(users)
      .set({
        passwordHash: newPasswordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, actorId));

    // Same hygiene as logout: the bump invalidates the JWTs, the delete
    // clears the now-dead family rows.
    revokeRefreshFamiliesForUser(ctx.db, actorId);
    clearRefreshCookie(ctx.req, ctx.res);

    return { success: true, message: 'Password changed successfully' };
  }),

  /**
   * ENG-052 — Register a device with the active tenant. Idempotent
   * when an existing active device id is supplied. Returns the
   * server-issued (or echoed) device id; the renderer persists it
   * locally (Electron userData file or browser localStorage) and
   * sends it as `x-device-id` on every critical mutation.
   *
   * Skipped on read queries and catalog mutations (per ADR-0002);
   * called once after `auth.login` succeeds.
   */
  registerDevice: tenantProcedure
    .use(
      // ENG-166 — cap pairing-flow registration at 10/hour per IP. The
      // legitimate flow registers once per device install; bursts above
      // that indicate enumeration or pairing-code probing.
      rateLimitFor({
        name: 'auth.registerDevice',
        max: 10,
        windowMs: 60 * 60_000,
        keyBy: ['ip'],
      })
    )
    .input(
      z.object({
        // ENG-074 — `hub_client` discriminates a cashier terminal
        // whose renderer points at a remote Store Hub. Stays in
        // lockstep with the `devices.kind` enum in db/schema.ts.
        kind: z.enum(['desktop', 'web', 'hub_client']),
        name: z.string().min(1).max(120),
        deviceId: z.string().min(8).max(64).optional(),
        siteId: z.string().min(1).optional(),
        pairingCode: z.string().min(4).max(32).optional(),
        appVersion: z.string().min(1).max(80).nullable().optional(),
        dbSchemaVersion: z.number().int().nonnegative().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // tenantProcedure already narrows ctx.user via protectedProcedure;
      // the explicit narrowing here is defensive against TS inference
      // edge-cases when extending the auth router (mirrors the pattern
      // used elsewhere in this file).
      if (!ctx.user || !ctx.tenantId) {
        throwServerError({
          trpcCode: 'UNAUTHORIZED',
          errorCode: 'AUTH_INVALID_CREDENTIALS',
          message: 'authenticated tenant context required',
        });
      }
      if (input.siteId) {
        await assertTenantSite(ctx.db, ctx.tenantId, input.siteId);
      }
      const result = await registerDeviceService(ctx.db, {
        tenantId: ctx.tenantId,
        userId: ctx.user.id,
        kind: input.kind,
        name: input.name,
        deviceId: input.deviceId,
        authorityRole: inferAuthorityRole(input.kind),
        pairedSiteId: input.siteId ?? null,
        appVersion: input.appVersion ?? null,
        dbSchemaVersion: input.dbSchemaVersion ?? getCurrentSchemaVersion(ctx.db),
        metadata: input.metadata,
      });
      if (input.pairingCode) {
        await claimPairingCodeForDevice(ctx.db, {
          tenantId: ctx.tenantId,
          code: input.pairingCode,
          deviceId: result.deviceId,
          actorUserId: ctx.user.id,
        });
      }
      return result;
    }),
};
