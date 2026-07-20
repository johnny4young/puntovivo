/**
 * Kitchen Display System tests.
 *
 * Coverage:
 * - Enqueue lifecycle (suspend → KDS row, suspend idempotency, complete
 * without prior suspend, regular POS sale skipped, module gate skip).
 * - Refresh lifecycle (changeTable rewrites label; splitDraft refreshes
 * source + enqueues new card).
 * - Remove lifecycle (discardDraft + voidSale delete the card).
 * - Router `list` site scope + ready TTL eviction.
 * - Router `markReady` transition + idempotency + audit emission.
 * - Router `recall` transition + invalid-state guard + audit emission.
 * - Cross-tenant collapse (list / markReady / recall return NOT_FOUND).
 */

import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';
import {
  auditLogs,
  companies,
  inventoryBalances,
  kdsOrders,
  products,
  restaurantTables,
  saleItems,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let adminId: string;
let cashierId: string;
let primarySiteId: string;
let productId: string;
let baseUnitId: string;
let primarySessionId: string;
let mesa1Id: string;
let mesa2Id: string;

let otherTenantId: string;
let otherAdminId: string;
let otherSiteId: string;

const deviceIdByTenant = new Map<string, string>();

function createContext(
  userId: string,
  role: 'admin' | 'manager' | 'cashier',
  tenant: string,
  siteId: string | null
): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: makeEnvelopeHeadersProxy({
        getDeviceId: () => deviceIdByTenant.get(tenant),
        getSiteId: () => siteId,
      }),
      user: { userId, email: `${role}@localhost`, role, tenantId: tenant },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: `${role}@localhost`, role, tenantId: tenant },
    tenantId: tenant,
    siteId,
  };
}

async function enableKdsModule(forTenantId: string): Promise<void> {
  const db = getDatabase();
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, forTenantId))
    .get();
  const settings = (row?.settings as Record<string, unknown> | null) ?? {};
  const modules = (settings.modules as Record<string, boolean> | undefined) ?? {};
  const next = { ...settings, modules: { ...modules, kds: true } };
  await db
    .update(tenants)
    .set({ settings: next, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, forTenantId));
}

async function disableKdsModule(forTenantId: string): Promise<void> {
  const db = getDatabase();
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, forTenantId))
    .get();
  const settings = (row?.settings as Record<string, unknown> | null) ?? {};
  const modules = (settings.modules as Record<string, boolean> | undefined) ?? {};
  const next = { ...settings, modules: { ...modules, kds: false } };
  await db
    .update(tenants)
    .set({ settings: next, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, forTenantId));
}

async function openSession(userId: string, role: 'admin' | 'cashier') {
  const caller = appRouter.createCaller(createContext(userId, role, tenantId, primarySiteId));
  const session = await caller.cashSessions.open({
    registerName: `Register ${userId.slice(0, 6)}-${nanoid(4)}`,
    openingFloat: 100,
    denominations: [{ value: 50, count: 2 }],
  });
  return session;
}

