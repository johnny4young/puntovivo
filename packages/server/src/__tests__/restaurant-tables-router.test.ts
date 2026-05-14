/**
 * ENG-039b — `restaurantTables.*` router tests.
 *
 * Coverage: role gates, tenant scope, partial-unique on active rows,
 * archived-row exclusion, idempotent archive, audit-log emission.
 */

import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  companies,
  restaurantTables,
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
  const tenantId = `rt-tenant-${suffix}`;
  const adminId = `rt-admin-${suffix}`;
  const managerId = `rt-mgr-${suffix}`;
  const cashierId = `rt-csh-${suffix}`;
  const siteId = `rt-site-${suffix}`;
  const companyId = `rt-company-${suffix}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `RT Tenant ${suffix}`,
    slug: `rt-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `RT Company ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `RT Site ${suffix}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@rt.test`,
      name: `Admin ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `mgr-${suffix}@rt.test`,
      name: `Manager ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `csh-${suffix}@rt.test`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, adminId, managerId, cashierId, siteId };
}

function buildCtx(
  tenantId: string,
  userId: string,
  role: 'admin' | 'manager' | 'cashier' | 'viewer'
): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@rt.test`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: {
      id: userId,
      email: `${userId}@rt.test`,
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

async function readLatestAudit(
  tenantId: string,
  resourceId: string,
  action:
    | 'restaurant_table.create'
    | 'restaurant_table.update'
    | 'restaurant_table.archive'
) {
  const db = getDatabase();
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.resourceId, resourceId),
        eq(auditLogs.action, action)
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .get();
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('restaurantTables.create (ENG-039b)', () => {
  it('admin creates a table; row exists with tenant + site scope; audit row written', async () => {
    const h = await seedHarness('create-ok');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa 1',
      seatCount: 4,
      area: 'Salón principal',
      notes: 'Ventana',
    });
    expect(result).toMatchObject({
      tenantId: h.tenantId,
      siteId: h.siteId,
      name: 'Mesa 1',
      seatCount: 4,
      area: 'Salón principal',
      notes: 'Ventana',
      isActive: true,
    });
    const audit = await readLatestAudit(h.tenantId, result.id, 'restaurant_table.create');
    expect(audit).toBeDefined();
    expect(audit?.after).toMatchObject({ name: 'Mesa 1', siteId: h.siteId });
    expect(audit?.metadata).toMatchObject({ siteId: h.siteId });
  });

  it('manager attempting create is FORBIDDEN', async () => {
    const h = await seedHarness('create-mgr');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    await expect(
      caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa 1' })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('cashier attempting create is FORBIDDEN', async () => {
    const h = await seedHarness('create-csh');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(
      caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa 1' })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('duplicate active name in the same (tenant, site) throws RESTAURANT_TABLE_NAME_DUPLICATE', async () => {
    const h = await seedHarness('dup-active');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa 1' });
    await expect(
      caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa 1' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_NAME_DUPLICATE' }),
    });
  });

  it('re-creates a name after archiving the original (partial unique excludes archived)', async () => {
    const h = await seedHarness('reuse-name');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const first = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa 1',
    });
    await caller.restaurantTables.archive({ id: first.id });
    const second = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa 1',
    });
    expect(second.id).not.toBe(first.id);
    expect(second.isActive).toBe(true);
  });

  it('cross-tenant siteId collapses to RESTAURANT_TABLE_NOT_FOUND on create', async () => {
    const a = await seedHarness('cross-a');
    const b = await seedHarness('cross-b');
    const caller = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    await expect(
      caller.restaurantTables.create({ siteId: b.siteId, name: 'Cross Mesa' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_NOT_FOUND' }),
    });
  });
});

