/** Real command-envelope writes plus sale graph rollback and frozen historical authority. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  companies,
  cashSessions,
  auditLogs,
  inventoryBalances,
  products,
  restaurantLineModifiers,
  restaurantModifierCatalog,
  restaurantTables,
  sales,
  sites,
  tenants,
  units,
  unitXProduct,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import {
  createCriticalCommandFixture,
  makeFreshContextFactory,
} from './utils/criticalCommandFixture.js';
import type { SaveRestaurantModifierInput } from '../trpc/schemas/restaurantModifiers.js';
import type { RestaurantLineModifierInput } from '../application/restaurant/service-lifecycle.js';

let server: PuntovivoServer,
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  unitId: string,
  adminId: string,
  cashierId: string;
let admin: ReturnType<typeof makeFreshContextFactory>,
  cashier: ReturnType<typeof makeFreshContextFactory>;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  db = getDatabase();
  const owner = db.select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
  adminId = owner.id;
  tenantId = owner.tenantId;
  siteId = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get()!.id;
  unitId = db
    .select()
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
    .get()!.id;
  const tenant = db.select().from(tenants).where(eq(tenants.id, tenantId)).get()!;
  db.update(tenants)
    .set({ settings: { ...tenant.settings, modules: { 'dine-in': true } } })
    .where(eq(tenants.id, tenantId))
    .run();
  cashierId = nanoid();
  db.insert(users)
    .values({
      id: cashierId,
      tenantId,
      email: `${cashierId}@example.test`,
      name: 'Cashier',
      role: 'cashier',
      passwordHash: 'unused',
      isActive: true,
    })
    .run();
  for (const [userId, email, role] of [
    [adminId, owner.email, 'admin'],
    [cashierId, `${cashierId}@example.test`, 'cashier'],
  ] as const) {
    const fixture = await createCriticalCommandFixture({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email,
      role,
      siteId,
    });
    const factory = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email,
      defaultRole: role,
      siteId,
      deviceId: fixture.deviceId,
    });
    if (role === 'admin') admin = factory;
    else cashier = factory;
    db.insert(cashSessions)
      .values({
        id: nanoid(),
        tenantId,
        siteId,
        cashierId: userId,
        registerName: userId,
        openingFloat: 0,
        openingCountDenominations: [],
        expectedBalance: 0,
        status: 'open',
        openedAt: new Date().toISOString(),
      })
      .run();
  }
});
afterAll(async () => {
  await server.close();
});

function newInput(patch: Partial<SaveRestaurantModifierInput> = {}): SaveRestaurantModifierInput {
  return {
    siteId,
    name: `Add-on ${nanoid()}`,
    expectedVersion: 0,
    unitPriceDelta: 2.5,
    maxQuantity: 3,
    requiresManager: false,
    isActive: true,
    ...patch,
  };
}
async function create(patch: Partial<SaveRestaurantModifierInput> = {}) {
  const {
    siteId: site,
    id,
    expectedVersion,
    name,
    unitPriceDelta,
    maxQuantity,
    requiresManager,
    isActive,
  } = newInput(patch);
  return appRouter.createCaller(admin()).restaurantModifiers.save({
    siteId: site,
    ...(id ? { id } : {}),
    expectedVersion,
    name,
    unitPriceDelta,
    maxQuantity,
    requiresManager,
    isActive,
  });
}
function reference(row: Awaited<ReturnType<typeof create>>): RestaurantLineModifierInput {
  return {
    catalogId: row.id,
    catalogVersion: row.version,
    name: row.name,
    quantity: 2,
    unitPriceDelta: row.unitPriceDelta,
  };
}
async function order(modifiers: RestaurantLineModifierInput[]) {
  const productId = nanoid(),
    tableId = nanoid();
  db.insert(products)
    .values({
      id: productId,
      tenantId,
      name: 'Plate',
      sku: productId,
      price: 10,
      cost: 5,
      taxRate: 0,
    })
    .run();
  db.insert(unitXProduct)
    .values({ id: nanoid(), productId, unitId, equivalence: 1, price: 10, isBase: true })
    .run();
  db.insert(inventoryBalances)
    .values({ id: nanoid(), tenantId, siteId, productId, onHand: 10, reserved: 0 })
    .run();
  db.insert(restaurantTables)
    .values({ id: tableId, tenantId, siteId, name: tableId, seatCount: 2 })
    .run();
  return {
    tableId,
    guestCount: 1,
    items: [{ productId, unitId, quantity: 2, unitPrice: 10, discount: 0, taxRate: 0, modifiers }],
  };
}
async function rejectedWithoutSale(modifier: RestaurantLineModifierInput, error: RegExp) {
  const input = await order([modifier]);
  const before = db
    .select({ value: count() })
    .from(sales)
    .where(eq(sales.tenantId, tenantId))
    .get()!.value;
  await expect(
    appRouter.createCaller(cashier()).restaurantServices.openCheck(input)
  ).rejects.toThrow(error);
  expect(
    db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()!.value
  ).toBe(before);
  expect(
    db
      .select()
      .from(inventoryBalances)
      .where(eq(inventoryBalances.productId, input.items[0]!.productId))
      .get()
  ).toMatchObject({ onHand: 10, reserved: 0 });
}

describe('restaurant modifier catalog', () => {
  it('commits once with its audit and replays the exact configuration after subsequent changes', async () => {
    const caller = appRouter.createCaller(admin()),
      input = newInput();
    const first = await caller.restaurantModifiers.save(input);
    const updated = await create({ ...input, id: first.id, expectedVersion: 1, unitPriceDelta: 3 });
    expect(updated.version).toBe(2);
    expect(await caller.restaurantModifiers.save(input)).toEqual(first);
    expect(
      db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, first.id)))
        .all()
    ).toHaveLength(2);
    await expect(create({ ...input, id: first.id, expectedVersion: 1 })).rejects.toThrow(
      /configuration changed/
    );
    expect(
      db
        .select()
        .from(restaurantModifierCatalog)
        .where(eq(restaurantModifierCatalog.id, first.id))
        .get()!.unitPriceDelta
    ).toBe(3);
  });
  it('blocks cashier management and rechecks an actor demoted after context creation', async () => {
    await expect(
      appRouter.createCaller(cashier()).restaurantModifiers.save(newInput())
    ).rejects.toThrow();
    const stale = admin();
    db.update(users).set({ role: 'cashier' }).where(eq(users.id, adminId)).run();
    try {
      await expect(
        appRouter.createCaller(stale).restaurantModifiers.save(newInput())
      ).rejects.toThrow(/Only managers/);
    } finally {
      db.update(users).set({ role: 'admin' }).where(eq(users.id, adminId)).run();
    }
  });
  it('allows duplicate names only when archived and treats search wildcard characters literally', async () => {
    const saved = await create({ name: `Literal_%!${nanoid()}` });
    await expect(create({ name: saved.name.toUpperCase() })).rejects.toThrow(/already exists/);
    const list = await appRouter
      .createCaller(cashier())
      .restaurantModifiers.list({ siteId, search: '_%!' });
    expect(list.items.map(row => row.id)).toEqual([saved.id]);
    await create({ ...saved, expectedVersion: saved.version, isActive: false });
    expect(
      (
        await appRouter
          .createCaller(cashier())
          .restaurantModifiers.list({ siteId, includeArchived: true, search: saved.name })
      ).items
    ).toEqual([]);
    expect(
      (
        await appRouter
          .createCaller(admin())
          .restaurantModifiers.list({ siteId, includeArchived: true, search: saved.name })
      ).items
    ).toHaveLength(1);
    expect((await create({ name: saved.name })).id).not.toBe(saved.id);
  });
  it('bounds pages and prohibits foreign-site writes, reads and catalog use', async () => {
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get()!;
    const otherSite = nanoid();
    db.insert(sites)
      .values({ ...site, id: otherSite, name: 'Second site', code: nanoid() })
      .run();
    const row = await create({ siteId: otherSite });
    await expect(create({ ...row, siteId, expectedVersion: row.version })).rejects.toThrow(
      /unavailable/
    );
    await rejectedWithoutSale(reference(row), /unavailable/);
    await expect(
      appRouter.createCaller(admin()).restaurantModifiers.list({ siteId: nanoid() })
    ).rejects.toThrow();
    const first = await appRouter
      .createCaller(admin())
      .restaurantModifiers.list({ siteId, limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextOffset).toBe(1);
    const second = await appRouter
      .createCaller(admin())
      .restaurantModifiers.list({ siteId, limit: 1, offset: first.nextOffset! });
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  });
  it('does not expose another tenant catalog through a valid foreign site or guessed entry id', async () => {
    const foreignTenant = nanoid(),
      foreignSite = nanoid(),
      foreignCompany = nanoid(),
      foreignUser = nanoid(),
      foreignId = nanoid();
    db.insert(tenants).values({ id: foreignTenant, name: 'Foreign', slug: foreignTenant }).run();
    db.insert(companies)
      .values({ id: foreignCompany, tenantId: foreignTenant, name: 'Foreign company' })
      .run();
    db.insert(sites)
      .values({
        id: foreignSite,
        tenantId: foreignTenant,
        companyId: foreignCompany,
        name: 'Foreign site',
        code: 'FOREIGN',
      })
      .run();
    db.insert(users)
      .values({
        id: foreignUser,
        tenantId: foreignTenant,
        name: 'Foreign manager',
        email: `${foreignUser}@example.test`,
        role: 'manager',
        passwordHash: 'unused',
      })
      .run();
    db.insert(restaurantModifierCatalog)
      .values({
        id: foreignId,
        tenantId: foreignTenant,
        siteId: foreignSite,
        name: 'Private menu',
        nameKey: 'private menu',
        unitPriceDelta: 2.5,
        createdBy: foreignUser,
        updatedBy: foreignUser,
      })
      .run();
    await expect(
      appRouter.createCaller(admin()).restaurantModifiers.list({ siteId: foreignSite })
    ).rejects.toThrow(/Site not found/);
    await expect(create({ id: foreignId, expectedVersion: 1 })).rejects.toThrow(/unavailable/);
    await rejectedWithoutSale(
      {
        catalogId: foreignId,
        catalogVersion: 1,
        name: 'Private menu',
        quantity: 1,
        unitPriceDelta: 2.5,
      },
      /unavailable/
    );
    expect(
      (
        await appRouter
          .createCaller(cashier())
          .restaurantModifiers.list({ siteId, search: 'Private menu' })
      ).items
    ).toEqual([]);
    expect(
      db
        .select()
        .from(restaurantModifierCatalog)
        .where(eq(restaurantModifierCatalog.id, foreignId))
        .get()!.version
    ).toBe(1);
  });

  it('rejects forged name, price, version, quantity and manager-only modifiers without stock or sale writes', async () => {
    const row = await create(),
      ref = reference(row);
    for (const patch of [
      { name: 'Forged' },
      { unitPriceDelta: 0 },
      { catalogVersion: 2 },
      { quantity: 4 },
    ])
      await rejectedWithoutSale({ ...ref, ...patch }, /configuration changed/);
    await rejectedWithoutSale(
      reference(await create({ requiresManager: true })),
      /requires a manager/
    );
    await create({ ...row, expectedVersion: row.version, isActive: false });
    await rejectedWithoutSale(ref, /unavailable/);
    await rejectedWithoutSale(
      { name: 'Unapproved price', quantity: 1, unitPriceDelta: 2 },
      /catalog modifier/
    );
  });
  it('freezes per-plate catalog amounts and replays after archival without consulting live prices', async () => {
    const row = await create(),
      caller = appRouter.createCaller(cashier());
    const input = await order([reference(row)]);
    const sale = await caller.restaurantServices.openCheck(input);
    expect(sale.total).toBe(30); // Two plates × (10 + two add-ons × 2.5).
    const frozen = db
      .select()
      .from(restaurantLineModifiers)
      .where(eq(restaurantLineModifiers.catalogId, row.id))
      .all();
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toMatchObject({ catalogVersion: 1, quantity: 2, unitPriceDelta: 2.5 });
    await create({ ...row, expectedVersion: row.version, isActive: false, unitPriceDelta: 999 });
    expect((await caller.restaurantServices.openCheck(input)).id).toBe(sale.id);
    expect(
      db
        .select()
        .from(restaurantLineModifiers)
        .where(eq(restaurantLineModifiers.catalogId, row.id))
        .all()
    ).toEqual(frozen);
    const table = await appRouter
      .createCaller(cashier())
      .restaurantServices.getTableState({ tableId: input.tableId });
    expect(table.checks[0]!.total).toBe(30);
    await appRouter.createCaller(cashier()).sales.resume({ saleId: sale.id });
    const completed = await appRouter.createCaller(cashier()).sales.completeDraft({
      saleId: sale.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 30,
    });
    expect(completed.total).toBe(30);
    expect(
      db
        .select()
        .from(restaurantLineModifiers)
        .where(eq(restaurantLineModifiers.catalogId, row.id))
        .all()
    ).toEqual(frozen);
  });
  it('allows zero-price instructions and manager ad-hoc additions without fabricating provenance', async () => {
    for (const [factory, price] of [
      [cashier, 0],
      [admin, 2.5],
    ] as const) {
      const input = await order([{ name: 'Instruction', quantity: 1, unitPriceDelta: price }]);
      expect(
        (await appRouter.createCaller(factory()).restaurantServices.openCheck(input)).total
      ).toBe(20 + 2 * price);
    }
    expect(
      db
        .select()
        .from(restaurantLineModifiers)
        .where(eq(restaurantLineModifiers.name, 'Instruction'))
        .all()
        .every(row => row.catalogId === null && row.catalogVersion === null)
    ).toBe(true);
  });
});