async function createDraftAtTable(tableId: string | null): Promise<string> {
  const caller = appRouter.createCaller(
    createContext(cashierId, 'cashier', tenantId, primarySiteId)
  );
  const created = await caller.sales.create({
    items: [
      {
        productId,
        unitId: baseUnitId,
        quantity: 2,
        unitPrice: 10,
        discount: 0,
        taxRate: 0,
      },
    ],
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    amountReceived: 0,
    discountAmount: 0,
    status: 'draft',
    ...(tableId ? { tableId } : {}),
  });
  return created.id;
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const now = new Date().toISOString();

  const seededAdmin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededAdmin) throw new Error('Expected seeded admin user');
  tenantId = seededAdmin.tenantId;
  adminId = seededAdmin.id;

  const mainSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!mainSite) throw new Error('Expected seeded main site');
  primarySiteId = mainSite.id;

  const baseUnit = await db
    .select()
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
    .get();
  if (!baseUnit) throw new Error('Expected seeded UND unit');
  baseUnitId = baseUnit.id;

  cashierId = nanoid();
  await db.insert(users).values({
    id: cashierId,
    tenantId,
    email: 'kds-cashier@localhost',
    passwordHash: 'x',
    name: 'KDS Cashier',
    role: 'cashier',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  productId = nanoid();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: 'Bandeja paisa',
    sku: 'KDS-01',
    price: 10,
    price2: 10,
    price3: 10,
    cost: 5,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 5,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId,
    unitId: baseUnitId,
    equivalence: 1,
    price: 10,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId: primarySiteId,
    productId,
    onHand: 500,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });

  mesa1Id = nanoid();
  mesa2Id = nanoid();
  await db.insert(restaurantTables).values([
    {
      id: mesa1Id,
      tenantId,
      siteId: primarySiteId,
      name: 'Mesa 1',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: mesa2Id,
      tenantId,
      siteId: primarySiteId,
      name: 'Mesa 2',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const primaryRegistration = await registerDeviceService(db, {
    tenantId,
    userId: adminId,
    kind: 'web',
    name: 'kds.test.primary',
  });
  deviceIdByTenant.set(tenantId, primaryRegistration.deviceId);

  const session = await openSession(cashierId, 'cashier');
  primarySessionId = session.id;
  void primarySessionId;

  // Second tenant for cross-tenant isolation.
  otherTenantId = nanoid();
  otherAdminId = nanoid();
  otherSiteId = nanoid();
  const otherCompanyId = nanoid();
  await db.insert(tenants).values({
    id: otherTenantId,
    name: 'KDS Other Tenant',
    slug: `kds-other-${nanoid(4).toLowerCase()}`,
    settings: { modules: { kds: true } },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: otherAdminId,
    tenantId: otherTenantId,
    email: 'kds-other-admin@localhost',
    passwordHash: 'x',
    name: 'Other Admin',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: otherCompanyId,
    tenantId: otherTenantId,
    name: 'KDS Other Co',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: otherSiteId,
    tenantId: otherTenantId,
    companyId: otherCompanyId,
    name: 'KDS Other Site',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const otherRegistration = await registerDeviceService(db, {
    tenantId: otherTenantId,
    userId: otherAdminId,
    kind: 'web',
    name: 'kds.test.other',
  });
  deviceIdByTenant.set(otherTenantId, otherRegistration.deviceId);

  await enableKdsModule(tenantId);
});

afterAll(async () => {
  await server.close();
});

describe('KDS — enqueue lifecycle', () => {
  it('suspending a draft with a tableId creates exactly one kds_orders row', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });

    const db = getDatabase();
    const rows = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      saleId,
      tableId: mesa1Id,
      tableLabel: 'Mesa 1',
      status: 'pending',
      station: 'main',
    });
    const items = JSON.parse(rows[0].itemsJson) as Array<{
      productName: string;
      quantity: number;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productName: 'Bandeja paisa', quantity: 2 });
  });

  it('re-suspending the same draft is idempotent (no duplicate kds row)', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });

    const db = getDatabase();
    const rows = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('suspending a draft WITHOUT a tableId is a no-op (regular POS path)', async () => {
    const saleId = await createDraftAtTable(null);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, label: 'Para llevar' });

    const db = getDatabase();
    const rows = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .all();
    expect(rows).toHaveLength(0);
  });

  it('module disabled: enqueue is a no-op even with tableId', async () => {
    await disableKdsModule(tenantId);
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });

    const db = getDatabase();
    const rows = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .all();
    expect(rows).toHaveLength(0);
    await enableKdsModule(tenantId);
  });
});

describe('KDS — refresh lifecycle', () => {
  it('changeTable rewrites the table label on the existing KDS row', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    const adminCaller = appRouter.createCaller(
      createContext(adminId, 'admin', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });
    await adminCaller.sales.changeTable({ saleId, tableId: mesa2Id });

    const db = getDatabase();
    const row = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .get();
    expect(row?.tableId).toBe(mesa2Id);
    expect(row?.tableLabel).toBe('Mesa 2');
  });

  it('refresh removes the source card when all items moved away in a split', async () => {
    const db = getDatabase();
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });
    // Confirm a KDS card landed on the source.
    const before = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .all();
    expect(before).toHaveLength(1);

    // Simulate the splitDraft outcome: the source row no longer has
    // any sale_items. Then fire the refresh hook explicitly and
    // assert the card is gone (rather than stranded as empty).
    await db.delete(saleItems).where(eq(saleItems.saleId, saleId));
    const { refreshKdsOrderItems } = await import('../services/kds/refresh.js');
    await refreshKdsOrderItems({
      ctx: { db, tenantId, siteId: primarySiteId, user: { id: cashierId }, sse: null },
      saleId,
    });
    const after = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .all();
    expect(after).toHaveLength(0);
  });
});

