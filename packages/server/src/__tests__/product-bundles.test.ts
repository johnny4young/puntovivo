/** Retail combos/kits (bundles) component deduction/reversals and returnable containers. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  products,
  inventoryMovements,
  saleItemBundleComponents,
  saleItems,
  sites,
  tenants,
  units,
  users,
} from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getProductStockTotal } from '../services/inventory-balances.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let otherTenantId: string;
let userId: string;
let otherUserId: string;
let siteId: string;
let baseUnitId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;
let otherFresh: ReturnType<typeof makeFreshContextFactory>;

describe('Product bundles (combos/kits) and returnable containers', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const now = new Date().toISOString();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    userId = admin.id;
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    const baseUnit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
      candidate => candidate.abbreviation === 'UND'
    );
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;

    otherTenantId = nanoid();
    otherUserId = nanoid();
    const otherSiteId = nanoid();
    const otherCompanyId = nanoid();
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Otro Tenant',
      slug: `other-${nanoid(6)}`,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: otherCompanyId,
      tenantId: otherTenantId,
      name: 'Otra SAS',
      taxId: `OTR-${nanoid(6)}`,
      email: 'other@example.com',
      phone: null,
      address: null,
      logoId: null,
      logoUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId: otherTenantId,
      companyId: otherCompanyId,
      name: 'Sede Otra',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: otherUserId,
      tenantId: otherTenantId,
      email: `other-${nanoid(5)}@example.com`,
      passwordHash: 'hash',
      name: 'Admin Otro',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(units).values({
      id: nanoid(),
      tenantId: otherTenantId,
      name: 'Unidad',
      abbreviation: 'UN',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const device = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'desktop',
      name: 'Caja Combos',
    });
    const otherDevice = await registerDeviceService(db, {
      tenantId: otherTenantId,
      userId: otherUserId,
      kind: 'desktop',
      name: 'Caja Otra',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      siteId,
      deviceId: device.deviceId,
      userId,
      email: 'admin@localhost',
      defaultRole: 'admin',
    });
    otherFresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId: otherTenantId,
      siteId: otherSiteId,
      deviceId: otherDevice.deviceId,
      userId: otherUserId,
      email: 'other@example.com',
      defaultRole: 'admin',
    });
    await appRouter.createCaller(fresh()).cashSessions.open({
      registerName: 'Caja 1',
      openingFloat: 0,
      denominations: [],
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('persists returnable container flags and deposit amount on create and update', async () => {
    const caller = appRouter.createCaller(fresh());
    const bottle = await caller.products.create({
      name: 'Gaseosa 1.5L Retornable',
      sku: `RET-${nanoid(6)}`,
      price: 4500,
      cost: 2800,
      stock: 10,
      isReturnableContainer: true,
      returnableDepositAmount: 1500,
    });
    expect(bottle.isReturnableContainer).toBe(true);
    expect(bottle.returnableDepositAmount).toBe(1500);

    const updated = await caller.products.update({
      id: bottle.id,
      version: bottle.version,
      isReturnableContainer: false,
    });
    expect(updated.isReturnableContainer).toBe(false);
    expect(updated.returnableDepositAmount).toBe(0);
  });

  it('enforces bundle validation (anti-self, anti-nesting, lot-free, tenant-scoped)', async () => {
    const caller = appRouter.createCaller(fresh());
    const otherCaller = appRouter.createCaller(otherFresh());

    const burger = await caller.products.create({
      name: 'Hamburguesa',
      sku: `BUR-${nanoid(5)}`,
      price: 15000,
      cost: 7000,
      stock: 10,
    });
    const soda = await caller.products.create({
      name: 'Gaseosa',
      sku: `SOD-${nanoid(5)}`,
      price: 4000,
      cost: 1800,
      stock: 10,
    });
    const combo = await caller.products.create({
      name: 'Combo Familiar',
      sku: `CMB-${nanoid(5)}`,
      price: 17000,
      cost: 8800,
      tracksStock: false,
      stock: 0,
    });
    const lotItem = await caller.products.create({
      name: 'Medicamento Lote',
      sku: `LOT-${nanoid(5)}`,
      price: 10000,
      cost: 5000,
      tracksStock: true,
      tracksLots: true,
      stock: 0,
    });
    const foreignItem = await otherCaller.products.create({
      name: 'Producto Ajeno',
      sku: `FOR-${nanoid(5)}`,
      price: 5000,
      cost: 2000,
      stock: 5,
    });

    await expect(
      caller.products.setBundleComponents({
        productId: combo.id,
        components: [{ componentProductId: combo.id, quantity: 1 }],
      })
    ).rejects.toThrow(/itself/i);

    await expect(
      caller.products.setBundleComponents({
        productId: combo.id,
        components: [{ componentProductId: lotItem.id, quantity: 1 }],
      })
    ).rejects.toThrow(/lot or serial/i);

    await expect(
      caller.products.setBundleComponents({
        productId: combo.id,
        components: [{ componentProductId: foreignItem.id, quantity: 1 }],
      })
    ).rejects.toThrow(/business/i);

    const wrapping = await caller.products.create({
      name: 'Empaque',
      sku: `EMP-${nanoid(5)}`,
      price: 500,
      cost: 0,
      tracksStock: false,
      stock: 0,
    });

    // A combo that tracks its own stock would debit itself and every component.
    await expect(
      caller.products.setBundleComponents({
        productId: burger.id,
        components: [{ componentProductId: soda.id, quantity: 1 }],
      })
    ).rejects.toThrow(/cannot track its own stock/i);

    const saved = await caller.products.setBundleComponents({
      productId: combo.id,
      components: [
        { componentProductId: burger.id, quantity: 1 },
        { componentProductId: soda.id, quantity: 2 },
        { componentProductId: wrapping.id, quantity: 1 },
      ],
    });
    expect(saved).toHaveLength(3);

    // Nesting rejected: a component cannot hold components of its own.
    await expect(
      caller.products.setBundleComponents({
        productId: wrapping.id,
        components: [{ componentProductId: soda.id, quantity: 1 }],
      })
    ).rejects.toThrow(/nested/i);

    // Later edits cannot give the combo its own stock or a component lot custody.
    const versionOf = (id: string) =>
      getDatabase().select().from(products).where(eq(products.id, id)).get()!.version;
    await expect(
      caller.products.update({ id: combo.id, version: versionOf(combo.id), tracksStock: true })
    ).rejects.toThrow(/cannot track its own stock/i);
    await expect(
      caller.products.update({
        id: soda.id,
        version: versionOf(soda.id),
        stock: 0,
        tracksLots: true,
      })
    ).rejects.toThrow(/cannot track lots or serials/i);
  });

  it('atomically deducts component stock on sale, blocks insufficient stock, and reverses on return/void/discard', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(fresh());

    const bread = await caller.products.create({
      name: 'Pan Artesanal',
      sku: `PAN-${nanoid(5)}`,
      price: 3000,
      cost: 1200,
      stock: 10,
    });
    const coffee = await caller.products.create({
      name: 'Café Molido',
      sku: `CAF-${nanoid(5)}`,
      price: 8000,
      cost: 3500,
      stock: 5,
    });
    const breakfastCombo = await caller.products.create({
      name: 'Combo Desayuno',
      sku: `DES-${nanoid(5)}`,
      price: 10000,
      cost: 4700,
      tracksStock: false,
      stock: 0,
    });

    await caller.products.setBundleComponents({
      productId: breakfastCombo.id,
      components: [
        { componentProductId: bread.id, quantity: 2 },
        { componentProductId: coffee.id, quantity: 1 },
      ],
    });

    // Insufficient stock (requests 6 coffees when only 5 available) rolls back cleanly.
    const failCaller = appRouter.createCaller(fresh());
    await expect(
      failCaller.sales.create({
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 60000,
        discountAmount: 0,
        items: [
          {
            productId: breakfastCombo.id,
            unitId: baseUnitId,
            quantity: 6,
            unitPrice: 10000,
            discount: 0,
          },
        ],
      })
    ).rejects.toThrow(/Insufficient stock/i);
    expect(getProductStockTotal(db, tenantId, bread.id)).toBe(10);
    expect(getProductStockTotal(db, tenantId, coffee.id)).toBe(5);

    // Sell 2 combos → deducts 4 breads (10→6) and 2 coffees (5→3).
    const saleCaller = appRouter.createCaller(fresh());
    const sale = await saleCaller.sales.create({
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 20000,
      discountAmount: 0,
      items: [
        {
          productId: breakfastCombo.id,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 10000,
          discount: 0,
        },
      ],
    });
    expect(getProductStockTotal(db, tenantId, bread.id)).toBe(6);
    expect(getProductStockTotal(db, tenantId, coffee.id)).toBe(3);

    // Partial return of 1 of 2 combos → restores 2 breads (6→8) and 1 coffee (3→4).
    const returnCaller = appRouter.createCaller(fresh());
    const fullSale = await returnCaller.sales.getById({ id: sale.id });
    await returnCaller.sales.returnSale({
      id: sale.id,
      reason: 'Cliente devolvió un combo',
      items: [{ saleItemId: fullSale.items[0]!.id, quantity: 1 }],
    });
    expect(getProductStockTotal(db, tenantId, bread.id)).toBe(8);
    expect(getProductStockTotal(db, tenantId, coffee.id)).toBe(4);

    // Draft sale reserves component stock and discardDraft restores 100%.
    const draftCaller = appRouter.createCaller(fresh());
    const draft = await draftCaller.sales.create({
      status: 'draft',
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      amountReceived: 0,
      discountAmount: 0,
      items: [
        {
          productId: breakfastCombo.id,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 10000,
          discount: 0,
        },
      ],
    });
    expect(getProductStockTotal(db, tenantId, bread.id)).toBe(6);
    expect(getProductStockTotal(db, tenantId, coffee.id)).toBe(3);

    const discardCaller = appRouter.createCaller(fresh());
    await discardCaller.sales.discardDraft({ saleId: draft.id });
    expect(getProductStockTotal(db, tenantId, bread.id)).toBe(8);
    expect(getProductStockTotal(db, tenantId, coffee.id)).toBe(4);
  });

  it('reverses only what the sale debited, even if a component changes stock tracking later', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(fresh());

    const soda = await caller.products.create({
      name: 'Gaseosa 400ml',
      sku: `GAS-${nanoid(5)}`,
      price: 2500,
      cost: 1000,
      stock: 10,
    });
    const service = await caller.products.create({
      name: 'Empaque Regalo',
      sku: `EMP-${nanoid(5)}`,
      price: 500,
      cost: 0,
      tracksStock: false,
      stock: 0,
    });
    const combo = await caller.products.create({
      name: 'Combo Regalo',
      sku: `REG-${nanoid(5)}`,
      price: 3000,
      cost: 1000,
      tracksStock: false,
      stock: 0,
    });
    await caller.products.setBundleComponents({
      productId: combo.id,
      components: [
        { componentProductId: soda.id, quantity: 1 },
        { componentProductId: service.id, quantity: 1 },
      ],
    });

    const sale = await appRouter.createCaller(fresh()).sales.create({
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 3000,
      discountAmount: 0,
      items: [
        { productId: combo.id, unitId: baseUnitId, quantity: 1, unitPrice: 3000, discount: 0 },
      ],
    });
    expect(getProductStockTotal(db, tenantId, soda.id)).toBe(9);
    expect(
      db
        .select()
        .from(saleItemBundleComponents)
        .where(eq(saleItemBundleComponents.componentProductId, service.id))
        .all()
    ).toHaveLength(0);

    db.update(products).set({ tracksStock: false }).where(eq(products.id, soda.id)).run();
    db.update(products).set({ tracksStock: true }).where(eq(products.id, service.id)).run();

    const returnCaller = appRouter.createCaller(fresh());
    const fullSale = await returnCaller.sales.getById({ id: sale.id });
    await returnCaller.sales.returnSale({
      id: sale.id,
      reason: 'Devolución completa',
      items: [{ saleItemId: fullSale.items[0]!.id, quantity: 1 }],
    });
    expect(getProductStockTotal(db, tenantId, soda.id)).toBe(10);
    expect(getProductStockTotal(db, tenantId, service.id)).toBe(0);
  });

  it('freezes component value on the combo line and credits it back exactly across returns', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(fresh());
    const juice = await caller.products.create({
      name: 'Jugo',
      sku: `JUG-${nanoid(5)}`,
      price: 3000,
      cost: 1000,
      stock: 10,
    });
    const cookie = await caller.products.create({
      name: 'Galleta',
      sku: `GAL-${nanoid(5)}`,
      price: 1500,
      cost: 333.33,
      stock: 10,
    });
    const snack = await caller.products.create({
      name: 'Combo Merienda',
      sku: `MER-${nanoid(5)}`,
      price: 4000,
      cost: 0,
      tracksStock: false,
      stock: 0,
    });
    await caller.products.setBundleComponents({
      productId: snack.id,
      components: [
        { componentProductId: juice.id, quantity: 1 },
        { componentProductId: cookie.id, quantity: 1 },
      ],
    });

    const sale = await appRouter.createCaller(fresh()).sales.create({
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 12000,
      discountAmount: 0,
      items: [
        { productId: snack.id, unitId: baseUnitId, quantity: 3, unitPrice: 4000, discount: 0 },
      ],
    });
    const saleItem = db.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).get()!;
    const snapshots = db
      .select()
      .from(saleItemBundleComponents)
      .where(eq(saleItemBundleComponents.saleItemId, saleItem.id))
      .all();
    const frozenTotal = snapshots.reduce((sum, snap) => sum + (snap.cogsCostCents ?? 0), 0);
    expect(snapshots.every(snap => snap.cogsCostCents !== null)).toBe(true);
    expect(saleItem.cogsCostCents).toBe(frozenTotal);
    expect(frozenTotal).toBe(399999);

    // Component cost moves after the sale; returns still credit the sale-time value.
    db.update(products).set({ cost: 9999 }).where(eq(products.id, cookie.id)).run();
    const returnCaller = appRouter.createCaller(fresh());
    await returnCaller.sales.returnSale({
      id: sale.id,
      reason: 'Devolución parcial',
      items: [{ saleItemId: saleItem.id, quantity: 1 }],
    });
    await appRouter.createCaller(fresh()).sales.returnSale({
      id: sale.id,
      reason: 'Devolución del resto',
      items: [{ saleItemId: saleItem.id, quantity: 2 }],
    });

    const credited = db
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.reference, sale.id), eq(inventoryMovements.type, 'return')))
      .all();
    expect(credited).toHaveLength(4);
    expect(credited.reduce((sum, row) => sum + (row.inventoryValueDeltaCents ?? 0), 0)).toBe(
      frozenTotal
    );
  });
});
