import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  inventoryBalances,
  products,
  registerIncidents,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { getLatestRegisterIncidentToday } from '../services/register-incidents.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { receiptCodeToSaleNumber } from '../trpc/routers/sales/queries.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let adminId: string;
let siteId: string;
let otherSiteId: string;
const productId = nanoid();

function ctxFor(role: 'admin' | 'manager' | 'cashier', overrides: Partial<Context> = {}): Context {
  const user = { id: adminId, email: 'admin@localhost', role, tenantId };
  return {
    req: { server: server.app, headers: {}, user: { userId: adminId, ...user } } as never,
    res: {} as Context['res'],
    db: getDatabase(),
    user,
    tenantId,
    siteId,
    ...overrides,
  } as Context;
}

describe('register incidents', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    adminId = admin.id;
    const mainSite = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!mainSite) throw new Error('Expected a seeded site');
    siteId = mainSite.id;
    otherSiteId = nanoid();
    db.insert(sites)
      .values({ id: otherSiteId, tenantId, companyId: mainSite.companyId, name: 'Sede Sur' })
      .run();
    db.insert(products)
      .values({
        id: productId,
        tenantId,
        name: 'Leche UHT 1 L',
        sku: `INC-${nanoid(6)}`,
        price: 4900,
      })
      .run();
    const now = new Date().toISOString();
    db.insert(inventoryBalances)
      .values([
        { id: nanoid(), tenantId, siteId, productId, onHand: 0, reserved: 0, createdAt: now },
        {
          id: nanoid(),
          tenantId,
          siteId: otherSiteId,
          productId,
          onHand: 14,
          reserved: 0,
          createdAt: now,
        },
      ])
      .run();
    const cashSessionId = await seedCommittedSaleSession({ tenantId, cashierId: adminId, siteId });
    db.insert(sales)
      .values({
        cashSessionId,
        id: nanoid(),
        tenantId,
        saleNumber: 'V-000842',
        subtotal: 17000,
        taxAmount: 0,
        discountAmount: 0,
        total: 17000,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: adminId,
      })
      .run();
  });

  afterAll(async () => {
    await server.close();
  });

  it('lets a cashier report a stockout and shows managers where stock remains', async () => {
    const { id } = await appRouter
      .createCaller(ctxFor('cashier'))
      .registerIncidents.report({ kind: 'stockout', productId, reason: 'not_on_shelf' });

    const open = await appRouter.createCaller(ctxFor('manager')).registerIncidents.listOpen();
    const row = open.find(item => item.id === id);
    expect(row).toMatchObject({
      kind: 'stockout',
      reason: 'not_on_shelf',
      productName: 'Leche UHT 1 L',
      systemPrice: 4900,
      siteId,
    });
    expect(row?.stockBySite).toEqual(
      expect.arrayContaining([{ siteId: otherSiteId, siteName: 'Sede Sur', onHand: 14 }])
    );
  });

  it('keeps the queue for managers only', async () => {
    await expect(
      appRouter.createCaller(ctxFor('cashier')).registerIncidents.listOpen()
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires the shelf price for a price mismatch and a product for a stockout', async () => {
    const caller = appRouter.createCaller(ctxFor('cashier'));
    await expect(
      caller.registerIncidents.report({ kind: 'price_mismatch', productId })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.registerIncidents.report({ kind: 'stockout' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.registerIncidents.report({ kind: 'no_barcode', note: 'Bolsa de hielo' })
    ).resolves.toHaveProperty('id');
  });

  it('resolves an incident once and drops it from the open queue', async () => {
    const { id } = await appRouter
      .createCaller(ctxFor('cashier'))
      .registerIncidents.report({ kind: 'price_mismatch', productId, shelfPrice: 4500 });
    const manager = appRouter.createCaller(ctxFor('manager'));
    await manager.registerIncidents.resolve({ id, note: 'Etiqueta corregida' });
    expect((await manager.registerIncidents.listOpen()).some(item => item.id === id)).toBe(false);
    await expect(manager.registerIncidents.resolve({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never exposes or resolves another tenant incident', async () => {
    const { id } = await appRouter
      .createCaller(ctxFor('cashier'))
      .registerIncidents.report({ kind: 'stockout', productId });
    const foreignTenant = nanoid();
    getDatabase()
      .insert(tenants)
      .values({ id: foreignTenant, slug: nanoid(), name: 'Other' })
      .run();
    const foreign = appRouter.createCaller(
      ctxFor('manager', { tenantId: foreignTenant, siteId: null })
    );
    expect(await foreign.registerIncidents.listOpen()).toEqual([]);
    await expect(foreign.registerIncidents.resolve({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(foreign.registerIncidents.listOpen({ siteId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('shows a cashier the product stock here and at the other sites', async () => {
    const db = getDatabase();
    const { companyId } = db.select().from(sites).where(eq(sites.id, siteId)).get()!;
    const closedSiteId = nanoid();
    const emptySiteId = nanoid();
    db.insert(sites)
      .values([
        { id: closedSiteId, tenantId, companyId, name: 'Sede Cerrada', isActive: false },
        { id: emptySiteId, tenantId, companyId, name: 'Sede Vacia' },
      ])
      .run();
    db.insert(inventoryBalances)
      .values([
        { id: nanoid(), tenantId, siteId: closedSiteId, productId, onHand: 30, reserved: 0 },
        { id: nanoid(), tenantId, siteId: emptySiteId, productId, onHand: 0, reserved: 0 },
      ])
      .run();
    const stock = await appRouter
      .createCaller(ctxFor('cashier'))
      .registerIncidents.productStock({ productId });
    expect(stock).toMatchObject({ siteId, onHand: 0 });
    expect(stock.siteName).not.toBe('');
    expect(stock.otherSites).toEqual([{ siteId: otherSiteId, siteName: 'Sede Sur', onHand: 14 }]);
  });

  it('returns an open incident instead of filing it twice', async () => {
    const cashier = appRouter.createCaller(ctxFor('cashier'));
    const first = await cashier.registerIncidents.report({ kind: 'stockout', productId });
    const again = await cashier.registerIncidents.report({
      kind: 'stockout',
      productId,
      reason: 'expired',
    });
    expect(again.id).toBe(first.id);

    await appRouter.createCaller(ctxFor('manager')).registerIncidents.resolve({ id: first.id });
    const reopened = await cashier.registerIncidents.report({ kind: 'stockout', productId });
    expect(reopened.id).not.toBe(first.id);
  });

  it('matches an open no-barcode incident on its trimmed note in any case', async () => {
    const cashier = appRouter.createCaller(ctxFor('cashier'));
    const label = await cashier.registerIncidents.report({
      kind: 'no_barcode',
      note: 'Hielo 2 kg',
    });
    const padded = await cashier.registerIncidents.report({
      kind: 'no_barcode',
      note: '  hielo 2 KG ',
    });
    const other = await cashier.registerIncidents.report({
      kind: 'no_barcode',
      note: 'Hielo 5 kg',
    });
    expect(padded.id).toBe(label.id);
    expect(other.id).not.toBe(label.id);

    const blank = await cashier.registerIncidents.report({ kind: 'no_barcode' });
    const blankAgain = await cashier.registerIncidents.report({ kind: 'no_barcode' });
    expect(blankAgain.id).not.toBe(blank.id);
  });

  it('refreshes the open incident with what the cashier reports again', async () => {
    const db = getDatabase();
    const cashier = appRouter.createCaller(ctxFor('cashier'));
    const { id } = await cashier.registerIncidents.report({
      kind: 'price_mismatch',
      productId,
      shelfPrice: 4500,
    });
    await cashier.registerIncidents.report({
      kind: 'price_mismatch',
      productId,
      shelfPrice: 5200,
      note: 'Etiqueta nueva',
    });
    expect(
      db.select().from(registerIncidents).where(eq(registerIncidents.id, id)).get()
    ).toMatchObject({ shelfPrice: 5200, note: 'Etiqueta nueva', status: 'open' });
    await appRouter.createCaller(ctxFor('manager')).registerIncidents.resolve({ id });
  });

  it('files a new row when the open incident is from an earlier business day', async () => {
    const db = getDatabase();
    const cashier = appRouter.createCaller(ctxFor('cashier'));
    const { id } = await cashier.registerIncidents.report({ kind: 'stockout', productId });
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    db.update(registerIncidents)
      .set({ createdAt: twoDaysAgo })
      .where(eq(registerIncidents.id, id))
      .run();
    const today = await cashier.registerIncidents.report({ kind: 'stockout', productId });
    expect(today.id).not.toBe(id);
    expect((await cashier.registerIncidents.latestToday())?.id).toBe(today.id);
  });

  it('gives the till the newest incident of the business day with its register', async () => {
    const db = getDatabase();
    // An open match from an earlier test would be returned instead of a new row.
    db.update(registerIncidents)
      .set({ status: 'resolved' })
      .where(eq(registerIncidents.status, 'open'))
      .run();
    const sessionId = nanoid();
    db.insert(cashSessions)
      .values({
        id: sessionId,
        tenantId,
        siteId,
        cashierId: adminId,
        registerName: 'Caja 1',
        openingCountDenominations: [],
        status: 'open',
      })
      .run();
    const cashier = appRouter.createCaller(ctxFor('cashier'));
    const { id } = await cashier.registerIncidents.report({
      kind: 'price_mismatch',
      productId,
      shelfPrice: 4500,
    });
    db.update(cashSessions).set({ status: 'closed' }).where(eq(cashSessions.id, sessionId)).run();

    expect(await cashier.registerIncidents.latestToday()).toMatchObject({
      id,
      kind: 'price_mismatch',
      productName: 'Leche UHT 1 L',
      registerName: 'Caja 1',
    });
    const nextWeek = new Date(Date.now() + 7 * 86_400_000);
    expect(await getLatestRegisterIncidentToday(db, { tenantId, siteId }, nextWeek)).toBeNull();
    expect(
      await appRouter
        .createCaller(ctxFor('cashier', { siteId: otherSiteId }))
        .registerIncidents.latestToday()
    ).toBeNull();
  });

  it('keeps the till reads inside the tenant', async () => {
    const foreignTenant = nanoid();
    getDatabase()
      .insert(tenants)
      .values({ id: foreignTenant, slug: nanoid(), name: 'Other' })
      .run();
    const foreign = appRouter.createCaller(ctxFor('cashier', { tenantId: foreignTenant }));
    await expect(foreign.registerIncidents.productStock({ productId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await foreign.registerIncidents.latestToday()).toBeNull();
    await expect(
      appRouter
        .createCaller(ctxFor('cashier', { siteId: null }))
        .registerIncidents.productStock({ productId })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('finds a completed sale from its scanned receipt', async () => {
    const caller = appRouter.createCaller(ctxFor('cashier'));
    expect(await caller.sales.findByReceipt({ code: ' v-000842 ' })).toMatchObject({
      saleNumber: 'V-000842',
      total: 17000,
    });
    expect(
      await caller.sales.findByReceipt({ code: 'https://example.com/r/V-000842' })
    ).toMatchObject({ saleNumber: 'V-000842' });
    expect(await caller.sales.findByReceipt({ code: 'V-999999' })).toBeNull();
  });
});

describe('receiptCodeToSaleNumber', () => {
  it.each([
    ['V-000842', 'V-000842'],
    ['  V-1  ', 'V-1'],
    ['https://example.com/receipt/V-7', 'V-7'],
    ['https://example.com/r?sale=V-9', 'V-9'],
    ['https://example.com/r/V%2D10', 'V-10'],
  ])('reads %s as %s', (code, expected) => {
    expect(receiptCodeToSaleNumber(code)).toBe(expected);
  });
});
