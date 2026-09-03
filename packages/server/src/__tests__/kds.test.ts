/**
 * Durable kitchen integration: frozen dispatches, routing, per-line and header
 * CAS, split/relocation/void lifecycle, bounded legacy adoption, malformed
 * evidence isolation, tenant/site guards and atomic event/outbox rollback.
 */

import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, sql } from 'drizzle-orm';
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
  kdsOrderLines,
  kdsOrderEvents,
  kdsOutbox,
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
import { transitionKdsOrder } from '../application/kds/transitionOrder.js';
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
  const next = { ...settings, modules: { ...modules, 'dine-in': true, kds: true } };
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

async function createDraftAtTable(tableId: string | null, lineCount = 1): Promise<string> {
  const caller = appRouter.createCaller(
    createContext(cashierId, 'cashier', tenantId, primarySiteId)
  );
  const created = await caller.sales.create({
    items: Array.from({ length: lineCount }, () => ({
      productId,
      unitId: baseUnitId,
      quantity: 2,
      unitPrice: 10,
      discount: 0,
      taxRate: 0,
    })),
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    amountReceived: 0,
    discountAmount: 0,
    status: 'draft',
    ...(tableId ? { tableId } : {}),
  });
  return created.id;
}

async function createRestaurantTable(name: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await getDatabase().insert(restaurantTables).values({
    id,
    tenantId,
    siteId: primarySiteId,
    name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
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
  await db.insert(restaurantTables).values({
    id: mesa1Id,
    tenantId,
    siteId: primarySiteId,
    name: 'Mesa 1',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

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

  it('suspending a tableless order dispatches preparation when KDS is enabled)', async () => {
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
    expect(rows).toHaveLength(1);
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
  it('changeTable updates the destination without rewriting the submitted ticket', async () => {
    const sourceTableId = await createRestaurantTable(`Mesa KDS A ${nanoid(4)}`);
    const targetTableName = `Mesa KDS B ${nanoid(4)}`;
    const targetTableId = await createRestaurantTable(targetTableName);
    const saleId = await createDraftAtTable(sourceTableId);
    const cashierCaller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    const adminCaller = appRouter.createCaller(
      createContext(adminId, 'admin', tenantId, primarySiteId)
    );
    await cashierCaller.sales.suspend({ saleId, tableId: sourceTableId });
    await adminCaller.sales.changeTable({ saleId, tableId: targetTableId });

    const db = getDatabase();
    const row = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .get();
    expect(row?.tableId).toBe(sourceTableId);
    const lines = db.select().from(kdsOrderLines).where(eq(kdsOrderLines.orderId, row!.id)).all();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      currentTableId: targetTableId,
      currentTableLabel: targetTableName,
    });
    expect(
      db
        .select()
        .from(kdsOrderEvents)
        .where(and(eq(kdsOrderEvents.orderId, row!.id), eq(kdsOrderEvents.kind, 'relocated')))
        .all()
    ).toHaveLength(1);
  });

  it('a real split relocates preparation without deleting or re-sending it', async () => {
    const db = getDatabase();
    const saleId = await createDraftAtTable(mesa1Id, 2);
    const caller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await caller.sales.suspend({ saleId, tableId: mesa1Id });
    const before = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, saleId)).get()!;
    const beforeLine = db
      .select()
      .from(kdsOrderLines)
      .where(eq(kdsOrderLines.orderId, before.id))
      .get()!;
    const manager = appRouter.createCaller(
      createContext(adminId, 'admin', tenantId, primarySiteId)
    );
    const split = await manager.sales.splitDraft({
      sourceSaleId: saleId,
      saleItemIds: [beforeLine.sourceSaleItemId],
      tableId: mesa1Id,
    });
    const after = db.select().from(kdsOrders).where(eq(kdsOrders.id, before.id)).get()!;
    expect(after.itemsJson).toBe(before.itemsJson);
    expect(after.saleId).toBe(saleId);
    expect(
      db.select().from(kdsOrders).where(eq(kdsOrders.saleId, split.created.id)).all()
    ).toHaveLength(0);
    expect(
      db.select().from(kdsOrderLines).where(eq(kdsOrderLines.id, beforeLine.id)).get()
    ).toMatchObject({
      currentSaleId: split.created.id,
      sourceSaleItemId: beforeLine.sourceSaleItemId,
      status: 'pending',
    });
    expect(
      db
        .select()
        .from(kdsOrderEvents)
        .where(and(eq(kdsOrderEvents.orderId, before.id), eq(kdsOrderEvents.kind, 'submitted')))
        .all()
    ).toHaveLength(1);
    await caller.sales.discardDraft({ saleId });
    expect(
      db.select().from(kdsOrderLines).where(eq(kdsOrderLines.id, beforeLine.id)).get()?.status
    ).toBe('pending');
    await manager.sales.discardDraft({ saleId: split.created.id });
    expect(
      db.select().from(kdsOrderLines).where(eq(kdsOrderLines.id, beforeLine.id)).get()?.status
    ).toBe('voided');
    expect(db.select().from(kdsOrders).where(eq(kdsOrders.id, before.id)).get()).toMatchObject({
      status: 'cancelled',
      itemsJson: before.itemsJson,
    });
  });
});

describe('KDS — remove lifecycle', () => {
  it('discardDraft retains immutable cancelled kitchen history', async () => {
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
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('cancelled');
    expect(
      db.select().from(kdsOrderLines).where(eq(kdsOrderLines.orderId, rows[0]!.id)).get()?.status
    ).toBe('voided');
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

  it('keeps pending work ahead of ready history when the board reaches its limit', async () => {
    const caller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    const saleId = await createDraftAtTable(mesa1Id);
    await caller.sales.suspend({ saleId, tableId: mesa1Id });
    const db = getDatabase();
    const card = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, saleId)).get()!;
    await caller.kds.markReady({ id: card.id, expectedVersion: card.version });

    const pendingSaleId = await createDraftAtTable(mesa1Id);
    await caller.sales.suspend({ saleId: pendingSaleId, tableId: mesa1Id });
    // Own both states so this regression also works when run in isolation.
    const pending = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, pendingSaleId)).get()!;
    const fullBoard = await caller.kds.list({ siteId: primarySiteId });
    expect(fullBoard.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pending.id, status: 'pending' }),
        expect.objectContaining({ id: card.id, status: 'ready' }),
      ])
    );
    const result = await caller.kds.list({ siteId: primarySiteId, limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.status).toBe('pending');
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

    const ready = await cashierCaller.kds.markReady({
      id: card!.id,
      expectedVersion: card!.version,
    });
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
    const ready = await cashierCaller.kds.markReady({
      id: card!.id,
      expectedVersion: card!.version,
    });
    await cashierCaller.kds.markReady({ id: card!.id, expectedVersion: ready.version });

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
    await expect(
      otherCaller.kds.markReady({ id: card!.id, expectedVersion: card!.version })
    ).rejects.toMatchObject({
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
    const ready = await cashierCaller.kds.markReady({
      id: card!.id,
      expectedVersion: card!.version,
    });
    const recalled = await cashierCaller.kds.recall({
      id: card!.id,
      expectedVersion: ready.version,
    });
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
    await expect(
      cashierCaller.kds.recall({ id: card!.id, expectedVersion: card!.version })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'KDS_ORDER_NOT_READY' }),
    });
  });
});

