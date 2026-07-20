import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { hash } from 'argon2';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, users } from '../db/schema.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let testDeviceId: string;

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

async function loginOverHttp(email: string, password: string) {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/trpc/auth.login?batch=1',
    headers: {
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      '0': {
        email,
        password,
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

function createTestContext(role: 'admin' | 'manager' | 'cashier' = 'admin'): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: makeEnvelopeHeadersProxy({ getDeviceId: () => testDeviceId }),
    user: {
      userId,
      email: `${role}@localhost`,
      role,
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  return {
    req: mockReq,
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: `${role}@localhost`,
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

describe('Users tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
    });

    const db = getDatabase();
    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) {
      throw new Error('Expected seeded admin user');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;

    // register one device for the active tenant; reused
    // by every critical user-management mutation (`users.create`,
    // `users.update`).
    const registration = await registerDeviceService(getDatabase(), {
      tenantId,
      userId,
      kind: 'web',
      name: 'users.test',
    });
    testDeviceId = registration.deviceId;
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates, lists, updates, and resets passwords for users', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.users.create({
      email: 'cashier@example.com',
      name: 'Cashier User',
      password: 'TempPass123!Aa',
      role: 'cashier',
      isActive: true,
    });

    expect(created.email).toBe('cashier@example.com');

    const listed = await caller.users.list({ page: 1, perPage: 20, search: 'Cashier' });
    expect(listed.items.some(user => user.id === created.id)).toBe(true);

    const updated = await caller.users.update({
      id: created.id,
      name: 'Cashier Updated',
      role: 'manager',
      isActive: false,
    });

    expect(updated.name).toBe('Cashier Updated');
    expect(updated.role).toBe('manager');
    expect(updated.isActive).toBe(false);

    const reset = await caller.users.resetPassword({
      id: created.id,
      newPassword: 'NewTempPass123!Aa',
    });

    expect(reset.success).toBe(true);
  });

  it('invalidates existing sessions after an admin password reset', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.users.create({
      email: 'session-user@example.com',
      name: 'Session User',
      password: 'SessionUser123!',
      role: 'cashier',
      isActive: true,
    });

    const { accessToken, refreshCookie, csrfCookie } = await loginOverHttp(
      'session-user@example.com',
      'SessionUser123!'
    );

    expect(accessToken).toBeTruthy();
    expect(refreshCookie).toBeTruthy();
    expect(csrfCookie).toBeTruthy();

    const reset = await caller.users.resetPassword({
      id: created.id,
      newPassword: 'SessionUser456!',
    });

    expect(reset.success).toBe(true);

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
    await db
      .update(users)
      .set({
        passwordHash: await hash('SessionUser123!'),
        sessionVersion: 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, created.id));
  });

  it('rejects non-admin user listing', async () => {
    const caller = appRouter.createCaller(createTestContext('cashier'));

    try {
      await caller.users.list({ page: 1, perPage: 20 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
    }
  });

  it('invalidates existing sessions after role or email changes', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.users.create({
      email: 'claims-user@example.com',
      name: 'Claims User',
      password: 'ClaimsUser123!',
      role: 'cashier',
      isActive: true,
    });

    const { accessToken, refreshCookie, csrfCookie } = await loginOverHttp(
      'claims-user@example.com',
      'ClaimsUser123!'
    );

    expect(accessToken).toBeTruthy();
    expect(refreshCookie).toBeTruthy();
    expect(csrfCookie).toBeTruthy();

    const updated = await caller.users.update({
      id: created.id,
      email: 'claims-user-updated@example.com',
      role: 'manager',
    });

    expect(updated.email).toBe('claims-user-updated@example.com');
    expect(updated.role).toBe('manager');

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
  });

  it('rejects weak passwords on user creation and password reset', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.users.create({
        email: 'weak-user@example.com',
        name: 'Weak User',
        password: 'weakpass1',
        role: 'cashier',
        isActive: true,
      })
    ).rejects.toThrow('Password must be at least 12 characters');

    const created = await caller.users.create({
      email: 'strong-user@example.com',
      name: 'Strong User',
      password: 'StrongPass123!',
      role: 'cashier',
      isActive: true,
    });

    await expect(
      caller.users.resetPassword({
        id: created.id,
        newPassword: 'weakpass1',
      })
    ).rejects.toThrow('Password must be at least 12 characters');
  });

  it('sets and clears a staff PIN without exposing its hash', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const created = await caller.users.create({
      email: 'pin-user@example.com',
      name: 'PIN User',
      password: 'PinUserPass123!',
      role: 'cashier',
      isActive: true,
    });

    const configured = await caller.users.setStaffPin({ id: created.id, pin: '246810' });
    expect(configured).toEqual({ success: true, id: created.id, hasPin: true });

    const stored = await getDatabase()
      .select({ staffPinHash: users.staffPinHash })
      .from(users)
      .where(eq(users.id, created.id))
      .get();
    expect(stored?.staffPinHash).toMatch(/^\$argon2id\$/);
    expect(stored?.staffPinHash).not.toContain('246810');

    const listed = await caller.users.list({ page: 1, perPage: 20, search: 'PIN User' });
    expect(listed.items[0]).toMatchObject({ id: created.id, hasPin: true });
    expect(listed.items[0]).not.toHaveProperty('staffPinHash');

    const audit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, created.id))
      .all();
    const pinAudit = audit.find(row => row.action === 'user.pin.update');
    expect(pinAudit?.before).toEqual({ configured: false });
    expect(pinAudit?.after).toEqual({ configured: true });
    expect(JSON.stringify(pinAudit)).not.toContain('246810');

    const cleared = await caller.users.setStaffPin({ id: created.id, pin: null });
    expect(cleared.hasPin).toBe(false);
  });

  it('rejects non-admin staff PIN management', async () => {
    const adminCaller = appRouter.createCaller(createTestContext());
    const created = await adminCaller.users.create({
      email: 'pin-role-guard@example.com',
      name: 'PIN Guard User',
      password: 'PinGuardPass123!',
      role: 'cashier',
      isActive: true,
    });
    const managerCaller = appRouter.createCaller(createTestContext('manager'));
    await expect(
      managerCaller.users.setStaffPin({ id: created.id, pin: '123456' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
