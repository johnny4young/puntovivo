/**
 * `restaurantTables.*` router tests.
 *
 * Coverage: role gates, tenant scope, partial-unique on active rows,
 * archived-row exclusion, idempotent archive, audit-log emission.
 */

import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { nanoid } from 'nanoid';
import {
  auditLogs,
  cashSessions,
  companies,
  restaurantTables,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE } from '../trpc/schemas/restaurantTables.js';

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
    // the table map is a dine-in surface; every fixture in this
    // suite is a table-service tenant. The absent-module case is pinned
    // by its own test below.
    settings: { modules: { 'dine-in': true } },
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
  // a financially committed sale now requires a cash session at the
  // schema level (draft and cancelled draft rows are the non-financial exemptions).
  // Seed one closed session per harness so the `insertSaleOnTable`
  // fixture can stamp it on non-draft rows and exercise site integrity on
  // legacy drafts that do carry a session.
  const cashSessionId = `rt-cs-${suffix}`;
  await db.insert(cashSessions).values({
    id: cashSessionId,
    tenantId,
    siteId,
    cashierId,
    registerName: `reg-${suffix}`,
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    status: 'closed',
    openedAt: now,
    closedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  cashSessionByTenant.set(tenantId, cashSessionId);
  return { tenantId, adminId, managerId, cashierId, siteId };
}

// maps each seeded tenant to its fixture cash session so the
// non-draft `insertSaleOnTable` rows satisfy the committed-sale CHECK.
const cashSessionByTenant = new Map<string, string>();

// Insert a sale directly so table-catalog tests can cover legacy drafts and
// terminal rows without going through the larger sales command surface.
async function insertSaleOnTable(
  tenantIdValue: string,
  actorId: string,
  tableRowId: string,
  overrides: Partial<{
    status: 'draft' | 'completed';
    suspended: boolean;
    suspendedAt: string;
    total: number;
    cashSessionId: string | null;
  }> = {}
): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  const now = overrides.suspendedAt ?? new Date().toISOString();
  const suspended = overrides.suspended ?? true;
  const status = overrides.status ?? 'draft';
  await db.insert(sales).values({
    id,
    tenantId: tenantIdValue,
    saleNumber: `T-${id.slice(0, 6)}`,
    tableId: tableRowId,
    total: overrides.total ?? 25,
    subtotal: overrides.total ?? 25,
    taxAmount: 0,
    discountAmount: 0,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    status,
    // Committed rows need a session; drafts remain exempt so the fixture also
    // exercises the pre-normalization null-session path.
    cashSessionId:
      overrides.cashSessionId !== undefined
        ? overrides.cashSessionId
        : status === 'draft'
          ? null
          : (cashSessionByTenant.get(tenantIdValue) ?? null),
    createdBy: actorId,
    suspendedAt: suspended ? now : null,
    suspendedBy: suspended ? actorId : null,
    suspendedLabel: suspended ? 'auto' : null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
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
  action: 'restaurant_table.create' | 'restaurant_table.update' | 'restaurant_table.archive'
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

describe('restaurantTables.create', () => {
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

  it('caps active tables atomically while allowing archived history', async () => {
    const h = await seedHarness('active-cap');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const db = getDatabase();
    const now = new Date().toISOString();
    const activeRows = Array.from(
      { length: MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE - 1 },
      (_, index) => ({
        id: `rt-cap-active-${index}`,
        tenantId: h.tenantId,
        siteId: h.siteId,
        name: `Mesa ${String(index).padStart(3, '0')}`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
    );
    const archivedId = 'rt-cap-archived';
    await db.insert(restaurantTables).values([
      ...activeRows,
      {
        id: archivedId,
        tenantId: h.tenantId,
        siteId: h.siteId,
        name: 'Mesa archivada disponible',
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const lastActive = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa límite',
    });
    const fullList = await caller.restaurantTables.list({ siteId: h.siteId });
    expect(fullList).toMatchObject({
      totalItems: MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE,
      hasMore: false,
    });
    expect(fullList.items).toHaveLength(MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE);

    await expect(
      caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa excedente' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'RESTAURANT_TABLE_LIMIT_REACHED',
        details: expect.objectContaining({
          maximumActiveTables: MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE,
        }),
      }),
    });
    await expect(
      caller.restaurantTables.update({ id: archivedId, isActive: true })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_LIMIT_REACHED' }),
    });

    await caller.restaurantTables.archive({ id: lastActive.id });
    await expect(
      caller.restaurantTables.update({ id: archivedId, isActive: true })
    ).resolves.toMatchObject({ id: archivedId, isActive: true });
  });
});

describe('restaurantTables.list + getById', () => {
  it('manager and cashier can list tables; viewer remains forbidden', async () => {
    const h = await seedHarness('list-roles');
    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa A' });
    const manager = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    const res = await manager.restaurantTables.list({ siteId: h.siteId });
    expect(res.items).toHaveLength(1);
    const cashier = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(cashier.restaurantTables.list({ siteId: h.siteId })).resolves.toMatchObject({
      items: [expect.objectContaining({ name: 'Mesa A' })],
    });
    const viewer = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'viewer'));
    await expect(viewer.restaurantTables.list({ siteId: h.siteId })).rejects.toBeInstanceOf(
      TRPCError
    );
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

  it('reports pagination metadata instead of silently truncating the catalog', async () => {
    const h = await seedHarness('list-pagination');
    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa A' });
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa B' });
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa C' });

    const first = await admin.restaurantTables.list({ siteId: h.siteId, limit: 2 });
    expect(first).toMatchObject({ offset: 0, limit: 2, totalItems: 3, hasMore: true });
    expect(first.items.map(row => row.name)).toEqual(['Mesa A', 'Mesa B']);

    const second = await admin.restaurantTables.list({
      siteId: h.siteId,
      limit: 2,
      offset: 2,
    });
    expect(second).toMatchObject({ offset: 2, limit: 2, totalItems: 3, hasMore: false });
    expect(second.items.map(row => row.name)).toEqual(['Mesa C']);
  });

  it('searches the full tenant-site catalog before pagination and treats wildcards literally', async () => {
    const h = await seedHarness('list-search');
    const other = await seedHarness('list-search-other');
    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const otherAdmin = appRouter.createCaller(buildCtx(other.tenantId, other.adminId, 'admin'));
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa Salón' });
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa Patio' });
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa % VIP' });
    await otherAdmin.restaurantTables.create({ siteId: other.siteId, name: 'Mesa Patio ajena' });

    const patio = await admin.restaurantTables.list({
      siteId: h.siteId,
      search: 'patio',
      limit: 1,
    });
    expect(patio).toMatchObject({ totalItems: 1, hasMore: false });
    expect(patio.items.map(row => row.name)).toEqual(['Mesa Patio']);

    const literalPercent = await admin.restaurantTables.listWithDraftStatus({
      siteId: h.siteId,
      search: '%',
    });
    expect(literalPercent.totalItems).toBe(1);
    expect(literalPercent.items.map(row => row.name)).toEqual(['Mesa % VIP']);
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
    await expect(adminA.restaurantTables.getById({ id: row.id })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_NOT_FOUND' }),
    });
  });
});

describe('restaurantTables.update', () => {
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

  it('does not deactivate a table that still owns a legacy draft without a service', async () => {
    const h = await seedHarness('update-legacy-draft');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const table = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa legado',
    });
    await insertSaleOnTable(h.tenantId, h.adminId, table.id);

    await expect(
      caller.restaurantTables.update({ id: table.id, isActive: false })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_HAS_OPEN_SERVICE' }),
    });
    await expect(caller.restaurantTables.getById({ id: table.id })).resolves.toMatchObject({
      isActive: true,
    });
  });
});

