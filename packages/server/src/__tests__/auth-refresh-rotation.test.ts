/**
 * Refresh-token rotation + replay detection (Auditoría 2026-07).
 *
 * Covers the `security/refreshTokenFamilies` primitives against the
 * in-memory DB and the full HTTP behavior of `auth.refresh`: rotation
 * hands out a NEW cookie, replaying the OLD cookie is detected as theft
 * (family revoked + `sessionVersion` bumped so every outstanding token
 * dies), and legacy pre-rotation tokens get a one-time upgrade path.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users, tenants, authRefreshFamilies } from '../db/schema.js';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import {
  REFRESH_ROTATION_GRACE_MS,
  REFRESH_FAMILY_TTL_MS,
  createRefreshFamily,
  isLiveRefreshFamily,
  pruneExpiredRefreshFamilies,
  revokeRefreshFamiliesForUser,
  rotateRefreshFamily,
} from '../security/refreshTokenFamilies.js';
import { __resetForTests as resetLoginRateLimit } from '../security/loginRateLimit.js';
import { __withExpectedTestLogs } from '../logging/logger.js';
import { hashStaffPin } from '../security/staffPins.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { DEVICE_ID_HEADER } from '../trpc/schemas/envelope.js';

const REFRESH_REPLAY_WARNING = {
  level: 'warn',
  module: 'security/refresh-families',
  message: 'refresh token replay detected — family revoked, sessionVersion bumped',
} as const;

const INVALID_REFRESH_LOGS = [
  {
    level: 'error',
    module: 'observability',
    message: 'captured exception',
  },
  {
    level: 'error',
    module: 'trpc',
    message: 'tRPC procedure error',
  },
] as const;

let server: PuntovivoServer;
let testTenantId: string;
let testUserId: string;

const TEST_EMAIL = 'rotation@example.com';
const TEST_PASSWORD = 'TestPassword123!';

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

function wasCookieCleared(setCookieHeader: string | string[] | undefined, name: string): boolean {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  return headers.some(header => header.startsWith(`${name}=;`) && header.includes('Max-Age=0'));
}

async function loginOverHttp() {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/trpc/auth.login?batch=1',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      '0': { email: TEST_EMAIL, password: TEST_PASSWORD },
    }),
  });
  return {
    response,
    accessToken: response.json()[0]?.result?.data?.token as string | undefined,
    refreshCookie: getCookieValue(response.headers['set-cookie'], 'puntovivo_refresh'),
    csrfCookie: getCookieValue(response.headers['set-cookie'], 'puntovivo_csrf'),
  };
}

async function refreshOverHttp(refreshCookie: string, csrfCookie: string) {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/trpc/auth.refresh?batch=1',
    headers: {
      cookie: [`puntovivo_refresh=${refreshCookie}`, `puntovivo_csrf=${csrfCookie}`].join('; '),
      'content-type': 'application/json',
      'x-csrf-token': csrfCookie,
    },
    payload: '{}',
  });
  return {
    response,
    token: response.json()[0]?.result?.data?.token as string | undefined,
    nextRefreshCookie: getCookieValue(response.headers['set-cookie'], 'puntovivo_refresh'),
    nextCsrfCookie: getCookieValue(response.headers['set-cookie'], 'puntovivo_csrf'),
  };
}

describe('refresh-token rotation', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();

    testTenantId = nanoid();
    await db.insert(tenants).values({
      id: testTenantId,
      name: 'Rotation Tenant',
      slug: 'rotation-tenant',
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    testUserId = nanoid();
    await db.insert(users).values({
      id: testUserId,
      tenantId: testTenantId,
      email: TEST_EMAIL,
      passwordHash: await hash(TEST_PASSWORD),
      name: 'Rotation Test User',
      role: 'admin',
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

  beforeEach(() => {
    resetLoginRateLimit(getDatabase());
  });

  describe('authenticated CSRF boundary (red-first)', () => {
    it('emits exactly one final session companion after a cookie-less login', async () => {
      const login = await loginOverHttp();
      expect(login.response.statusCode).toBe(200);
      expect(login.refreshCookie).toBeTruthy();
      expect(login.csrfCookie).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);

      const setCookie = login.response.headers['set-cookie'];
      const cookieHeaders = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      expect(cookieHeaders.filter(header => header.startsWith('puntovivo_csrf='))).toHaveLength(1);

      const refresh = await refreshOverHttp(login.refreshCookie!, login.csrfCookie!);
      expect(refresh.response.statusCode).toBe(200);
    });

    it('replaces a pre-login CSRF cookie when a new refresh family is created', async () => {
      const preLoginToken = 'a'.repeat(43);
      const login = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.login?batch=1',
        headers: {
          cookie: `puntovivo_csrf=${preLoginToken}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({
          '0': { email: TEST_EMAIL, password: TEST_PASSWORD },
        }),
      });

      expect(login.statusCode).toBe(200);
      expect(getCookieValue(login.headers['set-cookie'], 'puntovivo_refresh')).toBeTruthy();
      const postLoginToken = getCookieValue(login.headers['set-cookie'], 'puntovivo_csrf');
      expect(postLoginToken).toBeTruthy();
      // Assert only the relation; never print a session token in test failures.
      expect(postLoginToken === preLoginToken).toBe(false);
    });

    it('replaces the CSRF companion when an already signed-in browser logs in again', async () => {
      const first = await loginOverHttp();
      expect(first.response.statusCode).toBe(200);
      expect(first.refreshCookie).toBeTruthy();
      expect(first.csrfCookie).toBeTruthy();

      const second = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.login?batch=1',
        headers: {
          cookie: [
            `puntovivo_refresh=${first.refreshCookie}`,
            `puntovivo_csrf=${first.csrfCookie}`,
          ].join('; '),
          'content-type': 'application/json',
          'x-csrf-token': first.csrfCookie!,
        },
        payload: JSON.stringify({
          '0': { email: TEST_EMAIL, password: TEST_PASSWORD },
        }),
      });

      expect(second.statusCode).toBe(200);
      const nextRefresh = getCookieValue(second.headers['set-cookie'], 'puntovivo_refresh');
      const nextCsrf = getCookieValue(second.headers['set-cookie'], 'puntovivo_csrf');
      expect(nextRefresh).toBeTruthy();
      expect(nextCsrf).toBeTruthy();
      expect(nextRefresh === first.refreshCookie).toBe(false);
      expect(nextCsrf === first.csrfCookie).toBe(false);
    });

    it('replaces the CSRF companion when a shared terminal switches cashier', async () => {
      const db = getDatabase();
      const cashierId = nanoid();
      const now = new Date().toISOString();
      await db.insert(users).values({
        id: cashierId,
        tenantId: testTenantId,
        email: `csrf-switch-${cashierId}@example.com`,
        passwordHash: await hash(TEST_PASSWORD),
        staffPinHash: await hashStaffPin('246810'),
        name: 'CSRF Switch Cashier',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const { deviceId } = await registerDeviceService(db, {
        tenantId: testTenantId,
        userId: testUserId,
        kind: 'web',
        name: 'csrf-session-switch',
      });
      const login = await loginOverHttp();
      expect(login.response.statusCode).toBe(200);
      expect(login.accessToken).toBeTruthy();
      expect(login.refreshCookie).toBeTruthy();
      expect(login.csrfCookie).toBeTruthy();

      const handoff = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.switchStaff?batch=1',
        headers: {
          authorization: `Bearer ${login.accessToken}`,
          cookie: `puntovivo_refresh=${login.refreshCookie}; puntovivo_csrf=${login.csrfCookie}`,
          'content-type': 'application/json',
          'x-csrf-token': login.csrfCookie!,
          [DEVICE_ID_HEADER]: deviceId,
        },
        payload: JSON.stringify({ '0': { targetUserId: cashierId, pin: '246810' } }),
      });
      expect(handoff.statusCode).toBe(200);
      const nextRefresh = getCookieValue(handoff.headers['set-cookie'], 'puntovivo_refresh');
      const nextCsrf = getCookieValue(handoff.headers['set-cookie'], 'puntovivo_csrf');
      expect(nextRefresh).toBeTruthy();
      expect(nextCsrf).toBeTruthy();
      // Compare booleans so failing output never prints either token.
      expect(nextCsrf === login.csrfCookie).toBe(false);
    });

    it('rejects a CSRF token from another live refresh family even when cookie and header match', async () => {
      const first = await loginOverHttp();
      const second = await loginOverHttp();
      expect(first.response.statusCode).toBe(200);
      expect(second.response.statusCode).toBe(200);
      expect(first.csrfCookie).toBeTruthy();
      expect(second.refreshCookie).toBeTruthy();

      const attempt = await refreshOverHttp(second.refreshCookie!, first.csrfCookie!);
      expect(attempt.response.statusCode).toBe(403);
      expect(attempt.response.json().error.message).toContain('CSRF_VALIDATION_FAILED');
    });

    it('does not accept an arbitrary matching cookie and header for a live refresh session', async () => {
      const login = await loginOverHttp();
      expect(login.response.statusCode).toBe(200);
      expect(login.refreshCookie).toBeTruthy();

      const forgedToken = 'z'.repeat(43);
      const attempt = await refreshOverHttp(login.refreshCookie!, forgedToken);
      expect(attempt.response.statusCode).toBe(403);
      expect(attempt.response.json().error.message).toContain('CSRF_VALIDATION_FAILED');
    });

    it('does not authorize a mutation with a legacy no-family refresh cookie and an arbitrary matching pair', async () => {
      const login = await loginOverHttp();
      const user = getDatabase().select().from(users).where(eq(users.id, testUserId)).get();
      expect(login.accessToken).toBeTruthy();
      expect(user).toBeDefined();
      const legacyRefresh = server.app.jwt.sign(
        {
          userId: user!.id,
          tenantId: user!.tenantId,
          email: user!.email,
          role: user!.role,
          sessionVersion: user!.sessionVersion,
          tokenType: 'refresh',
        },
        { expiresIn: '7d' }
      );
      const forged = 'z'.repeat(43);
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.registerDevice?batch=1',
        headers: {
          authorization: `Bearer ${login.accessToken}`,
          cookie: `puntovivo_refresh=${legacyRefresh}; puntovivo_csrf=${forged}`,
          'content-type': 'application/json',
          'x-csrf-token': forged,
        },
        payload: JSON.stringify({ '0': { kind: 'web', name: 'legacy-csrf-probe' } }),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toContain('CSRF_VALIDATION_FAILED');
    });

    it('does not authorize a mutation with an invalid refresh cookie and an arbitrary matching pair', async () => {
      const login = await loginOverHttp();
      expect(login.accessToken).toBeTruthy();
      const forged = 'z'.repeat(43);
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.registerDevice?batch=1',
        headers: {
          authorization: `Bearer ${login.accessToken}`,
          cookie: `puntovivo_refresh=invalid-refresh; puntovivo_csrf=${forged}`,
          'content-type': 'application/json',
          'x-csrf-token': forged,
        },
        payload: JSON.stringify({ '0': { kind: 'web', name: 'invalid-csrf-probe' } }),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toContain('CSRF_VALIDATION_FAILED');
    });

    it.each(['revoked', 'expired'] as const)(
      'rejects an unsafe bearer mutation with a signed companion from a %s refresh family',
      async familyState => {
        const login = await loginOverHttp();
        expect(login.response.statusCode).toBe(200);
        expect(login.accessToken).toBeTruthy();
        expect(login.refreshCookie).toBeTruthy();
        expect(login.csrfCookie).toBeTruthy();

        const payload = server.app.jwt.decode(login.refreshCookie!) as { familyId?: string } | null;
        expect(payload?.familyId).toBeTruthy();
        if (familyState === 'revoked') {
          getDatabase()
            .delete(authRefreshFamilies)
            .where(eq(authRefreshFamilies.id, payload!.familyId!))
            .run();
        } else {
          getDatabase()
            .update(authRefreshFamilies)
            .set({ expiresAt: new Date(Date.now() - 1).toISOString() })
            .where(eq(authRefreshFamilies.id, payload!.familyId!))
            .run();
        }

        const response = await server.app.inject({
          method: 'POST',
          url: '/api/trpc/auth.registerDevice?batch=1',
          headers: {
            authorization: `Bearer ${login.accessToken}`,
            cookie: `puntovivo_refresh=${login.refreshCookie}; puntovivo_csrf=${login.csrfCookie}`,
            'content-type': 'application/json',
            'x-csrf-token': login.csrfCookie!,
          },
          payload: JSON.stringify({ '0': { kind: 'web', name: `dead-family-${familyState}` } }),
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.message).toContain('CSRF_VALIDATION_FAILED');
      }
    );

    it('mints one convergent CSRF token for concurrent safe reads in the same session', async () => {
      const login = await loginOverHttp();
      expect(login.response.statusCode).toBe(200);
      expect(login.refreshCookie).toBeTruthy();

      const headers = {
        cookie: `puntovivo_refresh=${login.refreshCookie}; puntovivo_csrf=invalid`,
      };
      const [health, setup] = await Promise.all([
        server.app.inject({ method: 'GET', url: '/api/trpc/health.check?batch=1', headers }),
        server.app.inject({ method: 'GET', url: '/api/trpc/auth.setupStatus?batch=1', headers }),
      ]);
      expect(health.statusCode).toBe(200);
      expect(setup.statusCode).toBe(200);

      const healthToken = getCookieValue(health.headers['set-cookie'], 'puntovivo_csrf');
      const setupToken = getCookieValue(setup.headers['set-cookie'], 'puntovivo_csrf');
      expect(healthToken).toBeTruthy();
      expect(setupToken).toBeTruthy();
      // Compare booleans so a failing test never prints session tokens.
      expect(setupToken === healthToken).toBe(true);
    });

    it('accepts a browser-like telemetry refresh batch when cookie and header use one minted token', async () => {
      // This is a transport control, not evidence that legacy equality is a
      // sufficient authenticated CSRF policy. The separate red-first cases
      // require session binding and convergent safe-read minting.
      const login = await loginOverHttp();
      expect(login.response.statusCode).toBe(200);
      expect(login.refreshCookie).toBeTruthy();

      const staleHeaders = {
        cookie: `puntovivo_refresh=${login.refreshCookie}; puntovivo_csrf=invalid`,
      };
      const [health, setup] = await Promise.all([
        server.app.inject({
          method: 'GET',
          url: '/api/trpc/health.check?batch=1',
          headers: staleHeaders,
        }),
        server.app.inject({
          method: 'GET',
          url: '/api/trpc/auth.setupStatus?batch=1',
          headers: staleHeaders,
        }),
      ]);
      expect(health.statusCode).toBe(200);
      expect(setup.statusCode).toBe(200);
      const firstToken = getCookieValue(health.headers['set-cookie'], 'puntovivo_csrf');
      expect(firstToken).toBeTruthy();

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/observability.reportWebVital,observability.reportWebVital,auth.refresh?batch=1',
        headers: {
          cookie: `puntovivo_refresh=${login.refreshCookie}; puntovivo_csrf=${firstToken}`,
          'content-type': 'application/json',
          'x-csrf-token': firstToken!,
        },
        payload: JSON.stringify({
          '0': { metric: 'FCP', value: 120, rating: 'good', route: '/login', deviceClass: 'mid' },
          '1': { metric: 'LCP', value: 230, rating: 'good', route: '/login', deviceClass: 'mid' },
          '2': {},
        }),
      });
      expect(response.statusCode).toBe(200);
      const results = response.json() as unknown;
      expect(Array.isArray(results)).toBe(true);
      if (!Array.isArray(results)) return;
      expect(results.length).toBe(3);
      expect(results[0]?.result?.data).toEqual({ accepted: true });
      expect(results[1]?.result?.data).toEqual({ accepted: true });
      // Assert only the token type so a failed control never prints it.
      expect(typeof results[2]?.result?.data?.token).toBe('string');
    });
  });

  describe('family primitives', () => {
    it('accepts only the live family for the expected tenant and user', () => {
      const db = getDatabase();
      const issuedAt = Date.now();
      const grant = createRefreshFamily(db, {
        tenantId: testTenantId,
        userId: testUserId,
        now: () => issuedAt,
      });
      const identity = {
        familyId: grant.familyId,
        tenantId: testTenantId,
        userId: testUserId,
      };

      expect(isLiveRefreshFamily(db, { ...identity, now: () => issuedAt })).toBe(true);
      expect(
        isLiveRefreshFamily(db, { ...identity, tenantId: 'another-tenant', now: () => issuedAt })
      ).toBe(false);
      expect(
        isLiveRefreshFamily(db, { ...identity, userId: 'another-user', now: () => issuedAt })
      ).toBe(false);
      expect(
        isLiveRefreshFamily(db, {
          ...identity,
          now: () => issuedAt + REFRESH_FAMILY_TTL_MS,
        })
      ).toBe(false);

      revokeRefreshFamiliesForUser(db, testUserId);
      expect(isLiveRefreshFamily(db, { ...identity, now: () => issuedAt })).toBe(false);
    });

    it('createRefreshFamily persists a live row whose currentJti matches the grant', () => {
      const db = getDatabase();
      const grant = createRefreshFamily(db, { tenantId: testTenantId, userId: testUserId });
      const row = db
        .select()
        .from(authRefreshFamilies)
        .where(eq(authRefreshFamilies.id, grant.familyId))
        .get();
      expect(row?.currentJti).toBe(grant.jti);
      expect(row?.userId).toBe(testUserId);
      revokeRefreshFamiliesForUser(db, testUserId);
    });

    it('rotateRefreshFamily rotates on the current jti and reports missing after revoke', () => {
      const db = getDatabase();
      const grant = createRefreshFamily(db, { tenantId: testTenantId, userId: testUserId });

      const first = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: grant.jti,
        userId: testUserId,
      });
      expect(first.status).toBe('rotated');

      revokeRefreshFamiliesForUser(db, testUserId);
      const afterRevoke = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: grant.jti,
        userId: testUserId,
      });
      expect(afterRevoke.status).toBe('missing');
    });

    it('does not rotate or reissue an expired refresh family at its exact expiry', () => {
      const db = getDatabase();
      const issuedAt = 4_000_000;
      const grant = createRefreshFamily(db, {
        tenantId: testTenantId,
        userId: testUserId,
        now: () => issuedAt,
      });
      const expired = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: grant.jti,
        userId: testUserId,
        now: () => issuedAt + REFRESH_FAMILY_TTL_MS,
      });
      expect(expired.status).toBe('missing');
      const row = db
        .select({ currentJti: authRefreshFamilies.currentJti })
        .from(authRefreshFamilies)
        .where(eq(authRefreshFamilies.id, grant.familyId))
        .get();
      expect(row?.currentJti).toBe(grant.jti);
      revokeRefreshFamiliesForUser(db, testUserId);
    });

    it('replaying a rotated jti OUTSIDE the grace window revokes the family and bumps sessionVersion', async () => {
      const db = getDatabase();
      const before = db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, testUserId))
        .get();
      const grant = createRefreshFamily(db, { tenantId: testTenantId, userId: testUserId });

      const rotatedAt = 1_000_000;
      const rotated = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: grant.jti,
        userId: testUserId,
        now: () => rotatedAt,
      });
      expect(rotated.status).toBe('rotated');

      // Replay the ORIGINAL jti well after the grace window closed ⇒ theft.
      const replay = await __withExpectedTestLogs([REFRESH_REPLAY_WARNING], () =>
        rotateRefreshFamily(db, {
          familyId: grant.familyId,
          presentedJti: grant.jti,
          userId: testUserId,
          now: () => rotatedAt + REFRESH_ROTATION_GRACE_MS + 5_000,
        })
      );
      expect(replay.status).toBe('reused');

      const family = db
        .select()
        .from(authRefreshFamilies)
        .where(eq(authRefreshFamilies.id, grant.familyId))
        .get();
      expect(family).toBeUndefined();

      const after = db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, testUserId))
        .get();
      expect(after!.sessionVersion).toBe(before!.sessionVersion + 1);
    });

    it('replaying the immediately-previous jti WITHIN the grace window re-issues without revoking (concurrent-refresh race)', () => {
      const db = getDatabase();
      const before = db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, testUserId))
        .get();
      const grant = createRefreshFamily(db, { tenantId: testTenantId, userId: testUserId });

      const rotatedAt = 2_000_000;
      const rotated = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: grant.jti,
        userId: testUserId,
        now: () => rotatedAt,
      });
      expect(rotated.status).toBe('rotated');
      const currentJti = rotated.status === 'rotated' ? rotated.jti : '';

      // Second tab replays the pre-rotation jti a few seconds later.
      const raced = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: grant.jti,
        userId: testUserId,
        now: () => rotatedAt + 3_000,
      });
      expect(raced.status).toBe('reissued');
      // Converges on the family's CURRENT jti rather than minting a rival.
      expect(raced.status === 'reissued' && raced.jti).toBe(currentJti);

      // Family still alive, session NOT killed.
      const family = db
        .select()
        .from(authRefreshFamilies)
        .where(eq(authRefreshFamilies.id, grant.familyId))
        .get();
      expect(family).toBeDefined();
      const after = db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, testUserId))
        .get();
      expect(after!.sessionVersion).toBe(before!.sessionVersion);
      revokeRefreshFamiliesForUser(db, testUserId);
    });

    it('replaying a jti older than the immediate predecessor still revokes even within the window', async () => {
      const db = getDatabase();
      const grant = createRefreshFamily(db, { tenantId: testTenantId, userId: testUserId });
      const at = 3_000_000;

      const first = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: grant.jti,
        userId: testUserId,
        now: () => at,
      });
      expect(first.status).toBe('rotated');
      const secondJti = first.status === 'rotated' ? first.jti : '';

      // Legitimate second rotation moves previousJti forward to secondJti.
      const second = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: secondJti,
        userId: testUserId,
        now: () => at + 1_000,
      });
      expect(second.status).toBe('rotated');

      // The ORIGINAL jti is now two hops back — no longer the immediate
      // predecessor — so even inside the window it reads as theft.
      const replayOld = await __withExpectedTestLogs([REFRESH_REPLAY_WARNING], () =>
        rotateRefreshFamily(db, {
          familyId: grant.familyId,
          presentedJti: grant.jti,
          userId: testUserId,
          now: () => at + 2_000,
        })
      );
      expect(replayOld.status).toBe('reused');
      revokeRefreshFamiliesForUser(db, testUserId);
    });

    it('pruneExpiredRefreshFamilies removes only expired rows', () => {
      const db = getDatabase();
      const live = createRefreshFamily(db, { tenantId: testTenantId, userId: testUserId });
      const expired = createRefreshFamily(db, {
        tenantId: testTenantId,
        userId: testUserId,
        now: () => Date.now() - 8 * 24 * 60 * 60 * 1000,
      });

      const deleted = pruneExpiredRefreshFamilies(db);
      expect(deleted).toBeGreaterThanOrEqual(1);

      const liveRow = db
        .select()
        .from(authRefreshFamilies)
        .where(eq(authRefreshFamilies.id, live.familyId))
        .get();
      const expiredRow = db
        .select()
        .from(authRefreshFamilies)
        .where(eq(authRefreshFamilies.id, expired.familyId))
        .get();
      expect(liveRow).toBeDefined();
      expect(expiredRow).toBeUndefined();
      revokeRefreshFamiliesForUser(db, testUserId);
    });
  });

  describe('auth.refresh over HTTP', () => {
    it('rotates the refresh cookie: the new cookie works, and is different from the old one', async () => {
      const { refreshCookie, csrfCookie } = await loginOverHttp();
      expect(refreshCookie).toBeTruthy();

      const first = await refreshOverHttp(refreshCookie!, csrfCookie!);
      expect(first.response.statusCode).toBe(200);
      expect(first.token).toBeTypeOf('string');
      expect(first.nextRefreshCookie).toBeTruthy();
      expect(first.nextRefreshCookie).not.toBe(refreshCookie);

      const second = await refreshOverHttp(first.nextRefreshCookie!, csrfCookie!);
      expect(second.response.statusCode).toBe(200);
    });

    it('tolerates a concurrent replay of the immediately-previous cookie (two-tab race, no session kill)', async () => {
      const { refreshCookie, csrfCookie } = await loginOverHttp();

      // Tab A refreshes (rotates the shared cookie).
      const first = await refreshOverHttp(refreshCookie!, csrfCookie!);
      expect(first.response.statusCode).toBe(200);

      // Tab B, milliseconds behind, POSTs with the pre-rotation cookie it
      // still held. Within the grace window this is benign: 200, and it
      // gets a working cookie back.
      const raced = await refreshOverHttp(refreshCookie!, csrfCookie!);
      expect(raced.response.statusCode).toBe(200);
      expect(raced.nextRefreshCookie).toBeTruthy();

      // Both tabs' latest cookies keep working — the session survived.
      const contA = await refreshOverHttp(first.nextRefreshCookie!, csrfCookie!);
      expect(contA.response.statusCode).toBe(200);
    });

    it('detects genuine replay (older-than-previous cookie) and kills the whole session family', async () => {
      const { refreshCookie, csrfCookie } = await loginOverHttp();

      // Two legitimate rotations: the ORIGINAL cookie is now two hops back,
      // so replaying it is theft even inside the grace window (it is no
      // longer the immediate predecessor).
      const first = await refreshOverHttp(refreshCookie!, csrfCookie!);
      expect(first.response.statusCode).toBe(200);
      const second = await refreshOverHttp(first.nextRefreshCookie!, csrfCookie!);
      expect(second.response.statusCode).toBe(200);

      // Attacker replays the stolen ORIGINAL cookie.
      const replay = await __withExpectedTestLogs(
        [REFRESH_REPLAY_WARNING, ...INVALID_REFRESH_LOGS],
        () => refreshOverHttp(refreshCookie!, csrfCookie!)
      );
      expect(replay.response.statusCode).toBe(401);
      expect(wasCookieCleared(replay.response.headers['set-cookie'], 'puntovivo_csrf')).toBe(true);

      // The legitimate holder's current cookie is dead too — family revoked
      // and sessionVersion bumped.
      const legitimate = await __withExpectedTestLogs([...INVALID_REFRESH_LOGS], () =>
        refreshOverHttp(second.nextRefreshCookie!, csrfCookie!)
      );
      expect(legitimate.response.statusCode).toBe(401);

      // And the pre-replay access token no longer authenticates.
      const me = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/auth.me?batch=1',
        headers: { authorization: `Bearer ${second.token}` },
      });
      expect(me.statusCode).toBe(401);
    });

    it.each([
      { familyId: '', jti: '' },
      { familyId: null, jti: null },
      { familyId: 'partial-family' },
      { jti: 'partial-jti' },
    ])('does not treat malformed family claims as legacy: %j', async familyClaims => {
      const user = getDatabase().select().from(users).where(eq(users.id, testUserId)).get();
      expect(user).toBeDefined();
      const malformed = server.app.jwt.sign(
        {
          userId: user!.id,
          tenantId: user!.tenantId,
          email: user!.email,
          role: user!.role,
          sessionVersion: user!.sessionVersion,
          tokenType: 'refresh',
          ...familyClaims,
        },
        { expiresIn: '7d' }
      );
      const probe = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/health.check',
        headers: { cookie: `puntovivo_refresh=${malformed}` },
      });
      const csrf = getCookieValue(probe.headers['set-cookie'], 'puntovivo_csrf');
      const attempt = await refreshOverHttp(malformed, csrf ?? 'x'.repeat(43));
      expect(attempt.response.statusCode).toBe(403);
      expect(attempt.nextRefreshCookie).toBeNull();
    });

    it('upgrades a legacy refresh token (no jti) into a rotated family once', async () => {
      const db = getDatabase();
      const user = db.select().from(users).where(eq(users.id, testUserId)).get();
      expect(user).toBeDefined();

      // Sign a pre-rotation-era refresh token: same payload shape, no
      // familyId/jti — exactly what a cookie minted before this deploy
      // carries.
      const legacyToken = server.app.jwt.sign(
        {
          userId: user!.id,
          tenantId: user!.tenantId,
          email: user!.email,
          role: user!.role,
          sessionVersion: user!.sessionVersion,
          tokenType: 'refresh',
        },
        { expiresIn: '7d' }
      );

      // Even a cryptographically valid legacy JWT cannot use an attacker-
      // chosen equality-only pair to upgrade into a new authenticated family.
      const forged = 'x'.repeat(43);
      const rejected = await refreshOverHttp(legacyToken, forged);
      expect(rejected.response.statusCode).toBe(403);
      expect(rejected.nextRefreshCookie).toBeNull();

      const csrfProbe = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/health.check',
        headers: { cookie: `puntovivo_refresh=${legacyToken}` },
      });
      const csrfCookie = getCookieValue(csrfProbe.headers['set-cookie'], 'puntovivo_csrf');
      expect(/^v1\.[A-Za-z0-9_-]{43}$/.test(csrfCookie ?? '')).toBe(true);
      // The migration-only proof cannot authorize a mixed batch.
      const batch = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.refresh,observability.reportWebVital?batch=1',
        headers: {
          cookie: `puntovivo_refresh=${legacyToken}; puntovivo_csrf=${csrfCookie}`,
          'x-csrf-token': csrfCookie!,
          'content-type': 'application/json',
        },
        payload: '{}',
      });
      expect(batch.statusCode).toBe(403);

      const upgraded = await refreshOverHttp(legacyToken, csrfCookie!);
      expect(upgraded.response.statusCode).toBe(200);
      expect(upgraded.nextRefreshCookie).toBeTruthy();
      expect(upgraded.nextCsrfCookie).toBeTruthy();
      expect(upgraded.nextCsrfCookie === csrfCookie).toBe(false);

      // The upgraded cookie is family-tracked: it keeps refreshing fine.
      const next = await refreshOverHttp(upgraded.nextRefreshCookie!, upgraded.nextCsrfCookie!);
      expect(next.response.statusCode).toBe(200);
    });

    it('rejects an expired refresh family over HTTP instead of extending it', async () => {
      const login = await loginOverHttp();
      expect(login.response.statusCode).toBe(200);
      expect(login.refreshCookie).toBeTruthy();
      expect(login.csrfCookie).toBeTruthy();
      const payload = server.app.jwt.decode(login.refreshCookie!) as { familyId?: string } | null;
      expect(payload?.familyId).toBeTruthy();
      getDatabase()
        .update(authRefreshFamilies)
        .set({ expiresAt: new Date(Date.now() - 1).toISOString() })
        .where(eq(authRefreshFamilies.id, payload!.familyId!))
        .run();

      const attempt = await __withExpectedTestLogs([...INVALID_REFRESH_LOGS], () =>
        refreshOverHttp(login.refreshCookie!, login.csrfCookie!)
      );
      expect(attempt.response.statusCode).toBe(401);
      expect(attempt.nextRefreshCookie).toBeNull();
      expect(wasCookieCleared(attempt.response.headers['set-cookie'], 'puntovivo_csrf')).toBe(true);
    });

    it('logout drops every family row for the user', async () => {
      const db = getDatabase();
      const { accessToken, csrfCookie } = await loginOverHttp();
      expect(accessToken).toBeTruthy();

      const rowsBefore = db
        .select()
        .from(authRefreshFamilies)
        .where(eq(authRefreshFamilies.userId, testUserId))
        .all();
      expect(rowsBefore.length).toBeGreaterThan(0);

      const logout = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.logout?batch=1',
        headers: {
          authorization: `Bearer ${accessToken}`,
          cookie: `puntovivo_csrf=${csrfCookie}`,
          'content-type': 'application/json',
          'x-csrf-token': csrfCookie as string,
        },
        payload: '{}',
      });
      expect(logout.statusCode).toBe(200);
      expect(wasCookieCleared(logout.headers['set-cookie'], 'puntovivo_csrf')).toBe(true);

      const rowsAfter = db
        .select()
        .from(authRefreshFamilies)
        .where(eq(authRefreshFamilies.userId, testUserId))
        .all();
      expect(rowsAfter.length).toBe(0);
    });
  });
});
