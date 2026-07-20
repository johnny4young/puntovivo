/**
 * Auth tRPC Router Tests
 *
 * Tests auth procedures via appRouter.createCaller() for type-safe testing.
 *
 * @module __tests__/auth.test
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, users, tenants, loginAttempts, devices } from '../db/schema.js';
import { hash, verify } from 'argon2';
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import {
  LOGIN_RATE_LIMIT_IP_MAX,
  LOGIN_RATE_LIMIT_USERNAME_MAX,
  __resetForTests as resetLoginRateLimit,
} from '../security/loginRateLimit.js';
import { createCriticalCommandFixture } from './utils/criticalCommandFixture.js';
import { COMMAND_ENVELOPE_HEADER, DEVICE_ID_HEADER } from '../trpc/schemas/envelope.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { randomUUID } from 'node:crypto';
import { hashStaffPin } from '../security/staffPins.js';
import {
  signAccessToken,
  verifyTokenWithServer,
  type AuthTokenPayload,
} from '../security/authTokens.js';

let server: PuntovivoServer;
let testTenantId: string;
let testUserId: string;
let testCashierId: string;
const testDbPath = ':memory:';

function getCookieValue(
  setCookieHeader: string | string[] | undefined,
  name: string
): string | null {
  const cookieHeaders = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];

  for (const cookieHeader of cookieHeaders) {
    const match = cookieHeader.match(new RegExp(`(?:^|\\s)${name}=([^;]+)`));
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function loginOverHttp() {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/trpc/auth.login?batch=1',
    headers: {
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      '0': {
        email: 'trpctest@example.com',
        password: 'TestPassword123!',
      },
    }),
  });

  return {
    response,
    accessToken: response.json()[0]?.result?.data?.token as string | undefined,
    refreshCookie: getCookieValue(response.headers['set-cookie'], 'puntovivo_refresh'),
    csrfCookie: getCookieValue(response.headers['set-cookie'], 'puntovivo_csrf'),
  };
}

/**
 * Build a tRPC context for use with createCaller.
 * For public procedures, pass no user.
 * For protected procedures, pass user payload.
 */
function createTestContext(userPayload?: {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}): Context {
  const db = getDatabase();

  // Build a minimal mock request that has server.jwt.sign()
  const mockReq = {
    server: server.app,
    headers: {},
    // the login rate-limit service reads `ctx.req.ip`; the
    // Fastify request provides this in production via the connection
    // remote address. Pin a stable value so every createCaller-driven
    // test shares one IP bucket.
    ip: '127.0.0.1',
    user: userPayload
      ? {
          userId: userPayload.id,
          email: userPayload.email,
          role: userPayload.role,
          tenantId: userPayload.tenantId,
        }
      : null,
    jwtVerify: async () => {
      if (!userPayload) throw new Error('No token');
    },
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];

  return {
    req: mockReq,
    res: mockRes,
    db,
    user: userPayload
      ? {
          id: userPayload.id,
          email: userPayload.email,
          role: userPayload.role,
          tenantId: userPayload.tenantId,
        }
      : null,
    tenantId: userPayload?.tenantId ?? null,
    siteId: null,
  };
}