describe('restaurantTables.list + getById (ENG-039b)', () => {
  it('manager can list tables; cashier listing is FORBIDDEN', async () => {
    const h = await seedHarness('list-roles');
    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa A' });
    const manager = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    const res = await manager.restaurantTables.list({ siteId: h.siteId });
    expect(res.items).toHaveLength(1);
    const cashier = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(
      cashier.restaurantTables.list({ siteId: h.siteId })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('includeArchived false filters archived rows; true includes them', async () => {
    const h = await seedHarness('list-archived');
    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const a = await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa A' });
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa B' });
    await admin.restaurantTables.archive({ id: a.id });
    const activeOnly = await admin.restaurantTables.list({ siteId: h.siteId });
    expect(activeOnly.items.map(r => r.name)).toEqual(['Mesa B']);
    const all = await admin.restaurantTables.list({
      siteId: h.siteId,
      includeArchived: true,
    });
    expect(all.items.map(r => r.name).sort()).toEqual(['Mesa A', 'Mesa B']);
  });

  it('cross-tenant getById collapses to RESTAURANT_TABLE_NOT_FOUND (never FORBIDDEN)', async () => {
    const a = await seedHarness('cross-getbyid-a');
    const b = await seedHarness('cross-getbyid-b');
    const adminB = appRouter.createCaller(buildCtx(b.tenantId, b.adminId, 'admin'));
    const row = await adminB.restaurantTables.create({
      siteId: b.siteId,
      name: 'Mesa B1',
    });
    const adminA = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    await expect(
      adminA.restaurantTables.getById({ id: row.id })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_NOT_FOUND' }),
    });
  });
});

describe('restaurantTables.update (ENG-039b)', () => {
  it('admin can update name + seat count; audit row carries before/after', async () => {
    const h = await seedHarness('update-ok');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const row = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa 1',
      seatCount: 2,
    });
    const updated = await caller.restaurantTables.update({
      id: row.id,
      name: 'Mesa Uno',
      seatCount: 6,
    });
    expect(updated).toMatchObject({ name: 'Mesa Uno', seatCount: 6 });
    const audit = await readLatestAudit(h.tenantId, row.id, 'restaurant_table.update');
    expect(audit?.before).toMatchObject({ name: 'Mesa 1', seatCount: 2 });
    expect(audit?.after).toMatchObject({ name: 'Mesa Uno', seatCount: 6 });
  });

  it('update to a duplicate active name throws RESTAURANT_TABLE_NAME_DUPLICATE', async () => {
    const h = await seedHarness('update-dup');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa A' });
    const b = await caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa B' });
    await expect(
      caller.restaurantTables.update({ id: b.id, name: 'Mesa A' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_NAME_DUPLICATE' }),
    });
  });

  it('reactivating an archived duplicate reports the existing table name', async () => {
    const h = await seedHarness('update-reactivate-dup');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const archived = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa A',
    });
    await caller.restaurantTables.archive({ id: archived.id });
    await caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa A' });
    await expect(
      caller.restaurantTables.update({ id: archived.id, isActive: true })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'RESTAURANT_TABLE_NAME_DUPLICATE',
        details: expect.objectContaining({ siteId: h.siteId, name: 'Mesa A' }),
      }),
    });
  });

  it('cross-tenant update collapses to RESTAURANT_TABLE_NOT_FOUND', async () => {
    const a = await seedHarness('update-cross-a');
    const b = await seedHarness('update-cross-b');
    const adminB = appRouter.createCaller(buildCtx(b.tenantId, b.adminId, 'admin'));
    const row = await adminB.restaurantTables.create({
      siteId: b.siteId,
      name: 'Mesa B-cross',
    });
    const adminA = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    await expect(
      adminA.restaurantTables.update({ id: row.id, name: 'Hijacked' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_NOT_FOUND' }),
    });
    // The row in tenant B stays untouched.
    const stillThere = await adminB.restaurantTables.getById({ id: row.id });
    expect(stillThere.name).toBe('Mesa B-cross');
  });
});

describe('restaurantTables.archive (ENG-039b)', () => {
  it('archive flips isActive to false; second archive is idempotent (no second audit row)', async () => {
    const h = await seedHarness('archive-idem');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const row = await caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa X' });
    const first = await caller.restaurantTables.archive({ id: row.id });
    expect(first.isActive).toBe(false);
    const audit1 = await readLatestAudit(
      h.tenantId,
      row.id,
      'restaurant_table.archive'
    );
    expect(audit1).toBeDefined();
    const second = await caller.restaurantTables.archive({ id: row.id });
    expect(second.isActive).toBe(false);
    const db = getDatabase();
    const archiveRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, h.tenantId),
          eq(auditLogs.resourceId, row.id),
          eq(auditLogs.action, 'restaurant_table.archive')
        )
      )
      .all();
    expect(archiveRows).toHaveLength(1);
  });
});
