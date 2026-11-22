import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  inventoryBalances,
  inventoryMovements,
  products,
  providers,
  sites,
  units,
  unitXProduct,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

/** Both pools carry weighted average cost; a receipt cost values only the units it adds. */
describe('catalog weighted average valuation', () => {
  let server: PuntovivoServer;
  let tenantId: string;
  let siteId: string;
  let unitId: string;
  let providerId: string;
  let fresh: ReturnType<typeof makeFreshContextFactory>;
  const caller = () => appRouter.createCaller(fresh());

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = db.select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
    tenantId = user.tenantId;
    siteId = db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get()!.id;
    unitId = db
      .select()
      .from(units)
      .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
      .get()!.id;
    providerId = nanoid();
    db.insert(providers).values({ id: providerId, tenantId, name: 'Average supplier' }).run();
    const device = await registerDevice(db, {
      tenantId,
      userId: user.id,
      kind: 'web',
      name: 'weighted-average',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: user.id,
      email: user.email,
      siteId,
      deviceId: device.deviceId,
      defaultRole: 'admin',
    });
  });
  afterAll(async () => server.close());

  function pools(productId: string) {
    const row = getDatabase().select().from(products).where(eq(products.id, productId)).get()!;
    return { inventory: row.inventoryValueCents, cogs: row.cogsValueCents };
  }

  function revaluations(productId: string) {
    return getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, productId),
          eq(auditLogs.action, 'inventory.revalue')
        )
      )
      .all();
  }

  async function created(cost: number, stock: number) {
    return caller().products.create({
      name: `Arroz ${nanoid(6)}`,
      sku: nanoid(),
      price: 5000,
      cost,
      stock,
      unitAssignments: [{ unitId, equivalence: 1, price: 5000, isBase: true }],
    });
  }

  it('values opening stock at cost when no initial cost was typed', async () => {
    const product = await created(3100, 30);
    const row = getDatabase().select().from(products).where(eq(products.id, product.id)).get()!;
    expect(row.initialCost).toBe(3100);
    expect(pools(product.id)).toEqual({ inventory: 9_300_000, cogs: 9_300_000 });
    const movement = getDatabase()
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, product.id))
      .get()!;
    expect(movement.inventoryValueDeltaCents).toBe(9_300_000);
  });

  it('keeps initial cost zero for a product created without stock', async () => {
    const product = await created(3100, 0);
    const row = getDatabase().select().from(products).where(eq(products.id, product.id)).get()!;
    expect(row.initialCost).toBe(0);
  });

  it('values an inventory entry at its own cost in both pools', async () => {
    const product = await created(3100, 50);
    await caller().inventory.recordEntry({
      productId: product.id,
      unitId,
      mode: 'initial',
      quantity: 10,
      cost: 3200,
    });
    // 50 x 3,100 + 10 x 3,200
    expect(pools(product.id)).toEqual({ inventory: 18_700_000, cogs: 18_700_000 });
    expect(revaluations(product.id)).toHaveLength(0);
  });

  it.each([false, true])(
    'averages a purchase receipt without revaluing existing stock (from order=%s)',
    async fromOrder => {
      const product = await created(1500, 48);
      const order = fromOrder
        ? await caller().orders.create({
            providerId,
            items: [{ productId: product.id, unitId, quantity: 2, costPerUnit: 1550 }],
          })
        : null;
      if (order)
        await caller().purchases.createFromOrder({
          orderId: order.id,
          items: [{ orderItemId: order.items[0]!.id, quantity: 2 }],
        });
      else
        await caller().purchases.create({
          providerId,
          items: [{ productId: product.id, unitId, quantity: 2, costPerUnit: 1550 }],
        });
      // 48 x 1,500 + 2 x 1,550
      expect(pools(product.id)).toEqual({ inventory: 7_510_000, cogs: 7_510_000 });
      expect(revaluations(product.id)).toHaveLength(0);
    }
  );

  it('keeps a legacy unadopted pool at its old cost when a purchase lands', async () => {
    const db = getDatabase();
    const id = nanoid();
    db.insert(products)
      .values({ id, tenantId, name: 'Legacy', sku: nanoid(), price: 10, cost: 4, initialCost: 4 })
      .run();
    db.insert(unitXProduct)
      .values({ id: nanoid(), productId: id, unitId, equivalence: 1, price: 10, isBase: true })
      .run();
    db.insert(inventoryBalances)
      .values({ id: nanoid(), tenantId, siteId, productId: id, onHand: 10 })
      .run();
    await caller().purchases.create({
      providerId,
      items: [{ productId: id, unitId, quantity: 10, costPerUnit: 6 }],
    });
    expect(pools(id)).toEqual({ inventory: 10_000, cogs: 10_000 });
  });
});