describe('Auth tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: testDbPath,
      verbose: false,
    });

    const db = getDatabase();

    // Create test tenant
    testTenantId = nanoid();
    await db.insert(tenants).values({
      id: testTenantId,
      name: 'Test Tenant',
      slug: 'test-tenant-trpc',
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create test user
    testUserId = nanoid();
    const passwordHash = await hash('TestPassword123!');
    await db.insert(users).values({
      id: testUserId,
      tenantId: testTenantId,
      email: 'trpctest@example.com',
      passwordHash,
      name: 'tRPC Test User',
      role: 'admin',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    testCashierId = nanoid();
    await db.insert(users).values({
      id: testCashierId,
      tenantId: testTenantId,
      email: 'switch.cashier@example.com',
      passwordHash,
      staffPinHash: await hashStaffPin('246810'),
      name: 'Switch Cashier',
      role: 'cashier',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  // /  — the login rate-limit service keeps both
  // module-level cache state AND DB rows across invocations. Reset both
  // between every test so failed-login paths exercised by one case do not
  // saturate the bucket for the next.
  beforeEach(() => {
    resetLoginRateLimit(getDatabase());
  });

  describe('auth.login', () => {
    it('should login with valid credentials', async () => {
      const caller = appRouter.createCaller(createTestContext());

      const result = await caller.auth.login({
        email: 'trpctest@example.com',
        password: 'TestPassword123!',
      });

      expect(result.token).toBeDefined();
      expect(result.token).toBeTypeOf('string');
      expect(result.user.email).toBe('trpctest@example.com');
      expect(result.user.name).toBe('tRPC Test User');
      expect(result.user.role).toBe('admin');
      expect(result.tenant.id).toBe(testTenantId);
      expect(result.tenant.name).toBe('Test Tenant');
    });

    it('should reject invalid password', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(
        caller.auth.login({
          email: 'trpctest@example.com',
          password: 'wrongpassword',
        })
      ).rejects.toThrow(TRPCError);

      try {
        await caller.auth.login({
          email: 'trpctest@example.com',
          password: 'wrongpassword',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('UNAUTHORIZED');
        expect((err as TRPCError).message).toBe('Email or password is incorrect');
        // i18n-4: stable error code is attached via cause so the client can
        // map it to a localized message regardless of server message text.
        const cause = (err as TRPCError).cause;
        expect(cause).toBeInstanceOf(ServerErrorWithCode);
        expect((cause as ServerErrorWithCode).errorCode).toBe('AUTH_INVALID_CREDENTIALS');
      }
    });

    it('should reject non-existent user', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(
        caller.auth.login({
          email: 'nonexistent@example.com',
          password: 'password',
        })
      ).rejects.toThrow(TRPCError);
    });

    it('should reject with Zod validation error for missing fields', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(
        caller.auth.login({
          email: '',
          password: '',
        })
      ).rejects.toThrow();
    });

    it('should reject disabled user', async () => {
      const db = getDatabase();
      const disabledUserId = nanoid();
      const passwordHash = await hash('TestPassword123!');
      await db.insert(users).values({
        id: disabledUserId,
        tenantId: testTenantId,
        email: 'disabled@example.com',
        passwordHash,
        name: 'Disabled User',
        role: 'cashier',
        isActive: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const caller = appRouter.createCaller(createTestContext());

      try {
        await caller.auth.login({
          email: 'disabled@example.com',
          password: 'TestPassword123!',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('UNAUTHORIZED');
        expect((err as TRPCError).message).toContain('disabled');
        const cause = (err as TRPCError).cause;
        expect(cause).toBeInstanceOf(ServerErrorWithCode);
        expect((cause as ServerErrorWithCode).errorCode).toBe('AUTH_USER_DISABLED');
      }
    });
  });

  describe('auth.logout', () => {
    it('should return success when called by an authenticated user', async () => {
      const caller = appRouter.createCaller(
        createTestContext({
          id: testUserId,
          email: 'trpctest@example.com',
          role: 'admin',
          tenantId: testTenantId,
        })
      );
      const result = await caller.auth.logout();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Logged out successfully');
    });

    // vector 4 — logout must promote to protectedProcedure
    // so the bump of sessionVersion has a user id to target. An
    // unauthenticated logout call would have no way to identify
    // whose tokens to invalidate; rejecting it is the correct
    // contract.
    it('should reject unauthenticated callers', async () => {
      const caller = appRouter.createCaller(createTestContext());
      await expect(caller.auth.logout()).rejects.toThrow(TRPCError);
    });

    // vector 4 — the signature feature: every successful
    // logout increments users.sessionVersion. The next access token
    // verification for that user (via verifyAccessToken) sees the
    // mismatch and rejects, even within the 15-minute access TTL.
    // Without this, a leaked access token survives logout for up
    // to 15 minutes.
    it('should bump users.sessionVersion on every successful logout', async () => {
      const db = getDatabase();
      const before = await db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, testUserId))
        .get();
      expect(before?.sessionVersion).toBeDefined();

      const caller = appRouter.createCaller(
        createTestContext({
          id: testUserId,
          email: 'trpctest@example.com',
          role: 'admin',
          tenantId: testTenantId,
        })
      );
      await caller.auth.logout();

      const after = await db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, testUserId))
        .get();
      expect(after?.sessionVersion).toBe((before?.sessionVersion ?? 0) + 1);
    });
  });

  describe('auth.me', () => {
    it('should return current user with valid context', async () => {
      const ctx = createTestContext({
        id: testUserId,
        email: 'trpctest@example.com',
        role: 'admin',
        tenantId: testTenantId,
      });
      const caller = appRouter.createCaller(ctx);

      const result = await caller.auth.me();

      expect(result.user.email).toBe('trpctest@example.com');
      expect(result.user.name).toBe('tRPC Test User');
      expect(result.user.role).toBe('admin');
      expect(result.tenant).not.toBeNull();
      expect(result.tenant!.id).toBe(testTenantId);
    });

    it('should reject unauthenticated request', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(caller.auth.me()).rejects.toThrow(TRPCError);

      try {
        await caller.auth.me();
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('auth staff switching', () => {
    function adminCaller() {
      return appRouter.createCaller(
        createTestContext({
          id: testUserId,
          email: 'trpctest@example.com',
          role: 'admin',
          tenantId: testTenantId,
        })
      );
    }

    it('lists only active same-tenant cashiers and exposes configuration, never hashes', async () => {
      const result = await adminCaller().auth.switchableCashiers();
      expect(result).toContainEqual({
        id: testCashierId,
        name: 'Switch Cashier',
        role: 'cashier',
        hasPin: true,
      });
      expect(JSON.stringify(result)).not.toContain('argon2');
    });

    it('never lists or adopts a PIN-configured cashier from another tenant', async () => {
      const db = getDatabase();
      const foreignTenantId = nanoid();
      const foreignCashierId = nanoid();
      const now = new Date().toISOString();
      await db.insert(tenants).values({
        id: foreignTenantId,
        name: 'Foreign Tenant',
        slug: `foreign-staff-switch-${foreignTenantId}`,
        settings: {},
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(users).values({
        id: foreignCashierId,
        tenantId: foreignTenantId,
        email: `foreign-cashier-${foreignCashierId}@example.com`,
        passwordHash: await hash('ForeignCashier123!'),
        staffPinHash: await hashStaffPin('135790'),
        name: 'Foreign Cashier',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await expect(adminCaller().auth.switchableCashiers()).resolves.not.toContainEqual(
        expect.objectContaining({ id: foreignCashierId })
      );
      await expect(
        adminCaller().auth.switchStaff({ targetUserId: foreignCashierId, pin: '135790' })
      ).rejects.toSatisfy((err: unknown) => {
        const cause = (err as TRPCError).cause;
        return (
          err instanceof TRPCError &&
          err.code === 'UNAUTHORIZED' &&
          cause instanceof ServerErrorWithCode &&
          cause.errorCode === 'AUTH_STAFF_PIN_INVALID'
        );
      });
    });

    it('switches to a cashier, fixes the PIN session ceiling, and audits both identities', async () => {
      const result = await adminCaller().auth.switchStaff({
        targetUserId: testCashierId,
        pin: '246810',
      });
      const payload = await server.app.jwt.verify<AuthTokenPayload>(result.token);
      expect(payload).toMatchObject({
        userId: testCashierId,
        role: 'cashier',
        authMethod: 'staff_pin',
      });
      expect(payload.authSessionExpiresAt).toBeTypeOf('number');
      expect(new Date(result.sessionExpiresAt).getTime()).toBe(payload.authSessionExpiresAt);

      const audit = await getDatabase()
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'auth.staff_switch'), eq(auditLogs.resourceId, testCashierId))
        )
        .get();
      expect(audit?.actorId).toBe(testUserId);
      expect(audit?.before).toEqual({ userId: testUserId, role: 'admin' });
      expect(audit?.after).toEqual({ userId: testCashierId, role: 'cashier' });
      expect(JSON.stringify(audit)).not.toContain('246810');
    });

    it('keeps wrong PIN and unavailable target errors indistinguishable', async () => {
      for (const input of [
        { targetUserId: testCashierId, pin: '111111' },
        { targetUserId: 'foreign-or-missing-user', pin: '111111' },
      ]) {
        await expect(adminCaller().auth.switchStaff(input)).rejects.toSatisfy((err: unknown) => {
          const cause = (err as TRPCError).cause;
          return (
            err instanceof TRPCError &&
            err.code === 'UNAUTHORIZED' &&
            cause instanceof ServerErrorWithCode &&
            cause.errorCode === 'AUTH_STAFF_PIN_INVALID'
          );
        });
      }
    });

    it('never allows a staff PIN to switch into manager or admin privilege', async () => {
      await getDatabase()
        .update(users)
        .set({ staffPinHash: await hashStaffPin('123456') })
        .where(eq(users.id, testUserId));

      await expect(
        adminCaller().auth.switchStaff({ targetUserId: testUserId, pin: '123456' })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('fails closed when a PIN-authenticated token is past its fixed ceiling', async () => {
      const cashier = await getDatabase()
        .select()
        .from(users)
        .where(eq(users.id, testCashierId))
        .get();
      expect(cashier).toBeDefined();
      const expired = signAccessToken(server.app, cashier!, {
        authMethod: 'staff_pin',
        authSessionExpiresAt: Date.now() - 1,
      });
      await expect(verifyTokenWithServer(server.app, expired, 'access')).resolves.toBeNull();
    });
  });

  describe('auth.refresh', () => {
    it('should return a new access token with a valid refresh cookie and csrf header', async () => {
      const { refreshCookie, csrfCookie } = await loginOverHttp();

      expect(refreshCookie).toBeTruthy();
      expect(csrfCookie).toBeTruthy();

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.refresh?batch=1',
        headers: {
          cookie: [`puntovivo_refresh=${refreshCookie}`, `puntovivo_csrf=${csrfCookie}`].join('; '),
          'content-type': 'application/json',
          'x-csrf-token': csrfCookie as string,
        },
        payload: '{}',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()[0].result.data.token).toBeTypeOf('string');
    });

    it('should reject refresh when the refresh cookie is missing', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.refresh?batch=1',
        headers: {
          'content-type': 'application/json',
        },
        payload: '{}',
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects existing tokens when the tenant is disabled', async () => {
      const { accessToken, refreshCookie, csrfCookie } = await loginOverHttp();

      expect(accessToken).toBeTruthy();
      expect(refreshCookie).toBeTruthy();
      expect(csrfCookie).toBeTruthy();

      const db = getDatabase();
      await db
        .update(tenants)
        .set({
          isActive: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tenants.id, testTenantId));

      const meResponse = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/auth.me?batch=1',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(meResponse.statusCode).toBe(401);

      const refreshResponse = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.refresh?batch=1',
        headers: {
          cookie: [`puntovivo_refresh=${refreshCookie}`, `puntovivo_csrf=${csrfCookie}`].join('; '),
          'content-type': 'application/json',
          'x-csrf-token': csrfCookie as string,
        },
        payload: '{}',
      });

      expect(refreshResponse.statusCode).toBe(401);

      await db
        .update(tenants)
        .set({
          isActive: true,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tenants.id, testTenantId));
    });
  });

  describe('csrf protection', () => {
    it('should issue a csrf cookie on query requests', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/health.check',
      });

      expect(response.statusCode).toBe(200);
      expect(getCookieValue(response.headers['set-cookie'], 'puntovivo_csrf')).toBeTruthy();
    });

    it('should reject authenticated mutations without a matching csrf header', async () => {
      const { refreshCookie, csrfCookie } = await loginOverHttp();

      expect(refreshCookie).toBeTruthy();
      expect(csrfCookie).toBeTruthy();

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.refresh?batch=1',
        headers: {
          cookie: [`puntovivo_refresh=${refreshCookie}`, `puntovivo_csrf=${csrfCookie}`].join('; '),
          'content-type': 'application/json',
        },
        payload: '{}',
      });

      expect(response.statusCode).toBe(403);
      // follow-up — the 403 body is a tRPC-shaped error
      // envelope so the web client renders the real message instead
      // of 'Unable to transform response from server'.
      expect(response.json()).toEqual({
        error: {
          message: 'CSRF_VALIDATION_FAILED: missing or invalid CSRF token',
          code: -32003,
          data: { code: 'FORBIDDEN', httpStatus: 403 },
        },
      });
    });

    it('should allow authenticated mutations when the csrf header matches the cookie', async () => {
      const { refreshCookie, csrfCookie } = await loginOverHttp();

      expect(refreshCookie).toBeTruthy();
      expect(csrfCookie).toBeTruthy();

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.refresh?batch=1',
        headers: {
          cookie: [`puntovivo_refresh=${refreshCookie}`, `puntovivo_csrf=${csrfCookie}`].join('; '),
          'content-type': 'application/json',
          'x-csrf-token': csrfCookie as string,
        },
        payload: '{}',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should issue and clear refresh cookies with secure attributes on forwarded https requests', async () => {
      const loginResponse = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.login?batch=1',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-proto': 'https',
        },
        payload: JSON.stringify({
          '0': {
            email: 'trpctest@example.com',
            password: 'TestPassword123!',
          },
        }),
      });

      const setCookie = loginResponse.headers['set-cookie'];
      const cookieHeaders = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
      const refreshCookie = cookieHeaders.find(header => header.startsWith('puntovivo_refresh='));
      const csrfCookie = getCookieValue(setCookie, 'puntovivo_csrf');
      const accessToken = loginResponse.json()[0]?.result?.data?.token as string | undefined;

      expect(refreshCookie).toContain('Secure');
      expect(accessToken).toBeTruthy();
      expect(csrfCookie).toBeTruthy();

      const logoutResponse = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.logout?batch=1',
        headers: {
          authorization: `Bearer ${accessToken}`,
          cookie: `puntovivo_csrf=${csrfCookie}`,
          'content-type': 'application/json',
          'x-forwarded-proto': 'https',
        },
        payload: '{}',
      });

      const logoutSetCookie = logoutResponse.headers['set-cookie'];
      const logoutCookieHeaders = Array.isArray(logoutSetCookie)
        ? logoutSetCookie
        : [logoutSetCookie ?? ''];
      const clearedRefreshCookie = logoutCookieHeaders.find(header =>
        header.startsWith('puntovivo_refresh=')
      );

      expect(logoutResponse.statusCode).toBe(200);
      expect(clearedRefreshCookie).toContain('Max-Age=0');
      expect(clearedRefreshCookie).toContain('Secure');
    });
  });

  describe('auth.changePassword', () => {
    // auth.changePassword is wrapped with
    // criticalCommandProcedure (ADR-0002). Each createCaller test
    // pre-registers a device and mints a fresh envelope via
    // createCriticalCommandFixture. The HTTP-inject case at the end
    // mints envelope headers directly.
    async function changePasswordCallerCtx() {
      const fx = await createCriticalCommandFixture({
        db: getDatabase(),
        serverApp: server.app,
        tenantId: testTenantId,
        userId: testUserId,
        email: 'trpctest@example.com',
        role: 'admin',
        siteId: 'placeholder-site',
      });
      return fx;
    }

    it('should change password with correct current password', async () => {
      const fx = await changePasswordCallerCtx();
      const caller = appRouter.createCaller(fx.context);

      const result = await caller.auth.changePassword({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPassword456!',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Password changed successfully');

      // Verify new password was stored correctly
      const db = getDatabase();
      const updatedUser = await db.select().from(users).where(eq(users.id, testUserId)).get();
      expect(updatedUser).toBeDefined();
      const isNewPasswordValid = await verify(updatedUser!.passwordHash, 'NewPassword456!');
      expect(isNewPasswordValid).toBe(true);

      // Reset password for other tests
      const passwordHash = await hash('TestPassword123!');
      await db
        .update(users)
        .set({ passwordHash, sessionVersion: 1, updatedAt: new Date().toISOString() })
        .where(eq(users.id, testUserId));
    });

    it('should reject incorrect current password', async () => {
      const fx = await changePasswordCallerCtx();
      const caller = appRouter.createCaller(fx.context);

      try {
        await caller.auth.changePassword({
          currentPassword: 'WrongPassword99!',
          newPassword: 'AnotherStrong123!',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('UNAUTHORIZED');
      }
    });

    it('should reject weak password', async () => {
      const fx = await changePasswordCallerCtx();
      const caller = appRouter.createCaller(fx.context);

      try {
        await caller.auth.changePassword({
          currentPassword: 'TestPassword123!',
          newPassword: 'weakpassword1',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('BAD_REQUEST');
        expect((err as TRPCError).message).toContain('uppercase letter');
      }
    });

    it('should reject unauthenticated request', async () => {
      // Unauthenticated → fails at protectedProcedure step BEFORE the
      // envelope middleware runs. No need to seed envelope headers.
      const caller = appRouter.createCaller(createTestContext());

      await expect(
        caller.auth.changePassword({
          currentPassword: 'TestPassword123!',
          newPassword: 'NewPassword456!',
        })
      ).rejects.toThrow(TRPCError);
    });

    it('invalidates previously issued access and refresh tokens after a password change', async () => {
      const { accessToken, refreshCookie, csrfCookie } = await loginOverHttp();

      expect(accessToken).toBeTruthy();
      expect(refreshCookie).toBeTruthy();
      expect(csrfCookie).toBeTruthy();

      // register device + mint envelope inline for the
      // HTTP-injected request. This mirrors what the renderer does
      // post-login.
      const dbForDevice = getDatabase();
      const { deviceId } = await registerDeviceService(dbForDevice, {
        tenantId: testTenantId,
        userId: testUserId,
        kind: 'web',
        name: 'http-inject-test',
      });
      const envelope = JSON.stringify({
        operationId: randomUUID(),
        idempotencyKey: randomUUID(),
        clientCreatedAt: new Date().toISOString(),
      });

      const changeResponse = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.changePassword?batch=1',
        headers: {
          authorization: `Bearer ${accessToken}`,
          cookie: [`puntovivo_refresh=${refreshCookie}`, `puntovivo_csrf=${csrfCookie}`].join('; '),
          'content-type': 'application/json',
          'x-csrf-token': csrfCookie as string,
          [DEVICE_ID_HEADER]: deviceId,
          [COMMAND_ENVELOPE_HEADER]: envelope,
        },
        payload: JSON.stringify({
          '0': {
            currentPassword: 'TestPassword123!',
            newPassword: 'ChangedPassword456!',
          },
        }),
      });

      expect(changeResponse.statusCode).toBe(200);

      const meResponse = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/auth.me?batch=1',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(meResponse.statusCode).toBe(401);

      const refreshResponse = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.refresh?batch=1',
        headers: {
          cookie: [`puntovivo_refresh=${refreshCookie}`, `puntovivo_csrf=${csrfCookie}`].join('; '),
          'content-type': 'application/json',
          'x-csrf-token': csrfCookie as string,
        },
        payload: '{}',
      });

      expect(refreshResponse.statusCode).toBe(401);

      const db = getDatabase();
      const originalPasswordHash = await hash('TestPassword123!');
      await db
        .update(users)
        .set({
          passwordHash: originalPasswordHash,
          sessionVersion: 1,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, testUserId));
    });
  });

  /**
   * acceptance — `auth.login` enforces both a per-IP cap
   * (LOGIN_RATE_LIMIT_IP_MAX attempts per 60s) and a per-username cap
   * (LOGIN_RATE_LIMIT_USERNAME_MAX failures per 15 minutes).
   *
   * These tests drive the procedure directly through the tRPC caller
   * rather than via HTTP inject because (a) they measure bucket
   * semantics and (b) createCaller already uses the mocked
   * `createTestContext`, which pins `ctx.req.ip = '127.0.0.1'`. Both
   * buckets therefore key off the same identity and saturate
   * deterministically.
   */
  describe('auth.login rate limiting', () => {
    async function attemptLogin(email: string, password: string) {
      const caller = appRouter.createCaller(createTestContext());
      return caller.auth.login({ email, password });
    }

    async function expectCode(promise: Promise<unknown>, trpcCode: string, errorCode: string) {
      try {
        await promise;
        expect.unreachable(`Expected ${trpcCode} / ${errorCode}, nothing thrown`);
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        const trpcErr = err as TRPCError;
        expect(trpcErr.code).toBe(trpcCode);
        const cause = trpcErr.cause;
        expect(cause).toBeInstanceOf(ServerErrorWithCode);
        expect((cause as ServerErrorWithCode).errorCode).toBe(errorCode);
      }
    }

    it('documented acceptance: 50 bad-password attempts from one IP return TOO_MANY_REQUESTS inside 60s', async () => {
      const startMs = Date.now();

      // Attempts 1..USERNAME_MAX hit the existing invalid-credentials surface.
      for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
        await expectCode(
          attemptLogin('trpctest@example.com', 'wrongpassword'),
          'UNAUTHORIZED',
          'AUTH_INVALID_CREDENTIALS'
        );
      }

      // Attempts USERNAME_MAX+1 through 50 must bounce with TOO_MANY_REQUESTS
      // (the username bucket saturates first; the IP bucket is still below
      // its own cap but the outcome is the same 429 from the operator's
      // perspective, which is what the acceptance gate requires).
      const remaining = 50 - LOGIN_RATE_LIMIT_USERNAME_MAX;
      for (let i = 0; i < remaining; i += 1) {
        await expectCode(
          attemptLogin('trpctest@example.com', 'wrongpassword'),
          'TOO_MANY_REQUESTS',
          'AUTH_RATE_LIMIT_EXCEEDED'
        );
      }

      // Wall-clock must be well inside the IP window (60s). argon2 verifies
      // only run on the first USERNAME_MAX attempts; the rest short-circuit
      // at the bucket check so total runtime is dominated by the argon2
      // verifications, which finish in well under 30s.
      const elapsedMs = Date.now() - startMs;
      expect(elapsedMs).toBeLessThan(30_000);
    });

    it('IP cap trips after LOGIN_RATE_LIMIT_IP_MAX attempts against different usernames (credential stuffing)', async () => {
      // Rotating usernames would otherwise bypass the per-username bucket.
      // The IP bucket still saturates at IP_MAX attempts from the same source.
      expect(LOGIN_RATE_LIMIT_IP_MAX).toBeGreaterThan(LOGIN_RATE_LIMIT_USERNAME_MAX);

      for (let i = 0; i < LOGIN_RATE_LIMIT_IP_MAX; i += 1) {
        await expectCode(
          attemptLogin(`stuffing-${i}@test.com`, 'anything'),
          'UNAUTHORIZED',
          'AUTH_INVALID_CREDENTIALS'
        );
      }

      // Attempt IP_MAX+1 against yet another unused email still trips the
      // IP cap — the rejection does not depend on the target user existing.
      await expectCode(
        attemptLogin('stuffing-overflow@test.com', 'anything'),
        'TOO_MANY_REQUESTS',
        'AUTH_RATE_LIMIT_EXCEEDED'
      );
    });

    it('username cap trips at the 6th bad-password attempt against a single user', async () => {
      expect(LOGIN_RATE_LIMIT_USERNAME_MAX).toBeLessThan(LOGIN_RATE_LIMIT_IP_MAX);

      for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX; i += 1) {
        await expectCode(
          attemptLogin('trpctest@example.com', 'wrongpassword'),
          'UNAUTHORIZED',
          'AUTH_INVALID_CREDENTIALS'
        );
      }

      // IP bucket still has headroom (USERNAME_MAX < IP_MAX), so the
      // rejection here is owed to the username bucket specifically.
      await expectCode(
        attemptLogin('trpctest@example.com', 'wrongpassword'),
        'TOO_MANY_REQUESTS',
        'AUTH_RATE_LIMIT_EXCEEDED'
      );
    });

    it('successful login resets the username bucket; the IP bucket is untouched', async () => {
      for (let i = 0; i < LOGIN_RATE_LIMIT_USERNAME_MAX - 1; i += 1) {
        await expectCode(
          attemptLogin('trpctest@example.com', 'wrongpassword'),
          'UNAUTHORIZED',
          'AUTH_INVALID_CREDENTIALS'
        );
      }

      // A correct-credentials attempt must succeed and clear the username bucket.
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.auth.login({
        email: 'trpctest@example.com',
        password: 'TestPassword123!',
      });
      expect(result.token).toBeTypeOf('string');

      // A new wrong-password attempt right after must not be username-locked;
      // the invalid-credentials surface returns as before.
      await expectCode(
        attemptLogin('trpctest@example.com', 'wrongpassword'),
        'UNAUTHORIZED',
        'AUTH_INVALID_CREDENTIALS'
      );
    });

    // a failed login must now write rows to the `login_attempts`
    // table so the buckets survive a server restart. Assert on the DB
    // directly to pin that guarantee in the integration surface as well as
    // in the unit tests.
    it('persists rate-limit rows to login_attempts on a failed login', async () => {
      const db = getDatabase();

      await expectCode(
        attemptLogin('persist@example.com', 'wrongpassword'),
        'UNAUTHORIZED',
        'AUTH_INVALID_CREDENTIALS'
      );

      const ipRow = db
        .select()
        .from(loginAttempts)
        .where(and(eq(loginAttempts.kind, 'ip'), eq(loginAttempts.key, '127.0.0.1')))
        .get();
      expect(ipRow).toBeDefined();
      expect(ipRow!.count).toBe(1);
      expect(ipRow!.expiresAt).toBeGreaterThan(Date.now());

      const usernameRow = db
        .select()
        .from(loginAttempts)
        .where(
          and(eq(loginAttempts.kind, 'username'), eq(loginAttempts.key, 'persist@example.com'))
        )
        .get();
      expect(usernameRow).toBeDefined();
      expect(usernameRow!.count).toBe(1);
    });
  });

  // vector 2 — @fastify/rate-limit registered with
  // global:false; an onRoute hook in `index.ts` injects a 60/min/IP
  // bucket onto every `/api/trpc/*` wildcard route. The bucket is
  // intentionally a single tier because tRPC's Fastify adapter
  // registers ONE wildcard route (`/api/trpc/:path`); per-procedure
  // distinction would require a tRPC-layer middleware. Pin the
  // bucket via app.inject so a future edit that drops the hook
  // trips the suite.
  describe(' vector 2 — tRPC rate-limit hook', () => {
    it('rejects calls to /api/trpc/* after the per-IP bucket saturates (100/min)', async () => {
      // @fastify/rate-limit keys by request.ip + route. inject()
      // honors `remoteAddress` by setting the underlying socket's
      // remote address, which then drives request.ip. Use a unique
      // IP per test so the bucket is isolated from sibling tests.
      // Hammer the public `health.check` procedure — it's a tRPC
      // route (so it inherits the bucket) but does no work, so the
      // calls run in milliseconds.
      const remoteAddress = '198.51.100.10';
      let saw429 = false;
      let okCount = 0;
      for (let i = 0; i < 110; i += 1) {
        const response = await server.app.inject({
          method: 'GET',
          url: '/api/trpc/health.check',
          remoteAddress,
        });
        if (response.statusCode === 429) {
          saw429 = true;
          break;
        }
        if (response.statusCode === 200) okCount += 1;
      }
      // 100/min cap — the 101st call must fire 429.
      expect(saw429).toBe(true);
      expect(okCount).toBeGreaterThanOrEqual(80);
      expect(okCount).toBeLessThanOrEqual(100);
    });

    it('uses per-IP keying — a different remoteAddress gets a fresh bucket', async () => {
      // Saturate from one IP first, then verify a different IP can
      // still reach the procedure. Confirms the bucket is per-IP, not
      // global.
      const saturatingIp = '198.51.100.30';
      for (let i = 0; i < 105; i += 1) {
        await server.app.inject({
          method: 'GET',
          url: '/api/trpc/health.check',
          remoteAddress: saturatingIp,
        });
      }
      // A fresh IP should get a 200, proving the bucket is per-IP.
      const freshIp = '198.51.100.31';
      const freshResponse = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/health.check',
        remoteAddress: freshIp,
      });
      expect(freshResponse.statusCode).toBe(200);
    });
  });

  describe('auth.registerDevice ( hub_client kind)', () => {
    it('accepts kind=hub_client for cashier terminals pointing at a remote hub', async () => {
      const { accessToken } = await loginOverHttp();
      const csrfResponse = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/health.check',
      });
      const csrfCookie = getCookieValue(csrfResponse.headers['set-cookie'], 'puntovivo_csrf');

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.registerDevice?batch=1',
        headers: {
          authorization: `Bearer ${accessToken}`,
          cookie: `puntovivo_csrf=${csrfCookie}`,
          'content-type': 'application/json',
          'x-csrf-token': csrfCookie as string,
        },
        payload: JSON.stringify({
          '0': {
            kind: 'hub_client',
            name: 'caja-2-test',
          },
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<{
        result?: { data?: { deviceId?: string; registeredAt?: string } };
      }>;
      // Service returns `{deviceId, registeredAt}`; verify the row
      // was created with kind=hub_client by reading back via the DB.
      expect(typeof body[0]?.result?.data?.deviceId).toBe('string');
      const createdDeviceId = body[0]!.result!.data!.deviceId!;
      const dbRow = getDatabase()
        .select({ kind: devices.kind })
        .from(devices)
        .where(eq(devices.id, createdDeviceId))
        .get();
      expect(dbRow?.kind).toBe('hub_client');
    });

    it('rejects unknown kind values via zod', async () => {
      const { accessToken } = await loginOverHttp();
      const csrfResponse = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/health.check',
      });
      const csrfCookie = getCookieValue(csrfResponse.headers['set-cookie'], 'puntovivo_csrf');

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.registerDevice?batch=1',
        headers: {
          authorization: `Bearer ${accessToken}`,
          cookie: `puntovivo_csrf=${csrfCookie}`,
          'content-type': 'application/json',
          'x-csrf-token': csrfCookie as string,
        },
        payload: JSON.stringify({
          '0': {
            kind: 'cluster_node',
            name: 'invalid-test',
          },
        }),
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
