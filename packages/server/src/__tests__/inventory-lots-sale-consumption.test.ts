/**
 * Lot consumption on the sale path + restoration on reversal
 * (Auditoría 2026-07 — lots & costing, Tier C.2).
 *
 * Drives the real use-cases (completeSale / returnSale / voidSale) so the
 * FEFO consumption, sale_item_lots provenance, and reversal-restore all run
 * inside the actual sale transactions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  inventoryLots,
  products,
  saleItemLots,
  saleItems,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { completeSale } from '../application/sales/completeSale.js';
import { returnSale } from '../application/sales/returnSale.js';
import { voidSale } from '../application/sales/voidSale.js';
import { receiveInventoryLot } from '../services/inventory-lots/index.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;

function buildContext(overrides: Partial<CompleteSaleContext> = {}): CompleteSaleContext {
  return {
    db: getDatabase(),
    tenantId,
    siteId,
    user: { id: userId, role: 'admin' },
    envelope: null,
    deviceId: null,
    log: undefined,
    ...overrides,
  };
}

async function seedLotProduct(args: { name: string; sku: string; stock: number }) {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: args.name,
    sku: args.sku,
    price: 100,
    price2: 100,
    price3: 100,
    cost: 40,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 40,
    stock: args.stock,
    minStock: 0,
    tracksLots: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId,
    unitId: baseUnitId,
    equivalence: 1,
    price: 100,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

const isoInDays = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;
  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;
  const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
  baseUnitId = seededUnits.find(u => u.abbreviation === 'UND')!.id;

  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'inventory-lots-sale-consumption.test',
  });
  const fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: 'admin@localhost',
    siteId,
    deviceId: reg.deviceId,
    defaultRole: 'admin',
  });
  const caller = appRouter.createCaller(fresh());
  await caller.cashSessions.open({
    registerName: 'lots-consumption register',
    openingFloat: 500,
    denominations: [{ value: 100, count: 5 }],
  });
});

afterAll(async () => {
  await server.close();
});

async function lotOnHand(lotId: string): Promise<number> {
  const row = await getDatabase()
    .select({ onHand: inventoryLots.onHand })
    .from(inventoryLots)
    .where(eq(inventoryLots.id, lotId))
    .get();
  return row?.onHand ?? -1;
}

describe('lot consumption on the sale path', () => {
  it('draws FEFO across lots, records sale_item_lots provenance, and depletes the drained lot', async () => {
    const db = getDatabase();
    const productId = await seedLotProduct({ name: 'Leche FEFO', sku: 'LOT-FEFO', stock: 10 });

    // Two lots: soonest expiry cheaper, later expiry pricier.
    const soon = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-SOON',
      expiresAt: isoInDays(5),
      quantity: 6,
      unitCost: 40,
      now: new Date().toISOString(),
    });
    const later = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-LATER',
      expiresAt: isoInDays(60),
      quantity: 4,
      unitCost: 45,
      now: new Date().toISOString(),
    });

    // Sell 8 units → 6 from L-SOON (depletes it), 2 from L-LATER.
    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId: baseUnitId, quantity: 8, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 800,
      discountAmount: 0,
    });
    const saleId = (result.sale as { id: string }).id;

    expect(await lotOnHand(soon.lotId)).toBe(0);
    expect(await lotOnHand(later.lotId)).toBe(2);

    // Soonest lot is now depleted.
    const soonRow = await db
      .select({ status: inventoryLots.status })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, soon.lotId))
      .get();
    expect(soonRow!.status).toBe('depleted');

    // Provenance: two rows, base-unit quantities and per-lot COGS.
    const saleLine = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .get();
    const provenance = await db
      .select()
      .from(saleItemLots)
      .where(eq(saleItemLots.saleItemId, saleLine!.id))
      .all();
    expect(provenance).toHaveLength(2);
    const byLot = Object.fromEntries(provenance.map(p => [p.lotId, p]));
    expect(byLot[soon.lotId]!.quantity).toBe(6);
    expect(byLot[soon.lotId]!.unitCost).toBe(40);
    expect(byLot[later.lotId]!.quantity).toBe(2);
    expect(byLot[later.lotId]!.unitCost).toBe(45);
  });

  it('restores the exact lots on refund and clears the provenance', async () => {
    const db = getDatabase();
    const productId = await seedLotProduct({ name: 'Yogurt refund', sku: 'LOT-REF', stock: 5 });
    const lot = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-REF',
      expiresAt: isoInDays(10),
      quantity: 5,
      unitCost: 30,
      now: new Date().toISOString(),
    });

    const sale = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId: baseUnitId, quantity: 3, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 300,
      discountAmount: 0,
    });
    const saleId = (sale.sale as { id: string }).id;
    expect(await lotOnHand(lot.lotId)).toBe(2);

    await returnSale(buildContext(), { id: saleId, reason: 'customer changed mind' });

    // Lot fully restored, provenance cleared.
    expect(await lotOnHand(lot.lotId)).toBe(5);
    const restoredStatus = await db
      .select({ status: inventoryLots.status })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, lot.lotId))
      .get();
    expect(restoredStatus!.status).toBe('active');
    const remaining = await db
      .select()
      .from(saleItemLots)
      .where(eq(saleItemLots.lotId, lot.lotId))
      .all();
    expect(remaining).toHaveLength(0);
  });

  it('restores a depleted lot back to active on void', async () => {
    const db = getDatabase();
    const productId = await seedLotProduct({ name: 'Queso void', sku: 'LOT-VOID', stock: 4 });
    const lot = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-VOID',
      expiresAt: isoInDays(15),
      quantity: 4,
      unitCost: 50,
      now: new Date().toISOString(),
    });

    const sale = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId: baseUnitId, quantity: 4, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 400,
      discountAmount: 0,
    });
    const saleId = (sale.sale as { id: string }).id;
    expect(await lotOnHand(lot.lotId)).toBe(0);

    await voidSale(buildContext(), { id: saleId, reason: 'register error' });
    expect(await lotOnHand(lot.lotId)).toBe(4);
    const status = await db
      .select({ status: inventoryLots.status })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, lot.lotId))
      .get();
    expect(status!.status).toBe('active');
  });

  it('leaves non-lot products completely untouched (no provenance rows)', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const now = new Date().toISOString();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Non-lot product',
      sku: 'NO-LOT',
      price: 100,
      price2: 100,
      price3: 100,
      cost: 40,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 40,
      stock: 10,
      minStock: 0,
      tracksLots: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 100,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const sale = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId: baseUnitId, quantity: 2, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 200,
      discountAmount: 0,
    });
    const saleId = (sale.sale as { id: string }).id;
    const line = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .get();
    const provenance = await db
      .select()
      .from(saleItemLots)
      .where(eq(saleItemLots.saleItemId, line!.id))
      .all();
    expect(provenance).toHaveLength(0);
  });
});
