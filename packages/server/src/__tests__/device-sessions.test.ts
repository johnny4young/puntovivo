/** Device-scoped sessions: revoking one hub_client leaves the same user's other terminal intact. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash } from 'argon2';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, companies, deviceSessions, sites, tenants, users } from '../db/schema.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyTokenWithServer,
} from '../security/authTokens.js';
import {
  createRefreshFamily,
  pruneExpiredRefreshFamilies,
} from '../security/refreshTokenFamilies.js';
import { bindDeviceSession } from '../services/devices/deviceSessions.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

describe('device_sessions isolated hub_client revocation', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('revokes only the targeted hub_client session and preserves other terminals without bumping sessionVersion', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const tenantId = `ds-tenant-${nanoid(6)}`;
    const companyId = `ds-company-${nanoid(6)}`;
    const siteId = `ds-site-${nanoid(6)}`;
    const adminId = `ds-admin-${nanoid(6)}`;

    await db.insert(tenants).values({
      id: tenantId,
      name: 'Supermercado Multi-Caja',
      slug: `multicaja-${nanoid(6)}`,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: companyId,
      tenantId,
      name: 'Multi-Caja SAS',
      taxId: `MC-${nanoid(6)}`,
      email: 'mc@example.com',
      phone: null,
      address: null,
      logoId: null,
      logoUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: siteId,
      tenantId,
      companyId,
      name: 'Principal',
      address: null,
      phone: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: adminId,
      tenantId,
      email: `admin-${nanoid(5)}@example.com`,
      passwordHash: await hash('TestPassword123!'),
      name: 'Admin Multi-Caja',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const adminRow = db.select().from(users).where(eq(users.id, adminId)).get()!;

    const familyHubClient = createRefreshFamily(db, { tenantId, userId: adminId });
    const familyDesktop = createRefreshFamily(db, { tenantId, userId: adminId });

    const makeCtx = (familyId: string): Context => ({
      req: {
        server: server.app,
        headers: {},
        cookies: {},
        ip: '127.0.0.1',
      } as unknown as Context['req'],
      res: {
        setCookie: () => undefined,
        clearCookie: () => undefined,
      } as unknown as Context['res'],
      db,
      user: {
        id: adminRow.id,
        email: adminRow.email,
        role: 'admin',
        tenantId,
        sessionVersion: adminRow.sessionVersion,
        familyId,
      },
      tenantId,
      siteId,
    });

    const hubClientCaller = appRouter.createCaller(makeCtx(familyHubClient.familyId));
    const hubClient = await hubClientCaller.auth.registerDevice({
      kind: 'hub_client',
      name: 'Caja Remota 2',
      siteId,
    });

    const desktopCaller = appRouter.createCaller(makeCtx(familyDesktop.familyId));
    const desktop = await desktopCaller.auth.registerDevice({
      kind: 'desktop',
      name: 'Caja Principal 1',
      siteId,
    });

    // Confirm both sessions are bound and their tokens verify before revocation.
    const hubAccessToken = signAccessToken(
      server.app,
      adminRow,
      undefined,
      familyHubClient.familyId
    );
    const hubRefreshToken = signRefreshToken(server.app, adminRow, familyHubClient);
    const desktopAccessToken = signAccessToken(
      server.app,
      adminRow,
      undefined,
      familyDesktop.familyId
    );
    const desktopRefreshToken = signRefreshToken(server.app, adminRow, familyDesktop);

    expect(await verifyTokenWithServer(server.app, hubAccessToken, 'access')).not.toBeNull();
    expect(await verifyTokenWithServer(server.app, desktopAccessToken, 'access')).not.toBeNull();
    expect(
      db.select().from(deviceSessions).where(eq(deviceSessions.deviceId, hubClient.deviceId)).all()
    ).toHaveLength(1);
    expect(
      db.select().from(deviceSessions).where(eq(deviceSessions.deviceId, desktop.deviceId)).all()
    ).toHaveLength(1);

    // A session no terminal claims cannot be traced to a device, so the revoke ends it.
    const familyStray = createRefreshFamily(db, { tenantId, userId: adminId });
    const strayAccessToken = signAccessToken(server.app, adminRow, undefined, familyStray.familyId);
    expect(await verifyTokenWithServer(server.app, strayAccessToken, 'access')).not.toBeNull();

    // Revoke only the hub_client terminal from the desktop authority caller.
    await desktopCaller.authority.revokeDevice({ deviceId: hubClient.deviceId });

    // Hub client's access + refresh tokens fail immediately.
    expect(await verifyTokenWithServer(server.app, hubAccessToken, 'access')).toBeNull();
    expect(await verifyTokenWithServer(server.app, hubRefreshToken, 'refresh')).toBeNull();

    expect(await verifyTokenWithServer(server.app, strayAccessToken, 'access')).toBeNull();

    // Desktop terminal of the SAME user remains completely unaffected!
    expect(await verifyTokenWithServer(server.app, desktopAccessToken, 'access')).not.toBeNull();
    expect(await verifyTokenWithServer(server.app, desktopRefreshToken, 'refresh')).not.toBeNull();

    // User's sessionVersion was NOT bumped.
    const afterUser = db.select().from(users).where(eq(users.id, adminId)).get()!;
    expect(afterUser.sessionVersion).toBe(adminRow.sessionVersion);

    // Audit log confirms isolated device-session revocation.
    const revokeAudit = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, hubClient.deviceId))
      .get();
    expect(revokeAudit?.metadata).toMatchObject({
      sessionVersionBumped: false,
      revokedDeviceSessions: 1,
      expiredUnboundFamilies: 1,
    });

    // Even after expired refresh families are pruned, the revoked access token stays invalid.
    pruneExpiredRefreshFamilies(db);
    expect(
      db.select().from(deviceSessions).where(eq(deviceSessions.deviceId, hubClient.deviceId)).all()
    ).toMatchObject([{ status: 'revoked', revokedByUserId: adminId }]);
    expect(await verifyTokenWithServer(server.app, hubAccessToken, 'access')).toBeNull();
    expect(await verifyTokenWithServer(server.app, hubRefreshToken, 'refresh')).toBeNull();
    expect(await verifyTokenWithServer(server.app, desktopAccessToken, 'access')).not.toBeNull();

    // Defensive check: binding an unknown family id fails safely.
    expect(
      bindDeviceSession(db, {
        tenantId,
        deviceId: desktop.deviceId,
        userId: adminId,
        refreshFamilyId: 'non-existent-family',
      })
    ).toBe(false);
  });
});