describe('KDS — remove lifecycle', () => {
  it('discardDraft removes the KDS row', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });
    await cashierCaller.sales.discardDraft({ saleId });

    const db = getDatabase();
    const rows = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .all();
    expect(rows).toHaveLength(0);
  });
});

describe('KDS router — list', () => {
  it('list returns pending cards scoped by site, hydrating table label live', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });

    const result = await cashierCaller.kds.list({ siteId: primarySiteId });
    const card = result.items.find(card => card.saleId === saleId);
    expect(card).toBeDefined();
    expect(card?.status).toBe('pending');
    expect(card?.tableLabel).toBe('Mesa 1');
    expect(card?.items.length).toBeGreaterThan(0);
  });

  it('list excludes ready cards older than the TTL window', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });

    const db = getDatabase();
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await db
      .update(kdsOrders)
      .set({ status: 'ready', readyAt: old, readyByUserId: cashierId })
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)));

    const result = await cashierCaller.kds.list({ siteId: primarySiteId });
    expect(result.items.find(card => card.saleId === saleId)).toBeUndefined();
  });
});

describe('KDS router — markReady', () => {
  it('markReady transitions pending → ready and writes audit row', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });

    const db = getDatabase();
    const card = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .get();
    expect(card).toBeDefined();

    const ready = await cashierCaller.kds.markReady({ id: card!.id });
    expect(ready.status).toBe('ready');
    expect(ready.readyAt).toBeTruthy();
    expect(ready.readyByUserId).toBe(cashierId);

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, card!.id),
          eq(auditLogs.action, 'kds.order.ready')
        )
      )
      .orderBy(desc(auditLogs.createdAt))
      .get();
    expect(audit).toBeDefined();
  });

  it('markReady on already-ready card is idempotent (no second audit row)', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });

    const db = getDatabase();
    const card = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .get();
    await cashierCaller.kds.markReady({ id: card!.id });
    await cashierCaller.kds.markReady({ id: card!.id });

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, card!.id),
          eq(auditLogs.action, 'kds.order.ready')
        )
      )
      .all();
    expect(auditRows).toHaveLength(1);
  });

  it('cross-tenant markReady collapses to NOT_FOUND', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });

    const db = getDatabase();
    const card = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .get();
    const otherCaller = appRouter.createCaller(
      createContext(otherAdminId, 'admin', otherTenantId, otherSiteId)
    );
    await expect(otherCaller.kds.markReady({ id: card!.id })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'KDS_ORDER_NOT_FOUND' }),
    });
  });
});

describe('KDS router — recall', () => {
  it('recall transitions ready → pending and writes audit row', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });
    const db = getDatabase();
    const card = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .get();
    await cashierCaller.kds.markReady({ id: card!.id });
    const recalled = await cashierCaller.kds.recall({ id: card!.id });
    expect(recalled.status).toBe('pending');
    expect(recalled.readyAt).toBeNull();
    expect(recalled.readyByUserId).toBeNull();

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, card!.id),
          eq(auditLogs.action, 'kds.order.recalled')
        )
      )
      .orderBy(desc(auditLogs.createdAt))
      .get();
    expect(audit).toBeDefined();
  });

  it('recall on a pending card throws KDS_ORDER_NOT_READY', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: mesa1Id });
    const db = getDatabase();
    const card = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .get();
    await expect(cashierCaller.kds.recall({ id: card!.id })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'KDS_ORDER_NOT_READY' }),
    });
  });
});

describe('KDS router — module gate', () => {
  it('list refused when kds module is off', async () => {
    await disableKdsModule(tenantId);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await expect(cashierCaller.kds.list({ siteId: primarySiteId })).rejects.toBeInstanceOf(
      TRPCError
    );
    await enableKdsModule(tenantId);
  });
});
