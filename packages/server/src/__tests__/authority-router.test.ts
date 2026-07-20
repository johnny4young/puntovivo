/**
 * Authority Node pairing + health router tests.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash } from 'argon2';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  companies,
  devicePairingCodes,
  devices,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

interface Harness {
  tenantId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
  siteId: string;
}

async function seedHarness(suffix: string): Promise<Harness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `authority-tenant-${suffix}`;
  const companyId = `authority-company-${suffix}`;
  const siteId = `authority-site-${suffix}`;
  const adminId = `authority-admin-${suffix}`;
  const managerId = `authority-manager-${suffix}`;
  const cashierId = `authority-cashier-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Authority Tenant ${suffix}`,
    slug: `authority-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Authority Company ${suffix}`,
    taxId: `AUTH-${suffix}`,
    email: `company-${suffix}@example.com`,
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
    name: `Main ${suffix}`,
    address: null,
    phone: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@example.com`,
      passwordHash: await hash('TestPassword123!'),
      name: `Admin ${suffix}`,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `manager-${suffix}@example.com`,
      passwordHash: await hash('TestPassword123!'),
      name: `Manager ${suffix}`,
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `cashier-${suffix}@example.com`,
      passwordHash: await hash('TestPassword123!'),
      name: `Cashier ${suffix}`,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  return { tenantId, adminId, managerId, cashierId, siteId };
}

function buildCtx(h: Harness, role: 'admin' | 'manager' | 'cashier'): Context {
  const userId = role === 'admin' ? h.adminId : role === 'manager' ? h.managerId : h.cashierId;
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: `${userId}@example.com`, role, tenantId: h.tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: `${userId}@example.com`, role, tenantId: h.tenantId },
    tenantId: h.tenantId,
    siteId: h.siteId,
  };
}

describe('authority router', () => {
  let tenantA: Harness;
  let tenantB: Harness;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    tenantA = await seedHarness('a');
    tenantB = await seedHarness('b');
  });

  afterAll(async () => {
    await server.close();
  });

  it('lets admin create a short-lived pairing code scoped to a tenant site', async () => {
    const caller = appRouter.createCaller(buildCtx(tenantA, 'admin'));

    const result = await caller.authority.createPairingCode({
      siteId: tenantA.siteId,
      deviceName: 'Caja Norte 2',
      expiresInMinutes: 15,
    });

    expect(result.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(result.siteId).toBe(tenantA.siteId);

    const row = await getDatabase()
      .select()
      .from(devicePairingCodes)
      .where(eq(devicePairingCodes.id, result.id))
      .get();
    expect(row).toMatchObject({
      tenantId: tenantA.tenantId,
      siteId: tenantA.siteId,
      deviceName: 'Caja Norte 2',
      status: 'pending',
    });
    expect(row?.codeHash).not.toContain(result.code.replace('-', ''));
  });

  it('pairs auth.registerDevice with a valid code and marks the code claimed', async () => {
    const caller = appRouter.createCaller(buildCtx(tenantA, 'admin'));
    const pairing = await caller.authority.createPairingCode({
      siteId: tenantA.siteId,
      expiresInMinutes: 10,
    });

    const registered = await caller.auth.registerDevice({
      kind: 'hub_client',
      name: 'Caja paired',
      pairingCode: pairing.code,
      appVersion: '1.2.3',
    });

    const deviceRow = await getDatabase()
      .select()
      .from(devices)
      .where(eq(devices.id, registered.deviceId))
      .get();
    expect(deviceRow).toMatchObject({
      tenantId: tenantA.tenantId,
      kind: 'hub_client',
      authorityRole: 'hub_client',
      pairedSiteId: tenantA.siteId,
      appVersion: '1.2.3',
      isActive: true,
    });

    const codeRow = await getDatabase()
      .select()
      .from(devicePairingCodes)
      .where(eq(devicePairingCodes.id, pairing.id))
      .get();
    expect(codeRow).toMatchObject({
      status: 'claimed',
      claimedByDeviceId: registered.deviceId,
    });

    await expect(
      caller.auth.registerDevice({
        kind: 'hub_client',
        name: 'Caja duplicate claim',
        pairingCode: pairing.code,
      })
    ).rejects.toThrow(/already been used|AUTHORITY_PAIRING_CODE_USED|CONFLICT/i);

    const afterDuplicate = await getDatabase()
      .select()
      .from(devicePairingCodes)
      .where(eq(devicePairingCodes.id, pairing.id))
      .get();
    expect(afterDuplicate).toMatchObject({
      status: 'claimed',
      claimedByDeviceId: registered.deviceId,
    });
  });

  it('rejects cross-tenant pairing code reuse', async () => {
    const callerA = appRouter.createCaller(buildCtx(tenantA, 'admin'));
    const callerB = appRouter.createCaller(buildCtx(tenantB, 'admin'));
    const pairing = await callerA.authority.createPairingCode({
      siteId: tenantA.siteId,
      expiresInMinutes: 10,
    });

    await expect(
      callerB.auth.registerDevice({
        kind: 'hub_client',
        name: 'Wrong tenant',
        pairingCode: pairing.code,
      })
    ).rejects.toThrow(/Pairing code is invalid|AUTHORITY_PAIRING_CODE_INVALID|NOT_FOUND/i);
  });

  it('lets manager read status but not create pairing codes', async () => {
    const manager = appRouter.createCaller(buildCtx(tenantA, 'manager'));
    await expect(manager.authority.status()).resolves.toBeDefined();
    await expect(manager.authority.createPairingCode({ siteId: tenantA.siteId })).rejects.toThrow(
      /FORBIDDEN|administrators/i
    );
  });

  it('revokes only hub-client devices and writes an audit row', async () => {
    const caller = appRouter.createCaller(buildCtx(tenantA, 'admin'));
    const registered = await caller.auth.registerDevice({
      kind: 'hub_client',
      name: `Caja revoke ${nanoid(4)}`,
      siteId: tenantA.siteId,
    });

    await expect(caller.authority.revokeDevice({ deviceId: registered.deviceId })).resolves.toEqual(
      { success: true, deviceId: registered.deviceId }
    );

    const deviceRow = await getDatabase()
      .select()
      .from(devices)
      .where(eq(devices.id, registered.deviceId))
      .get();
    expect(deviceRow?.isActive).toBe(false);

    const audit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantA.tenantId),
          eq(auditLogs.action, 'device.revoke'),
          eq(auditLogs.resourceId, registered.deviceId)
        )
      )
      .get();
    expect(audit).toBeDefined();
  });

  // pin the sessionVersion bump on revoke + the device.pairing.claimed
  // audit row. Both close the audit's "token + session lifecycle" gaps.
  it('bumps the registering user sessionVersion when its device is revoked', async () => {
    const caller = appRouter.createCaller(buildCtx(tenantA, 'admin'));
    const registered = await caller.auth.registerDevice({
      kind: 'hub_client',
      name: `Caja session-bump ${nanoid(4)}`,
      siteId: tenantA.siteId,
    });

    const before = await getDatabase()
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, tenantA.adminId))
      .get();
    const baseline = before?.sessionVersion ?? 0;

    await caller.authority.revokeDevice({ deviceId: registered.deviceId });

    const after = await getDatabase()
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, tenantA.adminId))
      .get();
    expect(after?.sessionVersion).toBe(baseline + 1);

    // Audit metadata must record the bump so forensics can reconstruct
    // why a user got logged out.
    const audit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantA.tenantId),
          eq(auditLogs.action, 'device.revoke'),
          eq(auditLogs.resourceId, registered.deviceId)
        )
      )
      .get();
    expect(audit?.metadata).toMatchObject({
      registeredByUserId: tenantA.adminId,
      sessionVersionBumped: true,
    });
  });

  it('writes a device.pairing.claimed audit row inside the same tx', async () => {
    const caller = appRouter.createCaller(buildCtx(tenantA, 'admin'));
    const pairing = await caller.authority.createPairingCode({
      siteId: tenantA.siteId,
      expiresInMinutes: 10,
    });

    const registered = await caller.auth.registerDevice({
      kind: 'hub_client',
      name: `Caja audit ${nanoid(4)}`,
      pairingCode: pairing.code,
    });

    const audit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantA.tenantId),
          eq(auditLogs.action, 'device.pairing.claimed'),
          eq(auditLogs.resourceId, registered.deviceId)
        )
      )
      .get();
    expect(audit).toBeDefined();
    expect(audit?.actorId).toBe(tenantA.adminId);
    // pairing.code shape is `XXXX-XXXX`; the audit row masks down to
    // the last 4 chars so the full code never lands in the log.
    const expectedSuffix = pairing.code.slice(-4);
    expect(audit?.metadata).toMatchObject({
      pairingCodeMasked: expectedSuffix,
      siteId: tenantA.siteId,
      kind: 'hub_client',
    });
  });

  it('keeps status tenant scoped', async () => {
    const callerA = appRouter.createCaller(buildCtx(tenantA, 'admin'));
    const callerB = appRouter.createCaller(buildCtx(tenantB, 'admin'));

    const statusA = await callerA.authority.status();
    const statusB = await callerB.authority.status();

    expect(statusA.devices.some(device => device.name === 'Wrong tenant')).toBe(false);
    expect(statusB.devices.some(device => device.name === 'Wrong tenant')).toBe(true);
  });
});
