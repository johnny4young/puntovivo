/**
 * inventoryLots tRPC router (Auditoría 2026-07 — lots & costing).
 *
 * Exercises receive (create + increment/blend), FEFO-ordered list, and the
 * expiring-lot alert scan against the in-memory DB.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  inventoryLots,
  inventoryMovements,
  pharmacyProductProfiles,
  products,
  sites,
  syncOutbox,
  users,
  vatRates,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { freshCriticalContext, makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let productId: string;
let vatRateId: string;
let deviceId: string;
const now = () => new Date().toISOString();

function makeContext(role: 'admin' | 'manager' | 'cashier'): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: makeEnvelopeHeadersProxy({
        getDeviceId: () => deviceId,
        getSiteId: () => siteId,
      }),
      user: { userId, email: 'admin@localhost', role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: 'admin@localhost', role, tenantId },
    tenantId,
    siteId,
  };
}

const isoInDays = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('inventoryLots router (lots & costing)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) throw new Error('Expected seeded admin user');
    tenantId = seededUser.tenantId;
    userId = seededUser.id;
    const seededSite = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!seededSite) throw new Error('Expected seeded site');
    siteId = seededSite.id;
    deviceId = (
      await registerDeviceService(db, {
        tenantId,
        userId,
        kind: 'web',
        name: 'inventory-lot-router-test',
      })
    ).deviceId;
    const seededVat = await db.select().from(vatRates).where(eq(vatRates.tenantId, tenantId)).get();
    vatRateId = seededVat!.id;

    productId = nanoid();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Leche entera 1L',
      sku: `SKU-${productId.slice(0, 6)}`,
      description: null,
      categoryId: null,
      providerId: null,
      vatRateId,
      locationId: null,
      initialCost: 100,
      cost: 100,
      price: 200,
      price2: 220,
      price3: 240,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 0,
      minStock: 0,
      sellByFraction: false,
      fractionStep: null,
      fractionMinimum: null,
      tracksLots: true,
      isActive: true,
      barcode: null,
      imageUrl: null,
      embedding: null,
      embeddingModel: null,
      embeddingTextHash: null,
      embeddingUpdatedAt: null,
      createdAt: now(),
      updatedAt: now(),
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('receives a new lot, then increments + blends cost on a second receipt of the same lot', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));

    const first = await caller.inventoryLots.receive({
      siteId,
      productId,
      lotNumber: 'L-001',
      expiresAt: isoInDays(20),
      quantity: 10,
      unitCost: 100,
    });
    expect(first.created).toBe(true);
    expect(first.onHand).toBe(10);
    expect(first.unitCost).toBe(100);

    const second = await caller.inventoryLots.receive({
      siteId,
      productId,
      lotNumber: 'L-001',
      quantity: 10,
      unitCost: 120,
    });
    expect(second.created).toBe(false);
    expect(second.onHand).toBe(20);
    // (10*100 + 10*120) / 20 = 110
    expect(second.unitCost).toBe(110);
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(20);
  });

  it('replays the same receipt envelope without duplicating lot or aggregate stock', async () => {
    const before = getProductStockTotal(getDatabase(), tenantId, productId);
    const operationId = randomUUID();
    const context = freshCriticalContext({
      db: getDatabase(),
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      role: 'manager',
      siteId,
      deviceId,
      envelope: {
        operationId,
        idempotencyKey: randomUUID(),
        clientCreatedAt: new Date().toISOString(),
      },
    });
    const caller = appRouter.createCaller(context);
    const input = {
      siteId,
      productId,
      lotNumber: `L-IDEMPOTENT-${nanoid(6)}`,
      quantity: 7,
      unitCost: 75,
    };

    const first = await caller.inventoryLots.receive(input);
    const replay = await caller.inventoryLots.receive(input);

    expect(replay).toEqual(first);
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(before + 7);
    const storedLots = await getDatabase()
      .select({ id: inventoryLots.id, onHand: inventoryLots.onHand })
      .from(inventoryLots)
      .where(
        and(
          eq(inventoryLots.tenantId, tenantId),
          eq(inventoryLots.siteId, siteId),
          eq(inventoryLots.productId, productId),
          eq(inventoryLots.lotNumber, input.lotNumber)
        )
      );
    expect(storedLots).toEqual([{ id: first.lotId, onHand: 7 }]);
    const storedMovements = await getDatabase()
      .select({ id: inventoryMovements.id })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.siteId, siteId),
          eq(inventoryMovements.productId, productId),
          eq(inventoryMovements.reference, first.lotId)
        )
      );
    expect(storedMovements).toHaveLength(1);
    expect(
      await getDatabase()
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'inventory_lots'),
            eq(syncOutbox.entityId, first.lotId)
          )
        )
    ).toHaveLength(1);
    expect(
      await getDatabase()
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'inventory_movements'),
            eq(syncOutbox.entityId, storedMovements[0]!.id)
          )
        )
    ).toHaveLength(1);
    expect(
      await getDatabase()
        .select({
          action: auditLogs.action,
          resourceId: auditLogs.resourceId,
          operationId: auditLogs.operationId,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.action, 'inventory.adjust_stock'),
            eq(auditLogs.operationId, operationId)
          )
        )
    ).toEqual([
      {
        action: 'inventory.adjust_stock',
        resourceId: productId,
        operationId,
      },
    ]);
  });

  it('rejects a lot receipt until the product opts into lot tracking', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));
    const untracked = await caller.products.create({
      name: 'Legacy untracked product',
      sku: `UNTRACKED-${nanoid()}`,
      stock: 0,
    });

    await expect(
      caller.inventoryLots.receive({
        siteId,
        productId: untracked.id,
        lotNumber: 'NO-LOT-MODE',
        quantity: 1,
        unitCost: 10,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_LOT_TRACKING_REQUIRED' },
    });
  });

  it('keeps fractional on-hand quantities without money-rounding them', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));

    // 2.125 would round to 2.13 under money rounding; the quantity must survive.
    const first = await caller.inventoryLots.receive({
      siteId,
      productId,
      lotNumber: 'L-FRAC',
      quantity: 2.125,
      unitCost: 50,
    });
    expect(first.onHand).toBe(2.125);

    // 2.125 + 1.0625 = 3.1875 (would collapse to 3.19 if money-rounded).
    const second = await caller.inventoryLots.receive({
      siteId,
      productId,
      lotNumber: 'L-FRAC',
      quantity: 1.0625,
      unitCost: 50,
    });
    expect(second.onHand).toBe(3.1875);
  });

  it('records the authoritative rounded stock after fractional lot receipts', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));
    const first = await caller.inventoryLots.receive({
      siteId,
      productId,
      lotNumber: 'L-FLOAT-SNAPSHOT',
      quantity: 0.1,
      unitCost: 50,
    });
    await caller.inventoryLots.receive({
      siteId,
      productId,
      lotNumber: 'L-FLOAT-SNAPSHOT',
      quantity: 0.2,
      unitCost: 50,
    });
    const authoritativeStock = getProductStockTotal(getDatabase(), tenantId, productId);
    const movements = await getDatabase()
      .select({ newStock: inventoryMovements.newStock })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.reference, first.lotId)
        )
      );

    expect(movements).toHaveLength(2);
    expect(movements[1]?.newStock).toBe(authoritativeStock);

    const singleReceipt = await caller.inventoryLots.receive({
      siteId,
      productId,
      lotNumber: 'L-FLOAT-SINGLE',
      quantity: 0.1 + 0.2,
      unitCost: 50,
    });
    expect(singleReceipt.onHand).toBe(0.3);
    const singleMovement = await getDatabase()
      .select({ quantity: inventoryMovements.quantity })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.reference, singleReceipt.lotId)
        )
      )
      .get();
    expect(singleMovement?.quantity).toBe(0.3);
  });

  it('rejects a non-positive quantity', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));
    await expect(
      caller.inventoryLots.receive({
        siteId,
        productId,
        lotNumber: 'L-x',
        quantity: 0,
        unitCost: 10,
      })
    ).rejects.toThrow();

    await expect(
      caller.inventoryLots.receive({
        siteId,
        productId,
        lotNumber: 'L-BELOW-PRECISION',
        quantity: 1e-13,
        unitCost: 10,
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'LOT_QUANTITY_INVALID' } });
  });

  it('lists product lots FEFO-ordered for managers and hides cost-bearing rows from cashiers', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));
    // Add a sooner-expiring lot; it must sort ahead of L-001.
    await appRouter.createCaller(makeContext('manager')).inventoryLots.receive({
      siteId,
      productId,
      lotNumber: 'L-000-soon',
      expiresAt: isoInDays(5),
      quantity: 4,
      unitCost: 90,
    });
    const listed = await caller.inventoryLots.list({ siteId, productId, activeOnly: true });
    expect(listed.items[0]!.lotNumber).toBe('L-000-soon');
    expect(listed.items.every(l => l.onHand > 0)).toBe(true);
    expect(listed.items.every(l => l.activeRecallCount === 0)).toBe(true);
    await expect(
      appRouter
        .createCaller(makeContext('cashier'))
        .inventoryLots.list({ siteId, productId, activeOnly: true })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('surfaces lots expiring within the window and excludes far-future ones', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));
    const db = getDatabase();
    const timestamp = now();
    await db.insert(pharmacyProductProfiles).values({
      productId,
      tenantId,
      classification: 'otc',
      requiresColdChain: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await caller.inventoryLots.receive({
      siteId,
      productId,
      lotNumber: 'L-far',
      expiresAt: isoInDays(400),
      quantity: 3,
      unitCost: 100,
    });
    const soon = await caller.inventoryLots.expiring({ withinDays: 30 });
    const numbers = soon.items.map(i => i.lotNumber);
    expect(numbers).toContain('L-000-soon');
    expect(numbers).not.toContain('L-far');
    expect(soon.items.find(item => item.lotNumber === 'L-000-soon')).toMatchObject({
      isPharmacyMedicine: true,
    });
  });

  it('rejects receiving into a site that does not belong to the tenant', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));
    await expect(
      caller.inventoryLots.receive({
        siteId: 'not-a-site',
        productId,
        lotNumber: 'L-002',
        quantity: 1,
        unitCost: 10,
      })
    ).rejects.toThrow();
  });

  it('rejects lot reads scoped to a site outside the tenant', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));
    await expect(
      caller.inventoryLots.list({
        siteId: 'other-tenant-site',
        productId,
        activeOnly: false,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.inventoryLots.expiring({ siteId: 'other-tenant-site', withinDays: 30 })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
