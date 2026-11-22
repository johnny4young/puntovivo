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
});