describe('KDS router — concurrent transitions', () => {
  it('two cooks marking the same card ready produce one committed transition', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const cashier = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    const admin = appRouter.createCaller(createContext(adminId, 'admin', tenantId, primarySiteId));
    await cashier.sales.suspend({ saleId, tableId: mesa1Id });
    const db = getDatabase();
    const card = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, saleId)).get()!;

    const results = await Promise.allSettled([
      cashier.kds.markReady({ id: card.id, expectedVersion: card.version }),
      admin.kds.markReady({ id: card.id, expectedVersion: card.version }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { cause: { errorCode: 'STALE_VERSION' } },
    });
    const winner = results.find(result => result.status === 'fulfilled')!;
    const persisted = db.select().from(kdsOrders).where(eq(kdsOrders.id, card.id)).get()!;
    expect(persisted.readyByUserId).toBe(winner.value.readyByUserId);
    const audits = db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, card.id), eq(auditLogs.action, 'kds.order.ready')))
      .all();
    expect(audits).toHaveLength(1);
  });

  it('concurrent recalls cannot both report success or emit duplicate audit entries', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const caller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await caller.sales.suspend({ saleId, tableId: mesa1Id });
    const db = getDatabase();
    const card = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, saleId)).get()!;
    const ready = await caller.kds.markReady({ id: card.id, expectedVersion: card.version });

    const results = await Promise.allSettled([
      caller.kds.recall({ id: card.id, expectedVersion: ready.version }),
      caller.kds.recall({ id: card.id, expectedVersion: ready.version }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { cause: expect.objectContaining({ errorCode: 'STALE_VERSION' }) },
    });
    const audits = db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, card.id), eq(auditLogs.action, 'kds.order.recalled')))
      .all();
    expect(audits).toHaveLength(1);
    expect(db.select().from(kdsOrders).where(eq(kdsOrders.id, card.id)).get()).toMatchObject({
      status: 'pending',
      readyAt: null,
      readyByUserId: null,
    });
  });

  it('rolls back a ready transition if its audit cannot commit', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const caller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await caller.sales.suspend({ saleId, tableId: mesa1Id });
    const db = getDatabase();
    const card = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, saleId)).get()!;
    db.run(
      sql.raw(`CREATE TEMP TRIGGER fail_kds_transition_audit
      BEFORE INSERT ON audit_logs WHEN NEW.action = 'kds.order.ready'
      BEGIN SELECT RAISE(ABORT, 'forced KDS audit failure'); END`)
    );
    try {
      await expect(
        caller.kds.markReady({ id: card.id, expectedVersion: card.version })
      ).rejects.toThrow();
    } finally {
      db.run(sql.raw('DROP TRIGGER fail_kds_transition_audit'));
    }
    expect(db.select().from(kdsOrders).where(eq(kdsOrders.id, card.id)).get()).toEqual(card);
    expect(
      db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, card.id), eq(auditLogs.action, 'kds.order.ready')))
        .all()
    ).toHaveLength(0);
    await expect(
      caller.kds.markReady({ id: card.id, expectedVersion: card.version })
    ).resolves.toMatchObject({ status: 'ready' });
  });

  it('cannot transition a card while operating in another site of the same tenant', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const db = getDatabase();
    const primary = db.select().from(sites).where(eq(sites.id, primarySiteId)).get()!;
    const secondarySiteId = nanoid();
    db.insert(sites)
      .values({
        id: secondarySiteId,
        tenantId,
        companyId: primary.companyId,
        name: 'Secondary kitchen',
        isActive: true,
      })
      .run();
    const caller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await caller.sales.suspend({ saleId, tableId: mesa1Id });
    const card = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, saleId)).get()!;
    const secondary = appRouter.createCaller(
      createContext(adminId, 'admin', tenantId, secondarySiteId)
    );
    await expect(
      secondary.kds.markReady({ id: card.id, expectedVersion: card.version })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'KDS_ORDER_NOT_FOUND' }),
    });
    expect(db.select().from(kdsOrders).where(eq(kdsOrders.id, card.id)).get()).toEqual(card);
  });

  it('fails closed without an active site and rechecks site deactivation under the writer', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const db = getDatabase();
    const card = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, saleId)).get()!;
    const context = { db, tenantId, actorId: cashierId, siteId: primarySiteId };
    expect(() =>
      transitionKdsOrder({ ...context, siteId: null }, card.id, 'ready', card.version)
    ).toThrow();
    db.update(sites).set({ isActive: false }).where(eq(sites.id, primarySiteId)).run();
    try {
      expect(() => transitionKdsOrder(context, card.id, 'ready', card.version)).toThrow();
    } finally {
      db.update(sites).set({ isActive: true }).where(eq(sites.id, primarySiteId)).run();
    }
    expect(db.select().from(kdsOrders).where(eq(kdsOrders.id, card.id)).get()).toEqual(card);
    expect(db.select().from(auditLogs).where(eq(auditLogs.resourceId, card.id)).all()).toHaveLength(
      0
    );
  });

  it('rejects an explicit foreign site rather than treating it as an empty kitchen', async () => {
    const caller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    await expect(caller.kds.list({ siteId: otherSiteId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
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

describe('KDS durable submissions and generation guards', () => {
  const kitchenContext = () => ({
    db: getDatabase(),
    tenantId,
    actorId: cashierId,
    siteId: primarySiteId,
  });
  const cashier = () =>
    appRouter.createCaller(createContext(cashierId, 'cashier', tenantId, primarySiteId));
  const cardFor = (saleId: string) =>
    getDatabase().select().from(kdsOrders).where(eq(kdsOrders.saleId, saleId)).get()!;
  const linesFor = (orderId: string) =>
    getDatabase().select().from(kdsOrderLines).where(eq(kdsOrderLines.orderId, orderId)).all();

  it('a failure to persist the notification rolls back the sale, stock and kitchen submission', async () => {
    const db = getDatabase();
    const { sales, inventoryMovements, cashMovements } = await import('../db/schema.js');
    const snapshot = () => ({
      sales: db.select().from(sales).all(),
      balances: db.select().from(inventoryBalances).all(),
      movements: db.select().from(inventoryMovements).all(),
      cash: db.select().from(cashMovements).all(),
      orders: db.select().from(kdsOrders).all(),
      lines: db.select().from(kdsOrderLines).all(),
      events: db.select().from(kdsOrderEvents).all(),
      outbox: db.select().from(kdsOutbox).all(),
    });
    const before = snapshot();
    db.run(
      sql`CREATE TRIGGER fail_kds_notification BEFORE INSERT ON kds_outbox BEGIN SELECT RAISE(ABORT, 'forced kitchen notification failure'); END`
    );
    try {
      await expect(createDraftAtTable(mesa1Id)).rejects.toThrow();
      expect(snapshot()).toEqual(before);
    } finally {
      db.run(sql`DROP TRIGGER fail_kds_notification`);
    }
  });

  it('resume and re-suspend onto another table moves the destination but not the original snapshot', async () => {
    const sourceTable = await createRestaurantTable(`KDS Resume A ${nanoid(4)}`);
    const destinationTable = await createRestaurantTable(`KDS Resume B ${nanoid(4)}`);
    const saleId = await createDraftAtTable(sourceTable);
    const caller = cashier();
    await caller.sales.suspend({ saleId, tableId: sourceTable });
    const before = cardFor(saleId);
    const line = linesFor(before.id)[0]!;
    await caller.sales.resume({ saleId });
    await caller.sales.suspend({ saleId, tableId: destinationTable });
    expect(cardFor(saleId).itemsJson).toBe(before.itemsJson);
    expect(linesFor(before.id)[0]).toMatchObject({
      id: line.id,
      currentTableId: destinationTable,
      version: line.version + 1,
    });
    expect(
      getDatabase()
        .select()
        .from(kdsOrderEvents)
        .where(and(eq(kdsOrderEvents.orderId, before.id), eq(kdsOrderEvents.kind, 'relocated')))
        .all()
    ).toHaveLength(1);
  });

  it('rejects a delayed whole-ticket action after ready then recall, without changing any event', async () => {
    const saleId = await createDraftAtTable(mesa1Id);
    const caller = cashier();
    const card = cardFor(saleId);
    const ready = await caller.kds.markReady({ id: card.id, expectedVersion: card.version });
    const recalled = await caller.kds.recall({ id: card.id, expectedVersion: ready.version });
    const events = getDatabase()
      .select()
      .from(kdsOrderEvents)
      .where(eq(kdsOrderEvents.orderId, card.id))
      .all();
    await expect(
      caller.kds.markReady({ id: card.id, expectedVersion: card.version })
    ).rejects.toMatchObject({ cause: { errorCode: 'STALE_VERSION' } });
    expect(cardFor(saleId).version).toBe(recalled.version);
    expect(
      getDatabase().select().from(kdsOrderEvents).where(eq(kdsOrderEvents.orderId, card.id)).all()
    ).toEqual(events);
  });

  it('advances line states with CAS, never allowing a stale ready action or a void recall', async () => {
    const { transitionKdsLine } = await import('../application/kds/transitionOrder.js');
    const saleId = await createDraftAtTable(mesa1Id);
    const card = cardFor(saleId);
    const line = linesFor(card.id)[0]!;
    const context = kitchenContext();
    transitionKdsLine(context, {
      orderId: card.id,
      lineId: line.id,
      expectedVersion: line.version,
      status: 'preparing',
    });
    expect(linesFor(card.id)[0]?.status).toBe('preparing');
    expect(() =>
      transitionKdsLine(context, {
        orderId: card.id,
        lineId: line.id,
        expectedVersion: line.version,
        status: 'ready',
      })
    ).toThrow();
    const preparing = linesFor(card.id)[0]!;
    transitionKdsLine(context, {
      orderId: card.id,
      lineId: line.id,
      expectedVersion: preparing.version,
      status: 'ready',
    });
    expect(cardFor(saleId).status).toBe('ready');
    await cashier().sales.discardDraft({ saleId });
    const voided = linesFor(card.id)[0]!;
    expect(voided.status).toBe('voided');
    expect(() =>
      transitionKdsLine(context, {
        orderId: card.id,
        lineId: line.id,
        expectedVersion: voided.version,
        status: 'pending',
      })
    ).toThrow();
    expect(cardFor(saleId).status).toBe('cancelled');
  });

  it('resends only the same durable ticket identity, with no additional preparation', async () => {
    const { resendKdsOrder } = await import('../application/kds/transitionOrder.js');
    const saleId = await createDraftAtTable(mesa1Id);
    const before = cardFor(saleId);
    const lines = linesFor(before.id);
    resendKdsOrder(kitchenContext(), before.id, before.version);
    expect(cardFor(saleId)).toMatchObject({
      id: before.id,
      itemsJson: before.itemsJson,
      version: before.version + 1,
    });
    expect(linesFor(before.id)).toEqual(lines);
    const event = getDatabase()
      .select()
      .from(kdsOrderEvents)
      .where(and(eq(kdsOrderEvents.orderId, before.id), eq(kdsOrderEvents.kind, 'resent')))
      .get()!;
    expect(
      getDatabase().select().from(kdsOutbox).where(eq(kdsOutbox.eventId, event.id)).get()?.payload
    ).toEqual({ eventId: event.id, orderId: before.id, siteId: primarySiteId });
  });

  it('preserves an excluded route across later re-suspension instead of unexpectedly cooking it', async () => {
    const { kdsRoutingRules, kdsLineDispatches } = await import('../db/schema.js');
    const db = getDatabase();
    const ruleId = nanoid();
    db.insert(kdsRoutingRules)
      .values({
        id: ruleId,
        tenantId,
        siteId: primarySiteId,
        targetKind: 'product',
        targetId: productId,
        route: 'exclude',
      })
      .run();
    let saleId: string;
    try {
      saleId = await createDraftAtTable(mesa1Id);
      expect(cardFor(saleId)).toBeUndefined();
      const source = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).get()!;
      expect(
        db
          .select()
          .from(kdsLineDispatches)
          .where(eq(kdsLineDispatches.sourceSaleItemId, source.id))
          .get()?.route
      ).toBe('exclude');
    } finally {
      db.delete(kdsRoutingRules).where(eq(kdsRoutingRules.id, ruleId)).run();
    }
    await cashier().sales.suspend({ saleId: saleId!, tableId: mesa1Id });
    expect(cardFor(saleId!)).toBeUndefined();
  });

  it('adopts a legacy ticket without emitting a new submission and preserves its original bytes', async () => {
    const { adoptLegacyKitchenOrder } = await import('../application/kds/legacy.js');
    const db = getDatabase();
    const saleId = await createDraftAtTable(null);
    const source = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).get()!;
    const blob = JSON.stringify([
      { saleItemId: source.id, productId, productName: 'Original name', quantity: 2 },
    ]);
    const legacy = db
      .insert(kdsOrders)
      .values({
        id: nanoid(),
        tenantId,
        siteId: primarySiteId,
        saleId,
        saleNumber: 'Legacy kitchen evidence',
        itemsJson: blob,
        status: 'ready',
        readyAt: '2026-01-01T00:00:00.000Z',
        readyByUserId: cashierId,
      })
      .returning()
      .get();
    db.transaction(tx => adoptLegacyKitchenOrder(tx as unknown as typeof db, legacy), {
      behavior: 'immediate',
    });
    expect(cardFor(saleId)).toMatchObject({ itemsJson: blob, snapshotVersion: 2, status: 'ready' });
    expect(linesFor(legacy.id)[0]).toMatchObject({
      productName: 'Original name',
      quantity: 2,
      status: 'ready',
      readyAt: legacy.readyAt,
    });
    const events = db
      .select()
      .from(kdsOrderEvents)
      .where(eq(kdsOrderEvents.orderId, legacy.id))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('adopted');
    expect(
      db.select().from(kdsOutbox).where(eq(kdsOutbox.eventId, events[0]!.id)).all()
    ).toHaveLength(0);
  });

  it('rejects malformed legacy adoption atomically without silently dropping a line', async () => {
    const { adoptLegacyKitchenOrder } = await import('../application/kds/legacy.js');
    const db = getDatabase();
    const saleId = await createDraftAtTable(null);
    const blob = JSON.stringify([
      { saleItemId: 'valid', productId, productName: 'Original', quantity: 1 },
      { saleItemId: 'invalid', productId, productName: 'Missing quantity' },
    ]);
    const legacy = db
      .insert(kdsOrders)
      .values({
        id: nanoid(),
        tenantId,
        siteId: primarySiteId,
        saleId,
        saleNumber: 'Malformed evidence',
        itemsJson: blob,
      })
      .returning()
      .get();
    expect(() =>
      db.transaction(tx => adoptLegacyKitchenOrder(tx as unknown as typeof db, legacy), {
        behavior: 'immediate',
      })
    ).toThrow();
    expect(cardFor(saleId)).toMatchObject({ snapshotVersion: 1, itemsJson: blob });
    expect(linesFor(legacy.id)).toHaveLength(0);
    expect(
      db.select().from(kdsOrderEvents).where(eq(kdsOrderEvents.orderId, legacy.id)).all()
    ).toHaveLength(0);
  });
});

describe('KDS coherent read projections', () => {
  it('reads adopted legacy snapshots without requiring fields that never existed', async () => {
    const { adoptLegacyKitchenOrder } = await import('../application/kds/legacy.js');
    const db = getDatabase();
    const saleId = await createDraftAtTable(null);
    const source = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).get()!;
    const legacy = db
      .insert(kdsOrders)
      .values({
        id: nanoid(),
        tenantId,
        siteId: primarySiteId,
        saleId,
        saleNumber: 'Legacy live',
        itemsJson: JSON.stringify([
          { saleItemId: source.id, productId, productName: 'Frozen legacy name', quantity: 2 },
        ]),
      })
      .returning()
      .get();
    db.transaction(tx => adoptLegacyKitchenOrder(tx as unknown as typeof db, legacy), {
      behavior: 'immediate',
    });
    const caller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    const projected = (await caller.kds.list({})).items.find(row => row.id === legacy.id)!;
    expect(projected.integrity).toBe('valid');
    expect(projected.items).toHaveLength(1);
    expect(projected.items[0]).toMatchObject({
      productName: 'Frozen legacy name',
      quantity: 2,
      roundId: null,
      modifiers: [],
      status: 'pending',
      version: 1,
    });
  });

  it('isolates a malformed line snapshot instead of blocking valid tickets on the board', async () => {
    const firstSaleId = await createDraftAtTable(mesa1Id);
    const nextSaleId = await createDraftAtTable(mesa1Id);
    const db = getDatabase();
    const first = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, firstSaleId)).get()!;
    const next = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, nextSaleId)).get()!;
    db.run(sql`UPDATE kds_order_lines SET modifiers = ${'{'} WHERE order_id = ${first.id}`);
    const caller = appRouter.createCaller(
      createContext(cashierId, 'cashier', tenantId, primarySiteId)
    );
    const result = await caller.kds.list({});
    await expect(
      caller.kds.markReady({ id: first.id, expectedVersion: first.version })
    ).rejects.toMatchObject({ cause: { errorCode: 'KDS_SNAPSHOT_INVALID' } });
    expect(result.items.find(row => row.id === first.id)).toMatchObject({
      integrity: 'invalid',
      items: [],
    });
    expect(result.items.find(row => row.id === next.id)).toMatchObject({
      integrity: 'valid',
      items: [expect.objectContaining({ productName: 'Bandeja paisa', quantity: 2 })],
    });
  });

  it('returns current destinations and observed line versions through tRPC without financial data', async () => {
    const from = await createRestaurantTable(`Kitchen origin ${nanoid(4)}`);
    const to = await createRestaurantTable(`Kitchen destination ${nanoid(4)}`);
    const saleId = await createDraftAtTable(from);
    const caller = appRouter.createCaller(createContext(adminId, 'admin', tenantId, primarySiteId));
    await caller.sales.suspend({ saleId, tableId: from });
    await caller.sales.changeTable({ saleId, tableId: to });
    const card = (await caller.kds.list({})).items.find(row => row.saleId === saleId)!;
    expect(card).toMatchObject({ integrity: 'valid', tableId: to, multipleDestinations: false });
    const line = card.items[0]!;
    expect(line.currentTableId).toBe(to);
    const updated = await caller.kds.transitionLine({
      orderId: card.id,
      lineId: line.id!,
      expectedVersion: line.version!,
      status: 'preparing',
    });
    expect(updated.items[0]).toMatchObject({ status: 'preparing', version: line.version! + 1 });
    expect(updated.items[0]).not.toHaveProperty('unitPrice');
    expect(updated).not.toHaveProperty('customerId');
    expect(updated).not.toHaveProperty('total');
  });
});