describe('restaurantTables.listWithDraftStatus', () => {
  it('returns each catalog row with its open draft (or null)', async () => {
    const h = await seedHarness('list-draft-mix');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const occupied = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa Ocupada',
    });
    const free = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa Libre',
    });
    const draftSaleId = await insertSaleOnTable(h.tenantId, h.adminId, occupied.id);

    const result = await caller.restaurantTables.listWithDraftStatus({ siteId: h.siteId });
    const occupiedRow = result.items.find(row => row.id === occupied.id);
    const freeRow = result.items.find(row => row.id === free.id);

    expect(occupiedRow?.openDraft?.saleId).toBe(draftSaleId);
    expect(occupiedRow?.openDraft?.total).toBe(25);
    expect(occupiedRow?.openDrafts).toHaveLength(1);
    expect(freeRow?.openDraft).toBeNull();
    expect(freeRow?.openDrafts).toEqual([]);
    expect(result).toMatchObject({ totalItems: 2, hasMore: false, offset: 0 });
  });

  it('returns one catalog row when multiple open drafts point at the same table', async () => {
    const h = await seedHarness('list-draft-dupe');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const table = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa Duplicada',
    });
    const olderDraftId = await insertSaleOnTable(h.tenantId, h.adminId, table.id, {
      suspendedAt: '2026-05-14T10:00:00.000Z',
      total: 10,
    });
    const newerDraftId = await insertSaleOnTable(h.tenantId, h.adminId, table.id, {
      suspendedAt: '2026-05-14T10:05:00.000Z',
      total: 35,
    });

    const result = await caller.restaurantTables.listWithDraftStatus({ siteId: h.siteId });
    const rowsForTable = result.items.filter(row => row.id === table.id);

    expect(rowsForTable).toHaveLength(1);
    expect(rowsForTable[0]?.openDraft?.saleId).toBe(newerDraftId);
    expect(rowsForTable[0]?.openDraft?.total).toBe(35);
    expect(rowsForTable[0]?.openDrafts.map(draft => draft.saleId)).toEqual([
      newerDraftId,
      olderDraftId,
    ]);
  });

  it('fails closed instead of materializing unbounded legacy table occupancy', async () => {
    const h = await seedHarness('list-draft-bound');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const table = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa con límite',
    });
    for (let index = 0; index <= 100; index += 1) {
      await insertSaleOnTable(h.tenantId, h.adminId, table.id, {
        suspendedAt: `2026-05-14T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
      });
    }

    await expect(
      caller.restaurantTables.listWithDraftStatus({ siteId: h.siteId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED' }),
    });
  });

  it('cashier can read table occupancy while viewer remains forbidden', async () => {
    const h = await seedHarness('list-draft-csh');
    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa Csh' });
    const cashier = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(
      cashier.restaurantTables.listWithDraftStatus({ siteId: h.siteId })
    ).resolves.toMatchObject({ items: [expect.objectContaining({ name: 'Mesa Csh' })] });
    const viewer = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'viewer'));
    await expect(
      viewer.restaurantTables.listWithDraftStatus({ siteId: h.siteId })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('cross-tenant draft never surfaces as the open row', async () => {
    const a = await seedHarness('list-draft-x-a');
    const b = await seedHarness('list-draft-x-b');
    const adminA = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    const tableA = await adminA.restaurantTables.create({
      siteId: a.siteId,
      name: 'Mesa Cruz A',
    });
    // Insert a draft anchored to a DIFFERENT tenant's table id but
    // recorded under tenant A. The draft lookup pins `sales.tenant_id`
    // so a sale with a foreign-tenant table_id never
    // surfaces as the open draft for that row.
    const adminB = appRouter.createCaller(buildCtx(b.tenantId, b.adminId, 'admin'));
    const tableB = await adminB.restaurantTables.create({
      siteId: b.siteId,
      name: 'Mesa Cruz B',
    });
    await insertSaleOnTable(b.tenantId, b.adminId, tableB.id);

    const result = await adminA.restaurantTables.listWithDraftStatus({ siteId: a.siteId });
    const occupiedFromA = result.items.find(row => row.id === tableA.id);
    expect(occupiedFromA?.openDraft).toBeNull();
  });

  it('a resumed draft stays visible while a completed sale does not occupy the table', async () => {
    const h = await seedHarness('list-draft-status');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const table = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa Estados',
    });
    // Resuming clears suspended_at but does not settle the restaurant check;
    // status=draft remains the authoritative occupancy signal.
    const resumedId = await insertSaleOnTable(h.tenantId, h.adminId, table.id, {
      suspended: false,
    });
    await insertSaleOnTable(h.tenantId, h.adminId, table.id, {
      status: 'completed',
      suspended: false,
    });
    const result = await caller.restaurantTables.listWithDraftStatus({ siteId: h.siteId });
    const row = result.items.find(item => item.id === table.id);
    expect(row?.openDraft?.saleId).toBe(resumedId);
    expect(row?.openDraft?.suspendedAt).toBeNull();
    expect(row?.openDrafts).toHaveLength(1);
  });

  it('fails closed when a draft session belongs to a different site than its table', async () => {
    const h = await seedHarness('list-draft-site-mismatch');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const table = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa inconsistente',
    });
    const otherSiteId = `rt-site-other-${nanoid(6)}`;
    const now = new Date().toISOString();
    const company = await getDatabase()
      .select({ companyId: sites.companyId })
      .from(sites)
      .where(eq(sites.id, h.siteId))
      .get();
    if (!company) throw new Error('Expected harness company');
    await getDatabase().insert(sites).values({
      id: otherSiteId,
      tenantId: h.tenantId,
      companyId: company.companyId,
      name: 'Otra sede',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const cashSessionId = cashSessionByTenant.get(h.tenantId);
    if (!cashSessionId) throw new Error('Expected harness cash session');
    await getDatabase()
      .update(cashSessions)
      .set({ siteId: otherSiteId })
      .where(eq(cashSessions.id, cashSessionId));
    await insertSaleOnTable(h.tenantId, h.adminId, table.id, { cashSessionId });

    await expect(
      caller.restaurantTables.listWithDraftStatus({ siteId: h.siteId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
    });
  });
});

describe('restaurantTables.archive', () => {
  it('archive flips isActive to false; second archive is idempotent (no second audit row)', async () => {
    const h = await seedHarness('archive-idem');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const row = await caller.restaurantTables.create({ siteId: h.siteId, name: 'Mesa X' });
    const first = await caller.restaurantTables.archive({ id: row.id });
    expect(first.isActive).toBe(false);
    const audit1 = await readLatestAudit(h.tenantId, row.id, 'restaurant_table.archive');
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

  it('does not archive a table that still owns a legacy draft without a service', async () => {
    const h = await seedHarness('archive-legacy-draft');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const table = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa legado',
    });
    await insertSaleOnTable(h.tenantId, h.adminId, table.id);

    await expect(caller.restaurantTables.archive({ id: table.id })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_HAS_OPEN_SERVICE' }),
    });
    await expect(caller.restaurantTables.getById({ id: table.id })).resolves.toMatchObject({
      isActive: true,
    });
  });

  it('does not treat an already inactive table with a legacy draft as safely archived', async () => {
    const h = await seedHarness('archive-inactive-legacy-draft');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const table = await caller.restaurantTables.create({
      siteId: h.siteId,
      name: 'Mesa archivada con borrador',
    });
    await caller.restaurantTables.archive({ id: table.id });
    await insertSaleOnTable(h.tenantId, h.adminId, table.id);

    await expect(caller.restaurantTables.archive({ id: table.id })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_HAS_OPEN_SERVICE' }),
    });
  });
});

describe('restaurantTables dine-in module gate', () => {
  it('refuses every procedure for a tenant without the dine-in module', async () => {
    const h = await seedHarness('no-dine-in');
    // Turn the module back off: a counter-only tenant must not reach the
    // table map over the wire, not just be unable to see it in the UI.
    await getDatabase()
      .update(tenants)
      .set({ settings: { modules: { 'dine-in': false } } })
      .where(eq(tenants.id, h.tenantId));

    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const manager = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));

    await expect(manager.restaurantTables.list({ siteId: h.siteId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      admin.restaurantTables.create({ siteId: h.siteId, name: 'Mesa fantasma' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(manager.restaurantSettings.get()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
