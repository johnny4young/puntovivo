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
  createRefreshFamily,
  pruneExpiredRefreshFamilies,
  revokeRefreshFamiliesForUser,
  rotateRefreshFamily,
} from '../security/refreshTokenFamilies.js';
import { __resetForTests as resetLoginRateLimit } from '../security/loginRateLimit.js';

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

  describe('family primitives', () => {
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

    it('replaying a rotated jti OUTSIDE the grace window revokes the family and bumps sessionVersion', () => {
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
      const replay = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: grant.jti,
        userId: testUserId,
        now: () => rotatedAt + REFRESH_ROTATION_GRACE_MS + 5_000,
      });
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

    it('replaying a jti older than the immediate predecessor still revokes even within the window', () => {
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
      const replayOld = rotateRefreshFamily(db, {
        familyId: grant.familyId,
        presentedJti: grant.jti,
        userId: testUserId,
        now: () => at + 2_000,
      });
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
      const replay = await refreshOverHttp(refreshCookie!, csrfCookie!);
      expect(replay.response.statusCode).toBe(401);

      // The legitimate holder's current cookie is dead too — family revoked
      // and sessionVersion bumped.
      const legitimate = await refreshOverHttp(second.nextRefreshCookie!, csrfCookie!);
      expect(legitimate.response.statusCode).toBe(401);

      // And the pre-replay access token no longer authenticates.
      const me = await server.app.inject({
        method: 'GET',
        url: '/api/trpc/auth.me?batch=1',
        headers: { authorization: `Bearer ${second.token}` },
      });
      expect(me.statusCode).toBe(401);
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

      const csrfProbe = await server.app.inject({ method: 'GET', url: '/api/trpc/health.check' });
      const csrfCookie = getCookieValue(csrfProbe.headers['set-cookie'], 'puntovivo_csrf');
      expect(csrfCookie).toBeTruthy();

      const upgraded = await refreshOverHttp(legacyToken, csrfCookie!);
      expect(upgraded.response.statusCode).toBe(200);
      expect(upgraded.nextRefreshCookie).toBeTruthy();

      // The upgraded cookie is family-tracked: it keeps refreshing fine.
      const next = await refreshOverHttp(upgraded.nextRefreshCookie!, csrfCookie!);
      expect(next.response.statusCode).toBe(200);
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

      const rowsAfter = db
        .select()
        .from(authRefreshFamilies)
        .where(eq(authRefreshFamilies.userId, testUserId))
        .all();
      expect(rowsAfter.length).toBe(0);
    });
  });
});