describe('KDS per-ticket isolation bounds', () => {
  it('does not let oversized corrupt work consume the read quota of a valid ticket', async () => {
    const oversizedSaleId = await createDraftAtTable(mesa1Id);
    const validSaleId = await createDraftAtTable(mesa1Id);
    const db = getDatabase();
    const oversized = db
      .select()
      .from(kdsOrders)
      .where(eq(kdsOrders.saleId, oversizedSaleId))
      .get()!;
    const valid = db.select().from(kdsOrders).where(eq(kdsOrders.saleId, validSaleId)).get()!;
    const line = db
      .select()
      .from(kdsOrderLines)
      .where(eq(kdsOrderLines.orderId, oversized.id))
      .get()!;
    // More than the entire board's global allowance used by the old batch query.
    db.transaction(tx => {
      for (let index = 0; index < 401; index++) {
        tx.insert(kdsOrderLines)
          .values({
            ...line,
            id: nanoid(),
            sourceSaleItemId: nanoid(),
            createdAt: '2000-01-01T00:00:00.000Z',
          })
          .run();
      }
    });
    const { projectKitchenOrders } = await import('../application/kds/read.js');
    const projected = db.transaction(tx =>
      projectKitchenOrders(tx as unknown as typeof db, tenantId, primarySiteId, [oversized, valid])
    );
    expect(projected[0]).toMatchObject({ integrity: 'invalid', items: [] });
    expect(projected[1]).toMatchObject({
      integrity: 'valid',
      items: [expect.objectContaining({ productName: 'Bandeja paisa', quantity: 2 })],
    });
  });
});
