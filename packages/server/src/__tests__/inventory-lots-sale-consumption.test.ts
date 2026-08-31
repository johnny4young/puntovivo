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
  inventoryBalances,
  inventoryLots,
  products,
  saleItemLots,
  saleItems,
  sites,
  syncOutbox,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { completeSale } from '../application/sales/completeSale.js';
import { returnSale } from '../application/sales/returnSale.js';
import { voidSale } from '../application/sales/voidSale.js';
import { receiveInventoryLot } from '../services/inventory-lots/index.js';
import { isLotExpiredAt } from '../services/inventory-lots/consume-for-sale.js';
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
  // Stock lives in inventory_balances now (products.stock removed). Seed the
  // opening on_hand at the active site so the sale's stock check passes.
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId,
    onHand: args.stock,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

const isoInDays = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

it('treats impossible calendar dates and invalid clocks as non-sellable', () => {
  expect(isLotExpiredAt('2026-02-30', '2026-02-15T12:00:00.000Z')).toBe(true);
  expect(isLotExpiredAt('2026-02-28', 'invalid-reference-clock')).toBe(true);
});

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

  it('skips expired lots and rolls the sale back when valid lots cannot cover it', async () => {
    const db = getDatabase();
    const productId = await seedLotProduct({
      name: 'Medicine expiry guard',
      sku: 'LOT-EXPIRED-GUARD',
      stock: 5,
    });
    const expired = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-EXPIRED',
      expiresAt: isoInDays(-1),
      quantity: 3,
      unitCost: 30,
      now: new Date().toISOString(),
    });
    const valid = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-VALID',
      expiresAt: isoInDays(30),
      quantity: 2,
      unitCost: 40,
      now: new Date().toISOString(),
    });

    await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId: baseUnitId, quantity: 2, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 200,
      discountAmount: 0,
    });

    expect(await lotOnHand(expired.lotId)).toBe(3);
    expect(await lotOnHand(valid.lotId)).toBe(0);

    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId: null,
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 100,
        discountAmount: 0,
      })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'LOT_STOCK_INCONSISTENT',
        details: { productId, requested: 1, available: 0, shortfall: 1 },
      },
    });

    const balance = await db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, productId)
        )
      )
      .get();
    expect(balance?.onHand).toBe(3);
    expect(await lotOnHand(expired.lotId)).toBe(3);
  });

  it('fails closed when a persisted lot has a malformed expiry', async () => {
    const db = getDatabase();
    const productId = await seedLotProduct({
      name: 'Medicine malformed expiry',
      sku: 'LOT-MALFORMED-EXPIRY',
      stock: 1,
    });
    const lot = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-MALFORMED-EXPIRY',
      expiresAt: isoInDays(30),
      quantity: 1,
      unitCost: 30,
      now: new Date().toISOString(),
    });
    await db
      .update(inventoryLots)
      .set({ expiresAt: 'invalid-historical-value' })
      .where(and(eq(inventoryLots.id, lot.lotId), eq(inventoryLots.tenantId, tenantId)));

    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId: null,
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 100,
        discountAmount: 0,
      })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'LOT_STOCK_INCONSISTENT',
        details: { productId, requested: 1, available: 0, shortfall: 1 },
      },
    });

    expect(await lotOnHand(lot.lotId)).toBe(1);
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

  it('restores quantity without releasing a quarantined lot', async () => {
    const db = getDatabase();
    const productId = await seedLotProduct({
      name: 'Medicine quarantine return',
      sku: 'LOT-QUARANTINE-RETURN',
      stock: 3,
    });
    const lot = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-QUARANTINED',
      expiresAt: isoInDays(30),
      quantity: 3,
      unitCost: 50,
      now: new Date().toISOString(),
    });

    const sale = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 100,
      discountAmount: 0,
    });
    const saleId = (sale.sale as { id: string }).id;
    await db
      .update(inventoryLots)
      .set({ status: 'quarantined' })
      .where(and(eq(inventoryLots.id, lot.lotId), eq(inventoryLots.tenantId, tenantId)));

    await returnSale(buildContext(), { id: saleId, reason: 'supplier quarantine' });

    const restored = await db
      .select({ onHand: inventoryLots.onHand, status: inventoryLots.status })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, lot.lotId))
      .get();
    expect(restored).toMatchObject({ onHand: 3, status: 'quarantined' });
  });

  it('marks a depleted lot expired when it expires before the reversal', async () => {
    const db = getDatabase();
    const productId = await seedLotProduct({
      name: 'Medicine expired return',
      sku: 'LOT-EXPIRED-RETURN',
      stock: 1,
    });
    const lot = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-EXPIRED-RETURN',
      expiresAt: isoInDays(30),
      quantity: 1,
      unitCost: 50,
      now: new Date().toISOString(),
    });

    const sale = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 100,
      discountAmount: 0,
    });
    const saleId = (sale.sale as { id: string }).id;
    await db
      .update(inventoryLots)
      .set({ expiresAt: isoInDays(-1) })
      .where(and(eq(inventoryLots.id, lot.lotId), eq(inventoryLots.tenantId, tenantId)));

    await returnSale(buildContext(), { id: saleId, reason: 'expired after sale' });

    const restored = await db
      .select({ onHand: inventoryLots.onHand, status: inventoryLots.status })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, lot.lotId))
      .get();
    expect(restored).toMatchObject({ onHand: 1, status: 'expired' });
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
    // Non-lot product: seed the opening on_hand at the active site so the
    // sale's stock check passes (products.stock removed).
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 10,
      reserved: 0,
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

  // the consumed/restored lots must reach sync_outbox, not just be
  // marked sync-pending on the row (they used to wait for the next receive).
  it('enqueues the mutated lots to sync_outbox on sale and on reversal', async () => {
    const db = getDatabase();
    const productId = await seedLotProduct({ name: 'Pan sync', sku: 'LOT-SYNC', stock: 6 });
    const lot = receiveInventoryLot(db, {
      tenantId,
      siteId,
      productId,
      lotNumber: 'L-SYNC',
      expiresAt: isoInDays(7),
      quantity: 6,
      unitCost: 20,
      now: new Date().toISOString(),
    });

    const lotOutboxRows = async () =>
      db
        .select({
          id: syncOutbox.id,
          operation: syncOutbox.operation,
          payload: syncOutbox.payload,
        })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'inventory_lots'),
            eq(syncOutbox.entityId, lot.lotId)
          )
        )
        .all();

    const beforeSale = await lotOutboxRows();
    const beforeSaleIds = new Set(beforeSale.map(row => row.id));

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

    const afterSale = await lotOutboxRows();
    const saleLotRows = afterSale.filter(row => !beforeSaleIds.has(row.id));
    expect(saleLotRows).toHaveLength(1);
    expect(saleLotRows[0]?.operation).toBe('update');
    expect(saleLotRows[0]?.payload).toMatchObject({
      id: lot.lotId,
      saleId,
      onHand: 2,
      unitCost: 20,
      status: 'active',
    });

    await returnSale(buildContext(), { id: saleId, reason: 'sync test' });

    const afterReturn = await lotOutboxRows();
    const afterSaleIds = new Set(afterSale.map(row => row.id));
    const returnLotRows = afterReturn.filter(row => !afterSaleIds.has(row.id));
    expect(returnLotRows).toHaveLength(1);
    expect(returnLotRows[0]?.payload).toMatchObject({
      id: lot.lotId,
      saleId,
      onHand: 6,
      unitCost: 20,
      status: 'active',
    });
  });
});
