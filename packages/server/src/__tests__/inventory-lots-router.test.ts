/**
 * inventoryLots tRPC router (Auditoría 2026-07 — lots & costing).
 *
 * Exercises receive (create + increment/blend), FEFO-ordered list, and the
 * expiring-lot alert scan against the in-memory DB.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { products, sites, users, vatRates } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let productId: string;
let vatRateId: string;
const now = () => new Date().toISOString();

function makeContext(role: 'admin' | 'manager' | 'cashier'): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: 'admin@localhost', role, tenantId },
    tenantId,
    siteId: null,
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
  });

  it('lists a product lots FEFO-ordered, active-only filter honoured', async () => {
    const caller = appRouter.createCaller(makeContext('cashier'));
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
  });

  it('surfaces lots expiring within the window and excludes far-future ones', async () => {
    const caller = appRouter.createCaller(makeContext('manager'));
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
});
