/** Modifier groups: editor command, plate-sheet read and the rules every order must meet. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  inventoryBalances,
  products,
  restaurantLineModifiers,
  restaurantTables,
  sales,
  sites,
  tenants,
  units,
  unitXProduct,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { validateKitchenSnapshots } from '../application/kds/snapshot.js';
import {
  createCriticalCommandFixture,
  makeFreshContextFactory,
} from './utils/criticalCommandFixture.js';
import type { SaveRestaurantModifierGroupInput } from '../trpc/schemas/restaurantModifiers.js';

let server: PuntovivoServer,
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  unitId: string,
  adminId: string;
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
  const cashierId = nanoid();
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

async function option(name: string, unitPriceDelta = 0, patch: { isActive?: boolean } = {}) {
  return appRouter.createCaller(admin()).restaurantModifiers.save({
    siteId,
    expectedVersion: 0,
    name: `${name} ${nanoid(6)}`,
    unitPriceDelta,
    maxQuantity: 3,
    requiresManager: false,
    isActive: patch.isActive ?? true,
  });
}
function dish(isActive = true) {
  const productId = nanoid();
  db.insert(products)
    .values({
      id: productId,
      tenantId,
      name: `Plate ${productId}`,
      sku: productId,
      price: 10,
      cost: 5,
      taxRate: 0,
      isActive,
    })
    .run();
  db.insert(unitXProduct)
    .values({ id: nanoid(), productId, unitId, equivalence: 1, price: 10, isBase: true })
    .run();
  db.insert(inventoryBalances)
    .values({ id: nanoid(), tenantId, siteId, productId, onHand: 10, reserved: 0 })
    .run();
  return productId;
}
function groupInput(
  patch: Partial<SaveRestaurantModifierGroupInput> &
    Pick<SaveRestaurantModifierGroupInput, 'catalogIds'>
): SaveRestaurantModifierGroupInput {
  return {
    siteId,
    expectedVersion: 0,
    name: `Group ${nanoid(6)}`,
    kind: 'choice',
    selection: 'single',
    minSelections: 1,
    maxSelections: 1,
    isActive: true,
    productIds: [],
    ...patch,
  };
}
const saveGroup = (input: SaveRestaurantModifierGroupInput) =>
  appRouter.createCaller(admin()).restaurantModifiers.saveGroup(input);

type Option = Awaited<ReturnType<typeof option>>;
function pick(row: Option, groupId?: string, quantity = 1) {
  return {
    catalogId: row.id,
    catalogVersion: row.version,
    ...(groupId ? { groupId } : {}),
    name: row.name,
    quantity,
    unitPriceDelta: row.unitPriceDelta,
  };
}
function orderInput(
  productId: string,
  modifiers: ReturnType<typeof pick>[],
  modifierGroups?: { id: string; version: number }[]
) {
  const tableId = nanoid();
  db.insert(restaurantTables)
    .values({ id: tableId, tenantId, siteId, name: tableId, seatCount: 4 })
    .run();
  return {
    tableId,
    guestCount: 1,
    items: [
      {
        productId,
        unitId,
        quantity: 1,
        unitPrice: 10,
        discount: 0,
        taxRate: 0,
        modifiers,
        ...(modifierGroups ? { modifierGroups } : {}),
      },
    ],
  };
}
const saleCount = () =>
  db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()!.value;

describe('restaurant modifier groups', () => {
  it('saves options and dishes once with audit, replays, and serves them in plate-sheet order', async () => {
    const [medio, tres, chicharron, aguacate] = await Promise.all([
      option('Medio'),
      option('Tres cuartos'),
      option('Chicharrón'),
      option('Aguacate', 4000),
    ]);
    const plate = dish();
    const extras = await saveGroup(
      groupInput({
        name: `Adicionales ${nanoid(4)}`,
        kind: 'extra',
        selection: 'multiple',
        minSelections: 0,
        maxSelections: 1,
        catalogIds: [aguacate.id],
        productIds: [plate],
      })
    );
    const doneness = groupInput({
      name: `Término ${nanoid(4)}`,
      catalogIds: [tres.id, medio.id],
      productIds: [plate],
    });
    const replaying = appRouter.createCaller(admin()).restaurantModifiers;
    const first = await replaying.saveGroup(doneness);
    expect(await replaying.saveGroup(doneness)).toEqual(first);
    const without = await saveGroup(
      groupInput({
        name: `Sin ${nanoid(4)}`,
        kind: 'without',
        selection: 'multiple',
        minSelections: 0,
        maxSelections: 1,
        catalogIds: [chicharron.id],
        productIds: [plate],
      })
    );
    expect(
      db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, first.id)))
        .all()
    ).toHaveLength(1);

    const sheet = await appRouter
      .createCaller(cashier())
      .restaurantModifiers.productGroups({ siteId, productId: plate });
    expect(sheet.map(group => group.id)).toEqual([first.id, without.id, extras.id]);
    expect(sheet[0]!.options.map(row => row.name)).toEqual([tres.name, medio.name]);
    expect(sheet[0]).not.toHaveProperty('createdBy');

    const editor = await appRouter.createCaller(admin()).restaurantModifiers.groups({ siteId });
    expect(editor.find(group => group.id === first.id)!.products.map(row => row.id)).toEqual([
      plate,
    ]);
    await expect(saveGroup({ ...doneness, id: first.id, expectedVersion: 2 })).rejects.toThrow(
      /configuration changed/
    );
  });

  it('only managers configure groups, and the rule must be satisfiable', async () => {
    const a = await option('A');
    const b = await option('B');
    await expect(
      appRouter
        .createCaller(cashier())
        .restaurantModifiers.saveGroup(groupInput({ catalogIds: [a.id] }))
    ).rejects.toThrow();
    await expect(
      saveGroup(groupInput({ maxSelections: 2, catalogIds: [a.id, b.id] }))
    ).rejects.toThrow(/Single choice/);
    const archived = await option('Archived', 0, { isActive: false });
    await expect(saveGroup(groupInput({ catalogIds: [archived.id] }))).rejects.toThrow(
      /unavailable/
    );
    const saved = await saveGroup(
      groupInput({
        selection: 'multiple',
        minSelections: 2,
        maxSelections: 2,
        catalogIds: [a.id, b.id],
      })
    );
    await appRouter.createCaller(admin()).restaurantModifiers.save({
      siteId,
      id: b.id,
      expectedVersion: b.version,
      name: b.name,
      unitPriceDelta: b.unitPriceDelta,
      maxQuantity: b.maxQuantity,
      requiresManager: false,
      isActive: false,
    });
    await expect(
      saveGroup(
        groupInput({
          id: saved.id,
          expectedVersion: saved.version,
          name: saved.name,
          selection: 'multiple',
          minSelections: 2,
          maxSelections: 2,
          catalogIds: [a.id, b.id],
        })
      )
    ).rejects.toThrow(/minimum needs/);
    await expect(
      saveGroup(groupInput({ catalogIds: [a.id], productIds: [dish(false)] }))
    ).rejects.toThrow(/dish is unavailable/);
    await expect(
      saveGroup(groupInput({ name: saved.name.toUpperCase(), catalogIds: [a.id] }))
    ).rejects.toThrow(/already exists/);
  });

  it('caps the groups one dish shows', async () => {
    const a = await option('Cap');
    const plate = dish();
    for (let index = 0; index < 8; index += 1)
      await saveGroup(groupInput({ minSelections: 0, catalogIds: [a.id], productIds: [plate] }));
    await expect(
      saveGroup(groupInput({ minSelections: 0, catalogIds: [a.id], productIds: [plate] }))
    ).rejects.toThrow(/maximum number of groups/);
  });

  it('enforces group rules on orders and freezes the group kind on each line modifier', async () => {
    const [medio, tres, chicharron] = await Promise.all([
      option('Medio'),
      option('Tres cuartos'),
      option('Chicharrón'),
    ]);
    const plate = dish();
    const doneness = await saveGroup(
      groupInput({ catalogIds: [medio.id, tres.id], productIds: [plate] })
    );
    const without = await saveGroup(
      groupInput({
        kind: 'without',
        selection: 'multiple',
        minSelections: 0,
        maxSelections: 1,
        catalogIds: [chicharron.id],
        productIds: [plate],
      })
    );
    const shown = [
      { id: doneness.id, version: doneness.version },
      { id: without.id, version: without.version },
    ];
    const caller = () => appRouter.createCaller(cashier()).restaurantServices;
    const before = saleCount();

    await expect(caller().openCheck(orderInput(plate, [], shown))).rejects.toThrow(
      /do not meet the group rule/
    );
    await expect(
      caller().openCheck(orderInput(plate, [pick(medio, doneness.id, 2)], shown))
    ).rejects.toThrow(/Choose one option once/);
    await expect(
      caller().openCheck(
        orderInput(plate, [pick(medio, doneness.id), pick(tres, doneness.id)], shown)
      )
    ).rejects.toThrow(/do not meet the group rule/);
    await expect(
      caller().openCheck(
        orderInput(plate, [pick(medio, doneness.id)], [{ id: doneness.id, version: 1 }])
      )
    ).rejects.toThrow(/configuration changed/);
    await expect(
      caller().openCheck(orderInput(plate, [pick(chicharron, doneness.id)], shown))
    ).rejects.toThrow(/configuration changed/);
    expect(saleCount()).toBe(before);

    // Paths that never show groups keep ordering; tagged options still respect the maximum.
    await caller().openCheck(orderInput(plate, []));
    await expect(
      caller().openCheck(orderInput(plate, [pick(medio, doneness.id), pick(tres, doneness.id)]))
    ).rejects.toThrow(/do not meet the group rule/);

    const sale = await caller().openCheck(
      orderInput(plate, [pick(tres, doneness.id), pick(chicharron, without.id)], shown)
    );
    expect(saleCount()).toBe(before + 2);
    const frozen = db
      .select({
        name: restaurantLineModifiers.name,
        groupId: restaurantLineModifiers.groupId,
        groupKind: restaurantLineModifiers.groupKind,
      })
      .from(restaurantLineModifiers)
      .where(eq(restaurantLineModifiers.tenantId, tenantId))
      .all()
      .filter(row => row.groupId);
    expect(frozen).toEqual(
      expect.arrayContaining([
        { name: tres.name, groupId: doneness.id, groupKind: 'choice' },
        { name: chicharron.name, groupId: without.id, groupKind: 'without' },
      ])
    );
    expect(sale.id).toBeTruthy();
  });

  it('keeps the removal kind in kitchen snapshots and accepts older ones without it', () => {
    const base = {
      saleItemId: 'item',
      productId: 'product',
      productName: 'Bandeja',
      quantity: 1,
      unitLabel: null,
      notes: null,
      roundId: null,
      roundLabel: null,
      courseKey: null,
      dinerLabel: null,
    };
    expect(
      validateKitchenSnapshots([
        { ...base, modifiers: [{ name: 'Chicharrón', quantity: 1, kind: 'without' }] },
      ])[0]!.modifiers
    ).toEqual([{ name: 'Chicharrón', quantity: 1, kind: 'without' }]);
    expect(
      validateKitchenSnapshots([{ ...base, modifiers: [{ name: 'Sal', quantity: 1 }] }])[0]!
        .modifiers
    ).toEqual([{ name: 'Sal', quantity: 1 }]);
  });
});
