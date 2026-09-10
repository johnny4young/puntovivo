/**
 * Invariant tests for service / non-inventory items (tracks_stock=false).
 *
 * A service product sells with no stock validation, no inventory
 * movement, and no inventory balance write — forward (fresh sale) and
 * backward (refund). Physical lines in the same cart keep every mature
 * stock invariant. The catalog layer refuses contradictory shapes
 * (service + lots/serials, service + stock) on create and update.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  inventoryBalances,
  inventoryMovements,
  orders,
  products,
  providers,
  purchases,
  saleItems,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { completeSale } from '../application/sales/completeSale.js';
import { returnSale } from '../application/sales/returnSale.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let makeCaller: () => ReturnType<typeof appRouter.createCaller>;

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

async function seedProduct(args: {
  name: string;
  sku: string;
  stock: number;
  tracksStock?: boolean;
  price?: number;
}): Promise<string> {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: args.name,
    sku: args.sku,
    price: args.price ?? 10,
    price2: args.price ?? 10,
    price3: args.price ?? 10,
    cost: 4,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 4,
    minStock: 0,
    tracksStock: args.tracksStock ?? true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId,
    unitId: baseUnitId,
    equivalence: 1,
    price: args.price ?? 10,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  if (args.stock > 0) {
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
  }
  return productId;
}

async function movementsFor(productId: string) {
  return getDatabase()
    .select()
    .from(inventoryMovements)
    .where(
      and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.productId, productId))
    )
    .all();
}

async function balancesFor(productId: string) {
  return getDatabase()
    .select()
    .from(inventoryBalances)
    .where(
      and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.productId, productId))
    )
    .all();
}

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
  const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
  if (!baseUnit) throw new Error('Expected seeded unit UND');
  baseUnitId = baseUnit.id;

  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'service-items.test',
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
  makeCaller = () => appRouter.createCaller(fresh());
  await makeCaller().cashSessions.open({
    registerName: 'Service items register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('service items in the sale path', () => {
  it('sells a service with zero stock and writes no inventory', async () => {
    const serviceId = await seedProduct({
      name: 'Delivery service',
      sku: 'SVC-DELIVERY',
      stock: 0,
      tracksStock: false,
    });

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      items: [
        { productId: serviceId, unitId: baseUnitId, quantity: 3, unitPrice: 10, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'completed',
      amountReceived: 30,
      discountAmount: 0,
    });

    expect(result.sale.status).toBe('completed');
    const lines = await getDatabase()
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, result.sale.id))
      .all();
    expect(lines).toHaveLength(1);
    expect(await movementsFor(serviceId)).toHaveLength(0);
    expect(await balancesFor(serviceId)).toHaveLength(0);
    expect(getProductStockTotal(getDatabase(), tenantId, serviceId)).toBe(0);
  });

  it('keeps physical stock invariants intact in a mixed cart', async () => {
    const serviceId = await seedProduct({
      name: 'Install labor',
      sku: 'SVC-INSTALL',
      stock: 0,
      tracksStock: false,
    });
    const physicalId = await seedProduct({ name: 'Cable roll', sku: 'PHY-CABLE', stock: 5 });

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      items: [
        { productId: physicalId, unitId: baseUnitId, quantity: 2, unitPrice: 10, discount: 0 },
        { productId: serviceId, unitId: baseUnitId, quantity: 1, unitPrice: 10, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'completed',
      amountReceived: 30,
      discountAmount: 0,
    });

    expect(result.sale.status).toBe('completed');
    expect(getProductStockTotal(getDatabase(), tenantId, physicalId)).toBe(3);
    expect(await movementsFor(physicalId)).toHaveLength(1);
    expect(await movementsFor(serviceId)).toHaveLength(0);

    // an overselling physical line still fails with the service present.
    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        items: [
          { productId: physicalId, unitId: baseUnitId, quantity: 99, unitPrice: 10, discount: 0 },
          { productId: serviceId, unitId: baseUnitId, quantity: 1, unitPrice: 10, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'completed',
        amountReceived: 1000,
        discountAmount: 0,
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('Insufficient stock') });
  });

  it('refunds a mixed sale crediting only the physical line', async () => {
    const serviceId = await seedProduct({
      name: 'Repair labor',
      sku: 'SVC-REPAIR',
      stock: 0,
      tracksStock: false,
    });
    const physicalId = await seedProduct({ name: 'Spare part', sku: 'PHY-SPARE', stock: 4 });

    const sale = await completeSale(buildContext(), {
      mode: 'fresh',
      items: [
        { productId: physicalId, unitId: baseUnitId, quantity: 2, unitPrice: 10, discount: 0 },
        { productId: serviceId, unitId: baseUnitId, quantity: 1, unitPrice: 10, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 30,
      discountAmount: 0,
    });
    expect(getProductStockTotal(getDatabase(), tenantId, physicalId)).toBe(2);

    const refund = await returnSale(buildContext(), {
      id: sale.sale.id,
      reason: 'service item refund test',
    });
    expect(refund.sale.returnState).toBe('refunded');

    // the physical credit landed, the service stayed inventory-less.
    expect(getProductStockTotal(getDatabase(), tenantId, physicalId)).toBe(4);
    expect(await movementsFor(serviceId)).toHaveLength(0);
    expect(await balancesFor(serviceId)).toHaveLength(0);
  });
  it('credits the reversal from the sale-time snapshot, not the live flag', async () => {
    // A physical product sold, then converted to a service once its stock
    // reached zero. Refunding that sale must still credit the units it
    // debited; reading the live flag would silently lose them.
    const caller = makeCaller();
    const physicalId = await seedProduct({ name: 'Convertible item', sku: 'PHY-CONV', stock: 2 });

    const sale = await completeSale(buildContext(), {
      mode: 'fresh',
      items: [
        { productId: physicalId, unitId: baseUnitId, quantity: 2, unitPrice: 10, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 20,
      discountAmount: 0,
    });
    expect(getProductStockTotal(getDatabase(), tenantId, physicalId)).toBe(0);

    const row = await getDatabase()
      .select({ version: products.version })
      .from(products)
      .where(eq(products.id, physicalId))
      .get();
    const converted = await caller.products.update({
      id: physicalId,
      version: row?.version ?? 0,
      tracksStock: false,
    });
    expect(converted.tracksStock).toBe(false);

    await returnSale(buildContext(), { id: sale.sale.id, reason: 'post-conversion refund' });
    expect(getProductStockTotal(getDatabase(), tenantId, physicalId)).toBe(2);
  });

  it('never conjures stock when a service is converted to physical after a sale', async () => {
    const caller = makeCaller();
    const serviceId = await seedProduct({
      name: 'Convertible service',
      sku: 'SVC-CONV',
      stock: 0,
      tracksStock: false,
    });

    const sale = await completeSale(buildContext(), {
      mode: 'fresh',
      items: [
        { productId: serviceId, unitId: baseUnitId, quantity: 3, unitPrice: 10, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 30,
      discountAmount: 0,
    });

    const row = await getDatabase()
      .select({ version: products.version })
      .from(products)
      .where(eq(products.id, serviceId))
      .get();
    await caller.products.update({
      id: serviceId,
      version: row?.version ?? 0,
      tracksStock: true,
    });

    await returnSale(buildContext(), { id: sale.sale.id, reason: 'post-conversion refund' });
    // The sale never debited inventory, so the refund must not credit any.
    expect(getProductStockTotal(getDatabase(), tenantId, serviceId)).toBe(0);
    expect(await movementsFor(serviceId)).toHaveLength(0);
  });
});

describe('service items are fail-closed against every stock writer', () => {
  it('refuses an inventory adjustment on a service', async () => {
    const caller = makeCaller();
    const serviceId = await seedProduct({
      name: 'Guarded service',
      sku: 'SVC-GUARD',
      stock: 0,
      tracksStock: false,
    });

    await expect(
      caller.inventory.adjustStock({ productId: serviceId, newStock: 25, siteId })
    ).rejects.toMatchObject({ message: expect.stringContaining('cannot receive stock') });
    expect(await balancesFor(serviceId)).toHaveLength(0);
  });

  it('rejects services when a purchase or inventory order is created', async () => {
    const db = getDatabase();
    const caller = makeCaller();
    const providerId = nanoid();
    const serviceId = await seedProduct({
      name: 'Non-purchasable labor',
      sku: `SVC-PURCHASE-${nanoid(6)}`,
      stock: 0,
      tracksStock: false,
    });
    const now = new Date().toISOString();
    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Service guard provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const item = { productId: serviceId, unitId: baseUnitId, quantity: 1, costPerUnit: 5 };

    await expect(caller.purchases.create({ providerId, items: [item] })).rejects.toMatchObject({
      message: expect.stringContaining('does not manage inventory'),
    });
    await expect(caller.orders.create({ providerId, items: [item] })).rejects.toMatchObject({
      message: expect.stringContaining('does not manage inventory'),
    });
    expect(
      await db.select().from(purchases).where(eq(purchases.providerId, providerId)).all()
    ).toHaveLength(0);
    expect(
      await db.select().from(orders).where(eq(orders.providerId, providerId)).all()
    ).toHaveLength(0);
  });
});

describe('service items in the catalog', () => {
  it('refuses a partial update that would leave a service tracking lots', async () => {
    const caller = makeCaller();
    const created = await caller.products.create({
      name: 'Partial update service',
      sku: `SVC-PART-${nanoid(6)}`,
      price: 10,
      tracksStock: false,
    });

    // Zod cannot see the stored flag on a partial update; the use-case must.
    await expect(
      caller.products.update({ id: created.id, version: created.version, tracksLots: true })
    ).rejects.toMatchObject({
      message: expect.stringContaining('cannot track lots or serial numbers'),
    });
  });

  it('refuses converting a lot-tracked product into a service in one field', async () => {
    const caller = makeCaller();
    const created = await caller.products.create({
      name: 'Lot tracked item',
      sku: `PHY-LOT-${nanoid(6)}`,
      price: 10,
      tracksLots: true,
    });

    await expect(
      caller.products.update({ id: created.id, version: created.version, tracksStock: false })
    ).rejects.toMatchObject({
      message: expect.stringContaining('cannot track lots or serial numbers'),
    });
  });

  it('rejects a service that tracks lots or serials, or carries stock', async () => {
    const caller = makeCaller();
    await expect(
      caller.products.create({
        name: 'Bad service lots',
        sku: `SVC-BAD-${nanoid(6)}`,
        price: 10,
        tracksStock: false,
        tracksLots: true,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      caller.products.create({
        name: 'Bad service stock',
        sku: `SVC-BAD-${nanoid(6)}`,
        price: 10,
        tracksStock: false,
        stock: 5,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('creates a service through the router and converts it back to physical', async () => {
    const caller = makeCaller();
    const created = await caller.products.create({
      name: 'Haircut',
      sku: `SVC-CUT-${nanoid(6)}`,
      price: 25,
      tracksStock: false,
    });
    expect(created.tracksStock).toBe(false);
    expect(await balancesFor(created.id)).toHaveLength(0);

    const converted = await caller.products.update({
      id: created.id,
      version: created.version,
      tracksStock: true,
    });
    expect(converted.tracksStock).toBe(true);
  });

  it('refuses converting a stocked physical product into a service', async () => {
    const caller = makeCaller();
    const physicalId = await seedProduct({ name: 'Stocked widget', sku: 'PHY-WIDGET', stock: 3 });
    const row = await getDatabase()
      .select({ version: products.version })
      .from(products)
      .where(eq(products.id, physicalId))
      .get();

    await expect(
      caller.products.update({
        id: physicalId,
        version: row?.version ?? 0,
        tracksStock: false,
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('service item cannot carry stock'),
    });
  });
});
