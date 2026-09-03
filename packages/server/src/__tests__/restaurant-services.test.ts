/**
 * End-to-end application coverage for normalized restaurant services.
 *
 * The suite drives real tRPC callers with Command Envelopes against migrated
 * in-memory SQLite. Assertions cross the UI-facing procedure boundary and the
 * persisted sale/service/check graph so a green result proves transaction
 * rollback, replay, multiple checks and lifecycle closure rather than only
 * schema shape.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  devices,
  inventoryBalances,
  kdsOrders,
  products,
  restaurantCheckLines,
  restaurantChecks,
  restaurantCourses,
  restaurantDiners,
  restaurantLineModifiers,
  restaurantRounds,
  restaurantServices,
  restaurantTables,
  saleItems,
  sales,
  sequentials,
  sites,
  syncOutbox,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { completeSale } from '../application/sales/completeSale.js';
import { parkDraftsForIdentityChange } from '../application/sales/parkDraftsForIdentityChange.js';
import { RESTAURANT_SERVICE_LIMITS } from '../application/restaurant/service-lifecycle.js';
import { hashStaffPin } from '../security/staffPins.js';
import { __withExpectedTestLogs } from '../logging/logger.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let adminId: string;
let handoffCashierId: string;
let handoffCashierEmail: string;
let handoffCashSessionId: string;
let siteId: string;
let companyId: string;
let baseUnitId: string;
let adminDeviceId: string;
let handoffDeviceId: string;
let handoffSecondDeviceId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;
let freshHandoffCashier: ReturnType<typeof makeFreshContextFactory>;
let freshHandoffCashierSecondDevice: ReturnType<typeof makeFreshContextFactory>;

function tenantWideAdminContext() {
  const context = fresh();
  context.siteId = null;
  return context;
}

async function createTable(name: string, seatCount: number | null = 4): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(restaurantTables).values({
    id,
    tenantId,
    siteId,
    name,
    seatCount,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createProduct(name: string, price = 10, stock = 40): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name,
    sku: `REST-${nanoid(8)}`,
    price,
    price2: price,
    price3: price,
    cost: Math.max(0, price / 2),
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: Math.max(0, price / 2),
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId: id,
    unitId: baseUnitId,
    equivalence: 1,
    price,
    price2: price,
    price3: price,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId: id,
    onHand: stock,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function orderItem(
  productId: string,
  overrides: Partial<{
    quantity: number;
    unitPrice: number;
    dinerClientId: string;
    courseKey: 'starter' | 'main' | 'dessert' | 'drink' | 'other';
    modifierName: string;
    modifierPriceDelta: number;
    notes: string;
  }> = {}
) {
  const modifierName = overrides.modifierName ?? '';
  return {
    productId,
    unitId: baseUnitId,
    quantity: overrides.quantity ?? 1,
    unitPrice: overrides.unitPrice ?? 10,
    discount: 0,
    taxRate: 0,
    dinerClientId: overrides.dinerClientId ?? 'seat-1',
    courseKey: overrides.courseKey ?? ('main' as const),
    modifiers:
      modifierName.length === 0
        ? []
        : [
            {
              name: modifierName,
              quantity: 1,
              unitPriceDelta: overrides.modifierPriceDelta ?? 0,
            },
          ],
    ...(overrides.notes ? { notes: overrides.notes } : {}),
  };
}

function draftSaleItem(productId: string) {
  return {
    productId,
    unitId: baseUnitId,
    quantity: 1,
    unitPrice: 10,
    discount: 0,
    taxRate: 0,
  };
}

function openInput(args: {
  tableId: string;
  productId: string;
  guestCount?: number;
  label?: string;
  quantity?: number;
  unitPrice?: number;
  modifierName?: string;
  modifierPriceDelta?: number;
  priceTier?: 1 | 2 | 3;
}) {
  const guestCount = args.guestCount ?? 2;
  return {
    tableId: args.tableId,
    guestCount,
    ...(args.priceTier ? { priceTier: args.priceTier } : {}),
    ...(args.label ? { checkLabel: args.label } : {}),
    diners: Array.from({ length: guestCount }, (_, index) => ({
      clientId: `seat-${index + 1}`,
      seatNumber: index + 1,
    })),
    items: [
      orderItem(args.productId, {
        quantity: args.quantity,
        unitPrice: args.unitPrice,
        modifierName: args.modifierName,
        modifierPriceDelta: args.modifierPriceDelta,
      }),
    ],
  };
}

async function stockFor(productId: string): Promise<number> {
  return (
    (
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, productId)
          )
        )
        .get()
    )?.onHand ?? 0
  );
}

async function currentSaleSequence(): Promise<number> {
  const row = await db
    .select({ currentValue: sequentials.currentValue })
    .from(sequentials)
    .where(
      and(
        eq(sequentials.tenantId, tenantId),
        eq(sequentials.siteId, siteId),
        eq(sequentials.documentType, 'sale')
      )
    )
    .get();
  if (!row) throw new Error('Expected the seeded sale sequential');
  return row.currentValue;
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  db = getDatabase();
  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  adminId = admin.id;
  tenantId = admin.tenantId;
  const site = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!site) throw new Error('Expected seeded site');
  siteId = site.id;
  companyId = site.companyId;
  const unit = await db
    .select()
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
    .get();
  if (!unit) throw new Error('Expected seeded base unit');
  baseUnitId = unit.id;

  const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  const settings = tenant?.settings ?? {};
  const modules =
    typeof settings.modules === 'object' && settings.modules !== null
      ? (settings.modules as Record<string, unknown>)
      : {};
  await db
    .update(tenants)
    .set({ settings: { ...settings, modules: { ...modules, 'dine-in': true, kds: true } } })
    .where(eq(tenants.id, tenantId));

  const now = new Date().toISOString();
  handoffCashierId = nanoid();
  handoffCashierEmail = `restaurant-handoff-${nanoid(8)}@example.test`;
  await db.insert(users).values({
    id: handoffCashierId,
    tenantId,
    email: handoffCashierEmail,
    name: 'Caja de cierre',
    passwordHash: 'not-used-by-router-tests',
    role: 'cashier',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(cashSessions).values({
    id: `restaurant-session-${nanoid()}`,
    tenantId,
    siteId,
    cashierId: adminId,
    registerName: 'Restaurant integration register',
    openingFloat: 200,
    openingCountDenominations: [{ value: 100, count: 2 }],
    expectedBalance: 200,
    status: 'open',
    openedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  handoffCashSessionId = `restaurant-handoff-session-${nanoid()}`;
  await db.insert(cashSessions).values({
    id: handoffCashSessionId,
    tenantId,
    siteId,
    cashierId: handoffCashierId,
    registerName: 'Restaurant settlement register',
    openingFloat: 100,
    openingCountDenominations: [{ value: 100, count: 1 }],
    expectedBalance: 100,
    status: 'open',
    openedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const registration = await registerDeviceService(db, {
    tenantId,
    userId: adminId,
    kind: 'web',
    name: 'restaurant-services.test',
  });
  adminDeviceId = registration.deviceId;
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId: adminId,
    email: admin.email,
    defaultRole: 'admin',
    siteId,
    deviceId: registration.deviceId,
  });
  const handoffRegistration = await registerDeviceService(db, {
    tenantId,
    userId: handoffCashierId,
    kind: 'web',
    name: 'restaurant-services-handoff.test',
  });
  handoffDeviceId = handoffRegistration.deviceId;
  freshHandoffCashier = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId: handoffCashierId,
    email: handoffCashierEmail,
    defaultRole: 'cashier',
    siteId,
    deviceId: handoffRegistration.deviceId,
  });
  const handoffSecondRegistration = await registerDeviceService(db, {
    tenantId,
    userId: handoffCashierId,
    kind: 'web',
    name: 'restaurant-services-handoff-second-device.test',
  });
  handoffSecondDeviceId = handoffSecondRegistration.deviceId;
  freshHandoffCashierSecondDevice = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId: handoffCashierId,
    email: handoffCashierEmail,
    defaultRole: 'cashier',
    siteId,
    deviceId: handoffSecondRegistration.deviceId,
  });
});

it('prices a restaurant draft against the explicitly selected tier', async () => {
  const tableId = await createTable(`Mesa tier ${nanoid(5)}`);
  const productId = await createProduct('Menú mayorista');
  await db.update(products).set({ price2: 8 }).where(eq(products.id, productId));
  await db.update(unitXProduct).set({ price2: 8 }).where(eq(unitXProduct.productId, productId));

  const created = await appRouter
    .createCaller(fresh({ role: 'cashier' }))
    .restaurantServices.openCheck(
      openInput({ tableId, productId, priceTier: 2, quantity: 1, unitPrice: 8 })
    );

  expect(created).toMatchObject({ status: 'draft', priceTier: 2, total: 8 });
  expect(
    await db.select().from(saleItems).where(eq(saleItems.saleId, created.id)).get()
  ).toMatchObject({ unitPrice: 8 });
});

afterAll(async () => {
  await server.close();
});

describe('restaurantServices.openCheck', () => {
  it('parks a resumed check atomically before logout clears the operator identity', async () => {
    const tableId = await createTable(`Mesa logout ${nanoid(5)}`);
    const productId = await createProduct('Plato antes de logout');
    const caller = appRouter.createCaller(fresh({ role: 'cashier' }));
    const opened = await caller.restaurantServices.openCheck(
      openInput({ tableId, productId, label: 'Cuenta logout' })
    );

    await caller.sales.resume({ saleId: opened.id });
    expect(await db.select().from(sales).where(eq(sales.id, opened.id)).get()).toMatchObject({
      suspendedAt: null,
      resumedBy: adminId,
      resumedDeviceId: adminDeviceId,
    });
    const identityBefore = await db
      .select({ identityVersion: devices.identityVersion })
      .from(devices)
      .where(eq(devices.id, adminDeviceId))
      .get();
    if (!identityBefore) throw new Error('Expected active device identity');

    await caller.auth.logout();

    const parked = await db.select().from(sales).where(eq(sales.id, opened.id)).get();
    expect(parked).toMatchObject({
      suspendedBy: adminId,
      suspendedLabel: 'Cuenta logout',
      resumedBy: null,
      resumedDeviceId: null,
    });
    expect(parked?.suspendedAt).toEqual(expect.any(String));
    expect(
      await db
        .select({
          activeUserId: devices.activeUserId,
          identityVersion: devices.identityVersion,
        })
        .from(devices)
        .where(eq(devices.id, adminDeviceId))
        .get()
    ).toEqual({ activeUserId: null, identityVersion: identityBefore.identityVersion + 1 });
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, opened.id), eq(auditLogs.action, 'sale.park')))
        .orderBy(auditLogs.createdAt)
        .all()
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({ identityChange: 'logout' }),
        }),
      ])
    );
  });

  it('keeps identity and draft ownership unchanged when logout parking cannot commit', async () => {
    const tableId = await createTable(`Mesa rollback logout ${nanoid(5)}`);
    const productId = await createProduct('Plato rollback logout');
    const caller = appRouter.createCaller(fresh({ role: 'cashier' }));
    const opened = await caller.restaurantServices.openCheck(
      openInput({ tableId, productId, label: 'Cuenta rollback' })
    );
    await caller.sales.resume({ saleId: opened.id });
    const beforeUser = await db
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, adminId))
      .get();

    await db.run(
      sql.raw(`CREATE TRIGGER fail_identity_draft_park
        BEFORE UPDATE ON sales
        WHEN NEW.id = '${opened.id}' AND NEW.suspended_at IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'forced identity draft park failure');
        END`)
    );
    try {
      await expect(
        __withExpectedTestLogs(
          [
            { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
            { level: 'error', module: 'observability', message: 'captured exception' },
          ],
          () => caller.auth.logout()
        )
      ).rejects.toThrow(/forced identity draft park failure/);
    } finally {
      await db.run(sql.raw('DROP TRIGGER IF EXISTS fail_identity_draft_park'));
    }

    expect(await db.select().from(sales).where(eq(sales.id, opened.id)).get()).toMatchObject({
      suspendedAt: null,
      suspendedBy: null,
      resumedBy: adminId,
      resumedDeviceId: adminDeviceId,
    });
    expect(
      await db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, adminId))
        .get()
    ).toEqual(beforeUser);

    // Leave no claimed draft behind for later tests in this shared fixture.
    await caller.sales.suspend({ saleId: opened.id, tableId });
  });

  it('rolls back a draft command authenticated before logout invalidated its session', async () => {
    const productId = await createProduct('Producto comando stale');
    const beforeBalance = await db
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
    const currentUser = await db
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, adminId))
      .get();
    if (!currentUser) throw new Error('Expected authenticated user');
    const staleCaller = appRouter.createCaller(
      fresh({ role: 'cashier', sessionVersion: currentUser.sessionVersion })
    );
    await db
      .update(users)
      .set({ sessionVersion: currentUser.sessionVersion + 1 })
      .where(eq(users.id, adminId));

    try {
      await expect(
        staleCaller.sales.create({
          items: [draftSaleItem(productId)],
          paymentMethod: 'cash',
          paymentStatus: 'pending',
          status: 'draft',
          discountAmount: 0,
        })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'AUTH_IDENTITY_CHANGED' }),
      });
    } finally {
      await db
        .update(users)
        .set({ sessionVersion: currentUser.sessionVersion })
        .where(eq(users.id, adminId));
    }

    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, productId)
          )
        )
        .get()
    ).toEqual(beforeBalance);
    expect(
      await db
        .select({ value: count() })
        .from(saleItems)
        .where(eq(saleItems.productId, productId))
        .get()
    ).toEqual({ value: 0 });
  });

  it('parks only drafts claimed by the identity that logs out', async () => {
    const actorTableId = await createTable(`Mesa actor logout ${nanoid(5)}`);
    const peerTableId = await createTable(`Mesa peer activo ${nanoid(5)}`);
    const actorProductId = await createProduct('Plato actor logout');
    const peerProductId = await createProduct('Plato peer activo');
    const actorCaller = appRouter.createCaller(fresh({ role: 'cashier' }));
    const peerCaller = appRouter.createCaller(freshHandoffCashier());
    const actorDraft = await actorCaller.restaurantServices.openCheck(
      openInput({ tableId: actorTableId, productId: actorProductId, label: 'Cuenta actor' })
    );
    const peerDraft = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .restaurantServices.openCheck(
        openInput({ tableId: peerTableId, productId: peerProductId, label: 'Cuenta peer' })
      );
    await actorCaller.sales.resume({ saleId: actorDraft.id });
    await peerCaller.sales.resume({ saleId: peerDraft.id });

    await actorCaller.auth.logout();

    expect(await db.select().from(sales).where(eq(sales.id, actorDraft.id)).get()).toMatchObject({
      suspendedBy: adminId,
      resumedBy: null,
      resumedDeviceId: null,
    });
    expect(await db.select().from(sales).where(eq(sales.id, peerDraft.id)).get()).toMatchObject({
      suspendedAt: null,
      suspendedBy: null,
      resumedBy: handoffCashierId,
      resumedDeviceId: handoffDeviceId,
    });

    // The peer's still-valid identity can park its own workspace normally.
    await peerCaller.sales.suspend({ saleId: peerDraft.id, tableId: peerTableId });
  });

  it('parks the source cashier check in the same transaction as a staff switch', async () => {
    const tableId = await createTable(`Mesa staff switch ${nanoid(5)}`);
    const productId = await createProduct('Plato antes de relevo');
    const openingCaller = appRouter.createCaller(fresh({ role: 'cashier' }));
    const sourceCaller = appRouter.createCaller(freshHandoffCashier());
    const opened = await openingCaller.restaurantServices.openCheck(
      openInput({ tableId, productId, label: 'Cuenta relevo' })
    );
    await sourceCaller.sales.resume({ saleId: opened.id });

    const targetId = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: targetId,
      tenantId,
      email: `restaurant-target-${nanoid(8)}@example.test`,
      name: 'Caja siguiente',
      passwordHash: 'not-used-by-router-tests',
      staffPinHash: await hashStaffPin('246810'),
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const identityBefore = await db
      .select({ identityVersion: devices.identityVersion })
      .from(devices)
      .where(eq(devices.id, handoffDeviceId))
      .get();
    const sourceIdentity = await db
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, handoffCashierId))
      .get();
    if (!identityBefore || !sourceIdentity) throw new Error('Expected source device identity');

    await sourceCaller.auth.switchStaff({ targetUserId: targetId, pin: '246810' });

    const parked = await db.select().from(sales).where(eq(sales.id, opened.id)).get();
    expect(parked).toMatchObject({
      suspendedBy: handoffCashierId,
      suspendedLabel: 'Cuenta relevo',
      resumedBy: null,
      resumedDeviceId: null,
    });
    expect(parked?.suspendedAt).toEqual(expect.any(String));
    expect(
      await db
        .select({
          activeUserId: devices.activeUserId,
          identityVersion: devices.identityVersion,
        })
        .from(devices)
        .where(eq(devices.id, handoffDeviceId))
        .get()
    ).toEqual({
      activeUserId: targetId,
      identityVersion: identityBefore.identityVersion + 1,
    });
    await expect(
      appRouter
        .createCaller(freshHandoffCashier({ sessionVersion: sourceIdentity.sessionVersion }))
        .sales.create({
          items: [draftSaleItem(productId)],
          paymentMethod: 'cash',
          paymentStatus: 'pending',
          status: 'draft',
          discountAmount: 0,
        })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'AUTH_IDENTITY_CHANGED' }),
    });
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, opened.id), eq(auditLogs.action, 'sale.park')))
        .orderBy(auditLogs.createdAt)
        .all()
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({ identityChange: 'staff_switch' }),
        }),
      ])
    );
  });

  it('rejects a staff switch when the source session is revoked during PIN verification', async () => {
    await registerDeviceService(db, {
      tenantId,
      userId: handoffCashierId,
      kind: 'web',
      name: 'restaurant-services-switch-race.test',
      deviceId: handoffDeviceId,
      allowIdentityChange: true,
      onIdentityChange: (tx, change) => {
        parkDraftsForIdentityChange(tx, {
          tenantId,
          actorId: change.previousUserId,
          reason: 'device_rebind',
          deviceId: change.deviceId,
          now: change.now,
        });
      },
    });
    const targetId = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: targetId,
      tenantId,
      email: `restaurant-switch-race-${nanoid(8)}@example.test`,
      name: 'Caja carrera',
      passwordHash: 'not-used-by-router-tests',
      staffPinHash: await hashStaffPin('135790'),
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const source = await db
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(and(eq(users.id, handoffCashierId), eq(users.tenantId, tenantId)))
      .get();
    if (!source) throw new Error('Expected handoff cashier session');

    const switchPromise = appRouter
      .createCaller(freshHandoffCashier({ sessionVersion: source.sessionVersion }))
      .auth.switchStaff({ targetUserId: targetId, pin: '135790' });
    await db
      .update(users)
      .set({ sessionVersion: source.sessionVersion + 1 })
      .where(and(eq(users.id, handoffCashierId), eq(users.tenantId, tenantId)));

    try {
      await expect(switchPromise).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'AUTH_IDENTITY_CHANGED' }),
      });
      expect(
        await db
          .select({ activeUserId: devices.activeUserId })
          .from(devices)
          .where(and(eq(devices.id, handoffDeviceId), eq(devices.tenantId, tenantId)))
          .get()
      ).toEqual({ activeUserId: handoffCashierId });
    } finally {
      await db
        .update(users)
        .set({ sessionVersion: source.sessionVersion })
        .where(and(eq(users.id, handoffCashierId), eq(users.tenantId, tenantId)));
    }
  });

  it('parks only the switching device while logout remains actor-global', async () => {
    await registerDeviceService(db, {
      tenantId,
      userId: handoffCashierId,
      kind: 'web',
      name: 'restaurant-services-handoff.test',
      deviceId: handoffDeviceId,
      allowIdentityChange: true,
      onIdentityChange: (tx, change) => {
        parkDraftsForIdentityChange(tx, {
          tenantId,
          actorId: change.previousUserId,
          reason: 'device_rebind',
          deviceId: change.deviceId,
          now: change.now,
        });
      },
    });
    const firstTableId = await createTable(`Mesa relevo dispositivo A ${nanoid(5)}`);
    const secondTableId = await createTable(`Mesa relevo dispositivo B ${nanoid(5)}`);
    const firstProductId = await createProduct('Plato dispositivo A');
    const secondProductId = await createProduct('Plato dispositivo B');
    const openingCaller = () => appRouter.createCaller(fresh({ role: 'cashier' }));
    const firstDeviceCaller = appRouter.createCaller(freshHandoffCashier());
    const secondDeviceContext = freshHandoffCashierSecondDevice();
    const secondDeviceCaller = appRouter.createCaller(secondDeviceContext);
    const firstDraft = await openingCaller().restaurantServices.openCheck(
      openInput({ tableId: firstTableId, productId: firstProductId })
    );
    const secondDraft = await openingCaller().restaurantServices.openCheck(
      openInput({ tableId: secondTableId, productId: secondProductId })
    );
    await firstDeviceCaller.sales.resume({ saleId: firstDraft.id });
    await secondDeviceCaller.sales.resume({ saleId: secondDraft.id });

    const targetId = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: targetId,
      tenantId,
      email: `restaurant-device-target-${nanoid(8)}@example.test`,
      name: 'Caja relevo dispositivo',
      passwordHash: 'not-used-by-router-tests',
      staffPinHash: await hashStaffPin('864209'),
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await firstDeviceCaller.auth.switchStaff({ targetUserId: targetId, pin: '864209' });

    expect(await db.select().from(sales).where(eq(sales.id, firstDraft.id)).get()).toMatchObject({
      suspendedBy: handoffCashierId,
      resumedBy: null,
      resumedDeviceId: null,
    });
    expect(await db.select().from(sales).where(eq(sales.id, secondDraft.id)).get()).toMatchObject({
      suspendedAt: null,
      resumedBy: handoffCashierId,
      resumedDeviceId: handoffSecondDeviceId,
    });

    await secondDeviceCaller.auth.logout();
    expect(await db.select().from(sales).where(eq(sales.id, secondDraft.id)).get()).toMatchObject({
      suspendedBy: handoffCashierId,
      resumedBy: null,
      resumedDeviceId: null,
    });
  });

  it('enforces the active restaurant claim against the original cashier', async () => {
    const tableId = await createTable(`Mesa claim activo ${nanoid(5)}`);
    const productId = await createProduct('Plato con claim activo');
    const openingCashier = appRouter.createCaller(fresh({ role: 'cashier' }));
    const claimingCashier = appRouter.createCaller(freshHandoffCashier());
    const opened = await openingCashier.restaurantServices.openCheck(
      openInput({ tableId, productId, label: 'Cuenta con relevo' })
    );

    await claimingCashier.sales.resume({ saleId: opened.id });
    expect(await db.select().from(sales).where(eq(sales.id, opened.id)).get()).toMatchObject({
      suspendedAt: null,
      resumedBy: handoffCashierId,
      resumedDeviceId: handoffDeviceId,
    });

    await expect(
      openingCashier.sales.suspend({ saleId: opened.id, tableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED' }),
    });
    await expect(
      openingCashier.sales.completeDraft({
        saleId: opened.id,
        priceTier: 1,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 10,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED' }),
    });
    await expect(openingCashier.sales.discardDraft({ saleId: opened.id })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED' }),
    });

    expect(await db.select().from(sales).where(eq(sales.id, opened.id)).get()).toMatchObject({
      status: 'draft',
      suspendedAt: null,
      resumedBy: handoffCashierId,
      resumedDeviceId: handoffDeviceId,
    });
    await claimingCashier.sales.suspend({ saleId: opened.id, tableId });
    await claimingCashier.sales.discardDraft({ saleId: opened.id });
  });

  it('transfers an active claim exclusively when the same cashier recovers it on another device', async () => {
    const tableId = await createTable(`Mesa claim dispositivo ${nanoid(5)}`);
    const productId = await createProduct('Plato claim dispositivo');
    const openingCashier = appRouter.createCaller(fresh({ role: 'cashier' }));
    const deviceA = appRouter.createCaller(freshHandoffCashier());
    const deviceB = appRouter.createCaller(freshHandoffCashierSecondDevice());
    const opened = await openingCashier.restaurantServices.openCheck(
      openInput({ tableId, productId, label: 'Cuenta entre terminales' })
    );

    await deviceA.sales.resume({ saleId: opened.id });
    await deviceB.sales.resume({ saleId: opened.id });
    expect(await db.select().from(sales).where(eq(sales.id, opened.id)).get()).toMatchObject({
      suspendedAt: null,
      resumedBy: handoffCashierId,
      resumedDeviceId: handoffSecondDeviceId,
    });

    await expect(deviceA.sales.suspend({ saleId: opened.id, tableId })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED' }),
    });
    await expect(
      deviceA.sales.completeDraft({
        saleId: opened.id,
        priceTier: 1,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 10,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED' }),
    });
    await expect(deviceA.sales.discardDraft({ saleId: opened.id })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED' }),
    });

    expect(await db.select().from(sales).where(eq(sales.id, opened.id)).get()).toMatchObject({
      status: 'draft',
      suspendedAt: null,
      resumedBy: handoffCashierId,
      resumedDeviceId: handoffSecondDeviceId,
    });
    await deviceB.sales.suspend({ saleId: opened.id, tableId });
    await deviceB.sales.discardDraft({ saleId: opened.id });
  });

  it('claims fresh retail drafts and recovers them after local state loss', async () => {
    const productId = await createProduct('Producto retail recuperable');
    const caller = appRouter.createCaller(fresh({ role: 'cashier' }));
    const created = await caller.sales.create({
      items: [draftSaleItem(productId)],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });

    expect(await db.select().from(sales).where(eq(sales.id, created.id)).get()).toMatchObject({
      status: 'draft',
      suspendedAt: null,
      resumedBy: adminId,
      resumedDeviceId: adminDeviceId,
    });
    const activeRecovery = await caller.sales.listDrafts({ page: 1, perPage: 20 });
    expect(activeRecovery.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          suspendedAt: null,
          resumedBy: adminId,
        }),
      ])
    );

    const claimBeforeRepeat = await db
      .select({ syncVersion: sales.syncVersion })
      .from(sales)
      .where(eq(sales.id, created.id))
      .get();
    const resumeAuditsBeforeRepeat = await db
      .select({ value: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, created.id),
          eq(auditLogs.action, 'sale.resume')
        )
      )
      .get();
    const syncRowsBeforeRepeat = await db
      .select({ value: count() })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'sales'),
          eq(syncOutbox.entityId, created.id)
        )
      )
      .get();
    await caller.sales.resume({ saleId: created.id });
    const claimAfterRepeat = await db.select().from(sales).where(eq(sales.id, created.id)).get();
    expect(claimAfterRepeat).toMatchObject({
      suspendedAt: null,
      resumedBy: adminId,
      resumedDeviceId: adminDeviceId,
    });
    expect(claimAfterRepeat?.syncVersion).toBe(claimBeforeRepeat?.syncVersion);
    expect(
      await db
        .select({ value: count() })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, created.id),
            eq(auditLogs.action, 'sale.resume')
          )
        )
        .get()
    ).toEqual(resumeAuditsBeforeRepeat);
    expect(
      await db
        .select({ value: count() })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'sales'),
            eq(syncOutbox.entityId, created.id)
          )
        )
        .get()
    ).toEqual(syncRowsBeforeRepeat);

    await caller.auth.logout();
    expect(await db.select().from(sales).where(eq(sales.id, created.id)).get()).toMatchObject({
      suspendedBy: adminId,
      resumedBy: null,
      resumedDeviceId: null,
    });
    const recoveredCaller = appRouter.createCaller(fresh({ role: 'cashier' }));
    const parkedRecovery = await recoveredCaller.sales.listDrafts({ page: 1, perPage: 20 });
    expect(parkedRecovery.items.map(item => item.id)).toContain(created.id);
    await recoveredCaller.sales.discardDraft({ saleId: created.id });
  });

  it('hands an open check to a second same-site cashier without exposing retail drafts', async () => {
    const tableId = await createTable(`Mesa handoff ${nanoid(5)}`);
    const restaurantProductId = await createProduct('Plato para handoff');
    const retailProductId = await createProduct('Producto retail privado');
    const openingCashier = () => appRouter.createCaller(fresh({ role: 'cashier' }));
    const settlingCashier = () => appRouter.createCaller(freshHandoffCashier());
    const restaurantDraft = await openingCashier().restaurantServices.openCheck(
      openInput({ tableId, productId: restaurantProductId, label: 'Entrega a caja' })
    );
    const retailDraft = await openingCashier().sales.create({
      items: [draftSaleItem(retailProductId)],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });
    await openingCashier().sales.suspend({ saleId: retailDraft.id, label: 'Carrito privado' });

    const unfiltered = await settlingCashier().sales.listDrafts({ page: 1, perPage: 20 });
    expect(unfiltered.items.map(item => item.id)).not.toContain(restaurantDraft.id);
    expect(unfiltered.items.map(item => item.id)).not.toContain(retailDraft.id);

    const sameSite = await settlingCashier().sales.listDrafts({
      page: 1,
      perPage: 20,
      siteId,
    });
    expect(sameSite.items.map(item => item.id)).toContain(restaurantDraft.id);
    expect(sameSite.items.map(item => item.id)).not.toContain(retailDraft.id);
    await expect(settlingCashier().sales.resume({ saleId: retailDraft.id })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED' }),
    });

    await settlingCashier().sales.resume({ saleId: restaurantDraft.id });
    await settlingCashier().sales.suspend({ saleId: restaurantDraft.id, tableId });
    await settlingCashier().sales.resume({ saleId: restaurantDraft.id });
    const completed = await settlingCashier().sales.completeDraft({
      saleId: restaurantDraft.id,
      priceTier: 1,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 10,
    });

    expect(completed).toMatchObject({
      id: restaurantDraft.id,
      status: 'completed',
      createdBy: adminId,
      cashSessionId: handoffCashSessionId,
      cashierNameSnapshot: 'Caja de cierre',
    });
    expect(
      await db
        .select()
        .from(restaurantChecks)
        .where(eq(restaurantChecks.saleId, restaurantDraft.id))
        .get()
    ).toMatchObject({ status: 'settled', openedBy: adminId });
    expect(
      await db
        .select()
        .from(restaurantServices)
        .where(eq(restaurantServices.tableId, tableId))
        .get()
    ).toMatchObject({ status: 'closed', closedBy: handoffCashierId });
    const completionAudit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, restaurantDraft.id),
          eq(auditLogs.action, 'sale.complete')
        )
      )
      .get();
    expect(completionAudit?.metadata).toMatchObject({
      restaurantHandoff: true,
      restaurantOpenedBy: adminId,
      settledBy: handoffCashierId,
    });

    await openingCashier().sales.discardDraft({ saleId: retailDraft.id });
  });

  it('commits sale and complete service metadata once under envelope replay', async () => {
    const tableId = await createTable(`Mesa replay ${nanoid(5)}`);
    const productId = await createProduct('Hamburguesa replay');
    const input = openInput({
      tableId,
      productId,
      label: 'Cuenta familia',
      quantity: 2,
      modifierName: 'Extra queso',
      modifierPriceDelta: 2,
    });
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const caller = appRouter.createCaller(fresh({ role: 'cashier', envelope }));

    const first = await caller.restaurantServices.openCheck(input);
    const replay = await caller.restaurantServices.openCheck(input);

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({ status: 'draft', tableId, total: 24 });
    expect(await stockFor(productId)).toBe(38);

    const saleLine = await db.select().from(saleItems).where(eq(saleItems.saleId, first.id)).get();
    expect(saleLine).toMatchObject({
      unitPrice: 12,
      restaurantModifierAmount: 2,
      quantity: 2,
      total: 24,
    });
    const service = await db
      .select()
      .from(restaurantServices)
      .where(
        and(eq(restaurantServices.tenantId, tenantId), eq(restaurantServices.tableId, tableId))
      )
      .get();
    expect(service).toMatchObject({ status: 'open', guestCount: 2 });
    const check = await db
      .select()
      .from(restaurantChecks)
      .where(eq(restaurantChecks.saleId, first.id))
      .get();
    expect(check).toMatchObject({
      serviceId: service?.id,
      label: 'Cuenta familia',
      status: 'open',
    });
    const visibleDrafts = await caller.sales.listDrafts({
      page: 1,
      perPage: 10,
      search: 'familia',
    });
    expect(visibleDrafts.items).toEqual([
      expect.objectContaining({
        id: first.id,
        suspendedLabel: expect.any(String),
        restaurantCheckLabel: 'Cuenta familia',
        restaurantCheckId: check!.id,
      }),
    ]);
    expect(
      await db
        .select({ value: count() })
        .from(restaurantDiners)
        .where(eq(restaurantDiners.serviceId, service!.id))
        .get()
    ).toMatchObject({ value: 2 });
    expect(
      await db
        .select()
        .from(restaurantCourses)
        .where(eq(restaurantCourses.checkId, check!.id))
        .get()
    ).toMatchObject({ courseKey: 'main' });
    expect(
      await db.select().from(restaurantRounds).where(eq(restaurantRounds.checkId, check!.id)).get()
    ).toMatchObject({ sequence: 1, status: 'submitted' });
    const checkLine = await db
      .select()
      .from(restaurantCheckLines)
      .where(eq(restaurantCheckLines.checkId, check!.id))
      .get();
    expect(checkLine?.dinerId).not.toBeNull();
    expect(
      await db
        .select()
        .from(restaurantLineModifiers)
        .where(eq(restaurantLineModifiers.checkLineId, checkLine!.id))
        .get()
    ).toMatchObject({ name: 'Extra queso', unitPriceDelta: 2, quantity: 1 });
    const parkAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, first.id),
          eq(auditLogs.action, 'sale.park')
        )
      )
      .all();
    expect(parkAudits).toHaveLength(1);

    const kitchenOrders = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, first.id)))
      .all();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0]).toMatchObject({
      tableId,
      tableLabel: expect.stringContaining('Mesa replay'),
      status: 'pending',
      station: 'main',
    });
    expect(JSON.parse(kitchenOrders[0]!.itemsJson)).toEqual([
      expect.objectContaining({ productName: 'Hamburguesa replay', quantity: 2 }),
    ]);
  });

  it('rejects a check beyond the bounded service projection and rolls back the sale', async () => {
    const tableId = await createTable(`Mesa check bound ${nanoid(5)}`, 1);
    const productId = await createProduct('Servicio check bound');
    await db.update(products).set({ tracksStock: false }).where(eq(products.id, productId));
    const first = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId, productId, guestCount: 1 }));
    const service = await db
      .select({ id: restaurantServices.id })
      .from(restaurantServices)
      .where(
        and(
          eq(restaurantServices.tenantId, tenantId),
          eq(restaurantServices.tableId, tableId),
          eq(restaurantServices.status, 'open')
        )
      )
      .get();
    if (!service) throw new Error('Expected open restaurant service');

    const now = new Date().toISOString();
    const filler = Array.from({ length: RESTAURANT_SERVICE_LIMITS.openChecks - 1 }, (_, index) => ({
      saleId: nanoid(),
      checkId: nanoid(),
      saleNumber: `RST-CAP-${index}-${nanoid(8)}`,
    }));
    await db.insert(sales).values(
      filler.map(row => ({
        id: row.saleId,
        tenantId,
        saleNumber: row.saleNumber,
        tableId,
        createdBy: adminId,
        suspendedAt: now,
        suspendedBy: adminId,
        createdAt: now,
        updatedAt: now,
      }))
    );
    await db.insert(restaurantChecks).values(
      filler.map(row => ({
        id: row.checkId,
        tenantId,
        serviceId: service.id,
        saleId: row.saleId,
        openedBy: adminId,
        openedAt: now,
        createdAt: now,
        updatedAt: now,
      }))
    );

    const salesBefore =
      db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()?.value ??
      0;
    const sequenceBefore = await currentSaleSequence();
    try {
      await expect(
        appRouter
          .createCaller(fresh())
          .restaurantServices.openCheck(openInput({ tableId, productId, guestCount: 1 }))
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
          details: { maximumOpenChecks: RESTAURANT_SERVICE_LIMITS.openChecks },
        }),
      });
      expect(
        db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()?.value
      ).toBe(salesBefore);
      expect(await currentSaleSequence()).toBe(sequenceBefore);
      expect(
        await db
          .select({ value: count() })
          .from(restaurantChecks)
          .where(
            and(
              eq(restaurantChecks.tenantId, tenantId),
              eq(restaurantChecks.serviceId, service.id),
              eq(restaurantChecks.status, 'open')
            )
          )
          .get()
      ).toMatchObject({ value: RESTAURANT_SERVICE_LIMITS.openChecks });
    } finally {
      await db.delete(restaurantChecks).where(
        inArray(
          restaurantChecks.id,
          filler.map(row => row.checkId)
        )
      );
      await db.delete(sales).where(
        inArray(
          sales.id,
          filler.map(row => row.saleId)
        )
      );
    }
    expect(await db.select().from(sales).where(eq(sales.id, first.id)).get()).toBeDefined();
  });

  it('uses the same rounded modifier units for the sale total and frozen metadata', async () => {
    const tableId = await createTable(`Mesa modifier rounding ${nanoid(5)}`);
    const productId = await createProduct('Producto modifier rounding');
    const created = await appRouter.createCaller(fresh()).restaurantServices.openCheck({
      tableId,
      guestCount: 1,
      diners: [{ clientId: 'seat-1', seatNumber: 1 }],
      items: [
        {
          ...orderItem(productId),
          modifiers: [{ name: 'Micro ajuste', quantity: 2, unitPriceDelta: 0.005 }],
        },
      ],
    });

    expect(created).toMatchObject({ total: 10.02 });
    expect(
      await db.select().from(saleItems).where(eq(saleItems.saleId, created.id)).get()
    ).toMatchObject({ unitPrice: 10.02, restaurantModifierAmount: 0.02, total: 10.02 });
    const storedModifier = await db
      .select()
      .from(restaurantLineModifiers)
      .innerJoin(
        restaurantCheckLines,
        eq(restaurantCheckLines.id, restaurantLineModifiers.checkLineId)
      )
      .innerJoin(restaurantChecks, eq(restaurantChecks.id, restaurantCheckLines.checkId))
      .where(eq(restaurantChecks.saleId, created.id))
      .get();
    expect(storedModifier).toMatchObject({
      restaurant_line_modifiers: { quantity: 2, unitPriceDelta: 0.01 },
    });
    expect(() =>
      db
        .update(restaurantLineModifiers)
        .set({ unitPriceDelta: 0.005 })
        .where(eq(restaurantLineModifiers.id, storedModifier!.restaurant_line_modifiers.id))
        .run()
    ).toThrow(/chk_restaurant_modifiers_price_2dec|CHECK constraint/i);
  });

  it('rolls back a direct application call whose structured modifier snapshot disagrees', async () => {
    const tableId = await createTable(`Mesa modifier boundary ${nanoid(5)}`);
    const productId = await createProduct('Producto modifier boundary');
    const stockBefore = await stockFor(productId);
    const sequenceBefore = await currentSaleSequence();
    const saleCountBefore =
      (await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get())
        ?.value ?? 0;

    await expect(
      completeSale(
        {
          db,
          tenantId,
          siteId,
          user: { id: adminId, role: 'admin' },
          envelope: null,
          deviceId: null,
        },
        {
          mode: 'fresh',
          customerId: null,
          items: [
            {
              productId,
              unitId: baseUnitId,
              quantity: 1,
              unitPrice: 11,
              discount: 0,
              taxRate: 0,
              restaurantModifierAmount: 1,
            },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'pending',
          status: 'draft',
          discountAmount: 0,
          tableId,
          restaurant: {
            tableId,
            guestCount: 1,
            diners: [{ clientId: 'seat-1', seatNumber: 1 }],
            lines: [
              {
                itemIndex: 0,
                dinerClientId: 'seat-1',
                courseKey: 'main',
                modifiers: [{ name: 'Extra', quantity: 1, unitPriceDelta: 2 }],
              },
            ],
          },
        }
      )
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
    });
    expect(await stockFor(productId)).toBe(stockBefore);
    expect(await currentSaleSequence()).toBe(sequenceBefore);
    expect(
      await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()
    ).toMatchObject({ value: saleCountBefore });
  });

  it('fails closed when structured modifiers drift from the frozen sale amount', async () => {
    const tableId = await createTable(`Mesa modifier drift ${nanoid(5)}`);
    const productId = await createProduct('Producto modifier drift');
    const created = await appRouter.createCaller(fresh()).restaurantServices.openCheck(
      openInput({
        tableId,
        productId,
        guestCount: 1,
        modifierName: 'Extra',
        modifierPriceDelta: 2,
      })
    );
    const item = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, created.id))
      .get();

    await db
      .update(saleItems)
      .set({ restaurantModifierAmount: 1 })
      .where(eq(saleItems.id, item!.id));
    try {
      await expect(
        appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
      });
    } finally {
      await db
        .update(saleItems)
        .set({ restaurantModifierAmount: 2 })
        .where(eq(saleItems.id, item!.id));
    }
  });

  it('reuses service diners and returns every simultaneous check', async () => {
    const tableId = await createTable(`Mesa multi ${nanoid(5)}`, 4);
    const productId = await createProduct('Entrada multi');
    const first = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .restaurantServices.openCheck(
        openInput({ tableId, productId, guestCount: 2, label: 'Cuenta A' })
      );
    const second = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .restaurantServices.openCheck(
        openInput({ tableId, productId, guestCount: 2, label: 'Cuenta B' })
      );
    await db
      .update(saleItems)
      .set({ productNameSnapshot: null })
      .where(eq(saleItems.saleId, first.id));

    const state = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .restaurantServices.getTableState({ tableId });
    expect(state.service).toMatchObject({ status: 'open', guestCount: 2 });
    expect(state.diners).toHaveLength(2);
    expect(state.checks.map(check => check.saleId)).toEqual([first.id, second.id]);
    expect(state.checks.map(check => check.label)).toEqual(['Cuenta A', 'Cuenta B']);
    expect(state.checks.every(check => check.lines.length === 1)).toBe(true);
    expect(state.checks.flatMap(check => check.lines.map(line => line.productName))).toEqual([
      'Entrada multi',
      'Entrada multi',
    ]);

    await expect(
      appRouter
        .createCaller(fresh({ role: 'viewer' }))
        .restaurantServices.getTableState({ tableId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('fails closed on an unnormalized table draft until the legacy suspend path adopts it', async () => {
    const tableId = await createTable(`Mesa orphan draft ${nanoid(5)}`, 4);
    const productId = await createProduct('Producto orphan draft');
    const orphan = await appRouter.createCaller(fresh()).sales.create({
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 10,
          discount: 0,
          taxRate: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
      tableId,
    });
    const stockAfterOrphan = await stockFor(productId);
    const sequenceAfterOrphan = await currentSaleSequence();
    const saleCountAfterOrphan =
      (await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get())
        ?.value ?? 0;

    await expect(
      appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
    });
    await expect(
      appRouter
        .createCaller(fresh())
        .restaurantServices.openCheck(openInput({ tableId, productId, guestCount: 1 }))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
    });
    expect(await stockFor(productId)).toBe(stockAfterOrphan);
    expect(await currentSaleSequence()).toBe(sequenceAfterOrphan);
    expect(
      await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()
    ).toMatchObject({ value: saleCountAfterOrphan });

    await appRouter
      .createCaller(fresh())
      .sales.suspend({ saleId: orphan.id, tableId, label: 'Cuenta recuperada' });
    const recovered = await appRouter
      .createCaller(fresh())
      .restaurantServices.getTableState({ tableId });
    expect(recovered.checks).toEqual([
      expect.objectContaining({
        saleId: orphan.id,
        label: expect.stringContaining('Mesa orphan draft'),
      }),
    ]);
  });

  it('rolls back sale, stock and sequential when capacity or guest state rejects', async () => {
    const smallTableId = await createTable(`Mesa small ${nanoid(5)}`, 1);
    const productId = await createProduct('Producto rollback', 10, 5);
    const salesBefore = (
      await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()
    )?.value;
    const sequenceBefore = await currentSaleSequence();

    await expect(
      appRouter
        .createCaller(fresh())
        .restaurantServices.openCheck(
          openInput({ tableId: smallTableId, productId, guestCount: 2 })
        )
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_CAPACITY_EXCEEDED' }),
    });
    expect(await stockFor(productId)).toBe(5);
    expect(await currentSaleSequence()).toBe(sequenceBefore);
    expect(
      await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()
    ).toMatchObject({ value: salesBefore });
    expect(
      await db
        .select()
        .from(restaurantServices)
        .where(eq(restaurantServices.tableId, smallTableId))
        .get()
    ).toBeUndefined();

    const tableId = await createTable(`Mesa guest lock ${nanoid(5)}`, 4);
    await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId, productId, guestCount: 2 }));
    const stockBeforeConflict = await stockFor(productId);
    const sequenceBeforeConflict = await currentSaleSequence();
    await expect(
      appRouter
        .createCaller(fresh())
        .restaurantServices.openCheck(openInput({ tableId, productId, guestCount: 3 }))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_GUEST_COUNT_CONFLICT' }),
    });
    expect(await stockFor(productId)).toBe(stockBeforeConflict);
    expect(await currentSaleSequence()).toBe(sequenceBeforeConflict);
  });

  it('bounds active diners across every check in the same service', async () => {
    const tableId = await createTable(`Mesa diner bound ${nanoid(5)}`, 2);
    const productId = await createProduct('Diner bound item');
    const anonymousInput = (clientId: string) => ({
      tableId,
      guestCount: 2,
      diners: [{ clientId }],
      items: [orderItem(productId, { dinerClientId: clientId })],
    });

    await appRouter.createCaller(fresh()).restaurantServices.openCheck(anonymousInput('guest-a'));
    await appRouter.createCaller(fresh()).restaurantServices.openCheck(anonymousInput('guest-b'));
    const stockBeforeRejection = await stockFor(productId);
    const sequenceBeforeRejection = await currentSaleSequence();

    await expect(
      appRouter.createCaller(fresh()).restaurantServices.openCheck(anonymousInput('guest-c'))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_DINER_INVALID' }),
    });
    expect(await stockFor(productId)).toBe(stockBeforeRejection);
    expect(await currentSaleSequence()).toBe(sequenceBeforeRejection);
    const service = await db
      .select({ id: restaurantServices.id })
      .from(restaurantServices)
      .where(and(eq(restaurantServices.tableId, tableId), eq(restaurantServices.status, 'open')))
      .get();
    expect(
      await db
        .select({ value: count() })
        .from(restaurantDiners)
        .where(eq(restaurantDiners.serviceId, service!.id))
        .get()
    ).toMatchObject({ value: 2 });
  });

  it('bounds the unpaginated service projection and rolls back the rejected sale', async () => {
    const tableId = await createTable(`Mesa projection bound ${nanoid(5)}`, 1);
    const productId = await createProduct('Servicio projection bound');
    await db.update(products).set({ tracksStock: false }).where(eq(products.id, productId));
    const modifiers = Array.from({ length: 20 }, (_, index) => ({
      name: `Opción ${index + 1}`,
      quantity: 1,
      unitPriceDelta: 0,
    }));
    const largeInput = {
      tableId,
      guestCount: 1,
      diners: [{ clientId: 'seat-1', seatNumber: 1 }],
      items: Array.from({ length: 200 }, () => ({
        ...orderItem(productId),
        modifiers,
      })),
    };
    await appRouter.createCaller(fresh()).restaurantServices.openCheck(largeInput);
    const service = await db
      .select({ id: restaurantServices.id })
      .from(restaurantServices)
      .where(
        and(
          eq(restaurantServices.tenantId, tenantId),
          eq(restaurantServices.tableId, tableId),
          eq(restaurantServices.status, 'open')
        )
      )
      .get();
    if (!service) throw new Error('Expected bounded open restaurant service');
    const salesBefore =
      (await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get())
        ?.value ?? 0;
    const sequenceBefore = await currentSaleSequence();

    await expect(
      appRouter.createCaller(fresh()).restaurantServices.openCheck({
        tableId,
        guestCount: 1,
        diners: [{ clientId: 'seat-1', seatNumber: 1 }],
        items: [
          {
            ...orderItem(productId),
            modifiers: [{ name: 'Una opción más', quantity: 1, unitPriceDelta: 0 }],
          },
        ],
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED' }),
    });
    expect(
      await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()
    ).toMatchObject({ value: salesBefore });
    expect(await currentSaleSequence()).toBe(sequenceBefore);

    const sourceTableId = await createTable(`Mesa projection source ${nanoid(5)}`, 1);
    const source = await appRouter.createCaller(fresh()).restaurantServices.openCheck({
      tableId: sourceTableId,
      guestCount: 1,
      diners: [{ clientId: 'seat-1', seatNumber: 1 }],
      items: [
        {
          ...orderItem(productId),
          modifiers: [{ name: 'Mover opción', quantity: 1, unitPriceDelta: 0 }],
        },
        orderItem(productId),
      ],
    });
    const sourceLine = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, source.id))
      .get();

    await expect(
      appRouter.createCaller(fresh()).sales.changeTable({ saleId: source.id, tableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'RESTAURANT_SERVICE_PARTY_REASSIGNMENT_REQUIRED',
      }),
    });
    expect(await db.select().from(sales).where(eq(sales.id, source.id)).get()).toMatchObject({
      tableId: sourceTableId,
    });

    // A normalized split cannot use a different service merely to bypass a
    // target projection bound: its shared party has no implicit allocation.
    const salesBeforeSplit =
      (await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get())
        ?.value ?? 0;
    const sequenceBeforeSplit = await currentSaleSequence();
    await expect(
      appRouter.createCaller(fresh()).sales.splitDraft({
        sourceSaleId: source.id,
        saleItemIds: [sourceLine!.id],
        tableId,
        label: 'No debe persistir',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'RESTAURANT_SERVICE_PARTY_REASSIGNMENT_REQUIRED',
      }),
    });
    expect(
      await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()
    ).toMatchObject({ value: salesBeforeSplit });
    expect(await currentSaleSequence()).toBe(sequenceBeforeSplit);
    expect(
      await db.select().from(saleItems).where(eq(saleItems.id, sourceLine!.id)).get()
    ).toMatchObject({ saleId: source.id });

    // The compatibility create-then-suspend route must honor the same bound.
    // Fill the remaining 800 line slots with four valid checks, then prove
    // that a legacy client cannot grow the projection to 1,001 rows.
    for (let checkIndex = 0; checkIndex < 4; checkIndex += 1) {
      await appRouter.createCaller(fresh()).restaurantServices.openCheck({
        tableId,
        guestCount: 1,
        diners: [{ clientId: 'seat-1', seatNumber: 1 }],
        items: Array.from({ length: 200 }, () => orderItem(productId)),
      });
    }
    const legacyDraft = await appRouter.createCaller(fresh()).sales.create({
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 10,
          discount: 0,
          taxRate: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });
    await expect(
      appRouter
        .createCaller(fresh())
        .sales.suspend({ saleId: legacyDraft.id, tableId, label: 'No debe persistir' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED' }),
    });
    expect(await db.select().from(sales).where(eq(sales.id, legacyDraft.id)).get()).toMatchObject({
      suspendedAt: null,
      suspendedLabel: null,
      tableId: null,
    });
    expect(
      await db
        .select({ value: count() })
        .from(restaurantChecks)
        .where(eq(restaurantChecks.saleId, legacyDraft.id))
        .get()
    ).toMatchObject({ value: 0 });

    const boundedCheck = await db
      .select({ id: restaurantChecks.id })
      .from(restaurantChecks)
      .where(eq(restaurantChecks.serviceId, service!.id))
      .get();
    const legacySaleItem = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, legacyDraft.id))
      .get();
    const oversizedLineId = nanoid();
    await db.insert(restaurantCheckLines).values({
      id: oversizedLineId,
      tenantId,
      checkId: boundedCheck!.id,
      saleItemId: legacySaleItem!.id,
      createdAt: new Date().toISOString(),
    });
    try {
      await expect(
        appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED' }),
      });
    } finally {
      await db.delete(restaurantCheckLines).where(eq(restaurantCheckLines.id, oversizedLineId));
    }

    const now = new Date().toISOString();
    const extraDiners = Array.from({ length: 200 }, () => ({
      id: nanoid(),
      tenantId,
      serviceId: service.id,
      label: null,
      seatNumber: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }));
    await db
      .update(restaurantServices)
      .set({ guestCount: null })
      .where(eq(restaurantServices.id, service.id));
    await db.insert(restaurantDiners).values(extraDiners);
    try {
      await expect(
        appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED' }),
      });
    } finally {
      await db.delete(restaurantDiners).where(
        inArray(
          restaurantDiners.id,
          extraDiners.map(diner => diner.id)
        )
      );
      await db
        .update(restaurantServices)
        .set({ guestCount: 1 })
        .where(eq(restaurantServices.id, service.id));
    }

    const extraRounds = Array.from({ length: 996 }, (_, index) => ({
      id: nanoid(),
      tenantId,
      checkId: boundedCheck!.id,
      sequence: index + 2,
      label: null,
      status: 'submitted' as const,
      submittedBy: adminId,
      submittedAt: now,
      createdAt: now,
    }));
    await db.insert(restaurantRounds).values(extraRounds);
    try {
      await expect(
        appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED' }),
      });
    } finally {
      await db.delete(restaurantRounds).where(
        inArray(
          restaurantRounds.id,
          extraRounds.map(round => round.id)
        )
      );
    }
  });

  it('fails closed when dine-in is disabled for the tenant', async () => {
    const tableId = await createTable(`Mesa disabled ${nanoid(5)}`);
    const productId = await createProduct('Producto disabled');
    const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
    if (!tenant) throw new Error('Expected tenant');
    const originalSettings = tenant.settings ?? {};
    const modules =
      typeof originalSettings.modules === 'object' && originalSettings.modules !== null
        ? (originalSettings.modules as Record<string, unknown>)
        : {};
    await db
      .update(tenants)
      .set({ settings: { ...originalSettings, modules: { ...modules, 'dine-in': false } } })
      .where(eq(tenants.id, tenantId));
    const legacyDraft = await appRouter.createCaller(fresh()).sales.create({
      items: [draftSaleItem(productId)],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });
    try {
      await expect(
        appRouter
          .createCaller(fresh())
          .restaurantServices.openCheck(openInput({ tableId, productId }))
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'MODULE_NOT_ACTIVATED' }),
      });
      await expect(
        appRouter.createCaller(fresh()).sales.create({
          items: [draftSaleItem(productId)],
          paymentMethod: 'cash',
          paymentStatus: 'pending',
          status: 'draft',
          discountAmount: 0,
          tableId,
        })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'MODULE_NOT_ACTIVATED' }),
      });
      await expect(
        appRouter.createCaller(fresh()).sales.suspend({ saleId: legacyDraft.id, tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'MODULE_NOT_ACTIVATED' }),
      });

      await appRouter
        .createCaller(fresh())
        .sales.suspend({ saleId: legacyDraft.id, label: 'Pedido de mostrador' });
      await expect(
        appRouter.createCaller(fresh()).sales.changeTable({ saleId: legacyDraft.id, tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'MODULE_NOT_ACTIVATED' }),
      });
      const legacyLine = await db
        .select({ id: saleItems.id })
        .from(saleItems)
        .where(eq(saleItems.saleId, legacyDraft.id))
        .get();
      if (!legacyLine) throw new Error('Expected legacy draft line');
      await expect(
        appRouter.createCaller(fresh()).sales.splitDraft({
          sourceSaleId: legacyDraft.id,
          saleItemIds: [legacyLine.id],
          tableId,
        })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'MODULE_NOT_ACTIVATED' }),
      });
    } finally {
      await db.update(tenants).set({ settings: originalSettings }).where(eq(tenants.id, tenantId));
      await appRouter.createCaller(fresh()).sales.discardDraft({ saleId: legacyDraft.id });
    }
  });

  it('hides a same-tenant table outside the active site', async () => {
    const now = new Date().toISOString();
    const otherSiteId = nanoid();
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId,
      name: `Other restaurant site ${nanoid(5)}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const otherTableId = nanoid();
    await db.insert(restaurantTables).values({
      id: otherTableId,
      tenantId,
      siteId: otherSiteId,
      name: `Other site table ${nanoid(5)}`,
      seatCount: 4,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      appRouter
        .createCaller(fresh({ siteId }))
        .restaurantServices.getTableState({ tableId: otherTableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_NOT_FOUND' }),
    });
  });

  it('does not expose operational state for an archived table', async () => {
    const tableId = await createTable(`Mesa archived state ${nanoid(5)}`);
    await db
      .update(restaurantTables)
      .set({ isActive: false })
      .where(eq(restaurantTables.id, tableId));

    await expect(
      appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_NOT_FOUND' }),
    });
  });

  it('fails closed when a service site contradicts its physical table', async () => {
    const tableId = await createTable(`Mesa service site ${nanoid(5)}`);
    const productId = await createProduct('Producto service site');
    const opened = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId, productId }));
    const service = await db
      .select()
      .from(restaurantServices)
      .where(and(eq(restaurantServices.tableId, tableId), eq(restaurantServices.status, 'open')))
      .get();
    if (!service) throw new Error('Expected open restaurant service');
    const now = new Date().toISOString();
    const otherSiteId = nanoid();
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId,
      name: `Contradictory service site ${nanoid(5)}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(restaurantServices)
      .set({ siteId: otherSiteId })
      .where(eq(restaurantServices.id, service.id));
    try {
      await expect(
        appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
      });
    } finally {
      await db
        .update(restaurantServices)
        .set({ siteId })
        .where(eq(restaurantServices.id, service.id));
    }

    await db.update(sales).set({ tableId: null }).where(eq(sales.id, opened.id));
    try {
      await expect(
        appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
      });
    } finally {
      await db.update(sales).set({ tableId }).where(eq(sales.id, opened.id));
    }

    const sale = await db
      .select({ cashSessionId: sales.cashSessionId })
      .from(sales)
      .where(eq(sales.id, opened.id))
      .get();
    if (!sale?.cashSessionId) throw new Error('Expected restaurant cash session');
    await db
      .update(cashSessions)
      .set({ siteId: otherSiteId })
      .where(eq(cashSessions.id, sale.cashSessionId));
    try {
      await expect(
        appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
      });
    } finally {
      await db.update(cashSessions).set({ siteId }).where(eq(cashSessions.id, sale.cashSessionId));
    }
  });

  it('fails closed when a check line points at another sale aggregate', async () => {
    const firstTableId = await createTable(`Mesa integrity A ${nanoid(5)}`);
    const secondTableId = await createTable(`Mesa integrity B ${nanoid(5)}`);
    const productId = await createProduct('Producto integrity');
    const first = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId: firstTableId, productId }));
    const second = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId: secondTableId, productId }));
    const firstCheck = await db
      .select({ id: restaurantChecks.id })
      .from(restaurantChecks)
      .where(eq(restaurantChecks.saleId, first.id))
      .get();
    const secondLine = await db
      .select({
        id: restaurantCheckLines.id,
        tenantId: restaurantCheckLines.tenantId,
        checkId: restaurantCheckLines.checkId,
        saleItemId: restaurantCheckLines.saleItemId,
        roundId: restaurantCheckLines.roundId,
        courseId: restaurantCheckLines.courseId,
        dinerId: restaurantCheckLines.dinerId,
        createdAt: restaurantCheckLines.createdAt,
      })
      .from(restaurantCheckLines)
      .innerJoin(restaurantChecks, eq(restaurantChecks.id, restaurantCheckLines.checkId))
      .where(eq(restaurantChecks.saleId, second.id))
      .get();
    if (!firstCheck || !secondLine) throw new Error('Expected restaurant check lines');
    const originalSecondLine = secondLine;
    const corruptLineId = nanoid();
    await db.delete(restaurantCheckLines).where(eq(restaurantCheckLines.id, originalSecondLine.id));
    await db.insert(restaurantCheckLines).values({
      id: corruptLineId,
      tenantId,
      checkId: firstCheck.id,
      saleItemId: originalSecondLine.saleItemId,
      createdAt: new Date().toISOString(),
    });

    try {
      await expect(
        appRouter
          .createCaller(fresh({ role: 'cashier' }))
          .restaurantServices.getTableState({ tableId: firstTableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
      });
    } finally {
      await db.delete(restaurantCheckLines).where(eq(restaurantCheckLines.id, corruptLineId));
      await db.insert(restaurantCheckLines).values(originalSecondLine);
    }
  });

  it('fails closed when line metadata belongs to another restaurant aggregate', async () => {
    const firstTableId = await createTable(`Mesa metadata A ${nanoid(5)}`);
    const secondTableId = await createTable(`Mesa metadata B ${nanoid(5)}`);
    const productId = await createProduct('Producto metadata integrity');
    const first = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId: firstTableId, productId }));
    const second = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId: secondTableId, productId }));
    const firstLine = await db
      .select({
        id: restaurantCheckLines.id,
        roundId: restaurantCheckLines.roundId,
        courseId: restaurantCheckLines.courseId,
        dinerId: restaurantCheckLines.dinerId,
      })
      .from(restaurantCheckLines)
      .innerJoin(restaurantChecks, eq(restaurantChecks.id, restaurantCheckLines.checkId))
      .where(eq(restaurantChecks.saleId, first.id))
      .get();
    const secondLine = await db
      .select({
        roundId: restaurantCheckLines.roundId,
        courseId: restaurantCheckLines.courseId,
        dinerId: restaurantCheckLines.dinerId,
      })
      .from(restaurantCheckLines)
      .innerJoin(restaurantChecks, eq(restaurantChecks.id, restaurantCheckLines.checkId))
      .where(eq(restaurantChecks.saleId, second.id))
      .get();
    if (!firstLine || !secondLine?.roundId || !secondLine.courseId || !secondLine.dinerId) {
      throw new Error('Expected complete restaurant line metadata');
    }

    const assertRejected = async () => {
      await expect(
        appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId: firstTableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
      });
    };
    await db
      .update(restaurantCheckLines)
      .set({ roundId: secondLine.roundId })
      .where(eq(restaurantCheckLines.id, firstLine.id));
    await assertRejected();
    await db
      .update(restaurantCheckLines)
      .set({ roundId: firstLine.roundId, courseId: secondLine.courseId })
      .where(eq(restaurantCheckLines.id, firstLine.id));
    await assertRejected();
    await db
      .update(restaurantCheckLines)
      .set({ courseId: firstLine.courseId, dinerId: secondLine.dinerId })
      .where(eq(restaurantCheckLines.id, firstLine.id));
    await assertRejected();
    await db
      .update(restaurantCheckLines)
      .set({ dinerId: firstLine.dinerId })
      .where(eq(restaurantCheckLines.id, firstLine.id));
  });

  it('fails closed when an open line references an inactive diner', async () => {
    const tableId = await createTable(`Mesa inactive diner ${nanoid(5)}`);
    const productId = await createProduct('Producto inactive diner');
    const opened = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId, productId }));
    const line = await db
      .select({ dinerId: restaurantCheckLines.dinerId })
      .from(restaurantCheckLines)
      .innerJoin(restaurantChecks, eq(restaurantChecks.id, restaurantCheckLines.checkId))
      .where(eq(restaurantChecks.saleId, opened.id))
      .get();
    if (!line?.dinerId) throw new Error('Expected a referenced restaurant diner');

    await db
      .update(restaurantDiners)
      .set({ isActive: false })
      .where(eq(restaurantDiners.id, line.dinerId));
    try {
      await expect(
        appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId })
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
      });
    } finally {
      await db
        .update(restaurantDiners)
        .set({ isActive: true })
        .where(eq(restaurantDiners.id, line.dinerId));
    }
  });
});

describe('restaurant check lifecycle', () => {
  it('moves the normalized check when a resumed sale is parked at another table', async () => {
    const sourceTableId = await createTable(`Mesa repark source ${nanoid(5)}`);
    const targetTableId = await createTable(`Mesa repark target ${nanoid(5)}`);
    const productId = await createProduct('Plato repark');
    const created = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .restaurantServices.openCheck(openInput({ tableId: sourceTableId, productId }));
    const sourceService = await db
      .select()
      .from(restaurantServices)
      .where(
        and(
          eq(restaurantServices.tenantId, tenantId),
          eq(restaurantServices.tableId, sourceTableId),
          eq(restaurantServices.status, 'open')
        )
      )
      .get();

    await appRouter.createCaller(fresh({ role: 'cashier' })).sales.resume({ saleId: created.id });
    const parked = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .sales.suspend({ saleId: created.id, tableId: targetTableId });

    expect(parked).toMatchObject({ tableId: targetTableId, suspendedAt: expect.any(String) });
    const movedCheck = await db
      .select({ tableId: restaurantServices.tableId })
      .from(restaurantChecks)
      .innerJoin(restaurantServices, eq(restaurantServices.id, restaurantChecks.serviceId))
      .where(and(eq(restaurantChecks.tenantId, tenantId), eq(restaurantChecks.saleId, created.id)))
      .get();
    expect(movedCheck).toMatchObject({ tableId: targetTableId });
    expect(
      await db
        .select()
        .from(restaurantServices)
        .where(eq(restaurantServices.id, sourceService!.id))
        .get()
    ).toMatchObject({ status: 'open', tableId: targetTableId, closedBy: null });
  });

  it('completes a modifier-priced check without inventing a price override', async () => {
    const tableId = await createTable(`Mesa modifier checkout ${nanoid(5)}`);
    const productId = await createProduct('Plato con modificador', 10);
    const caller = appRouter.createCaller(fresh({ role: 'cashier' }));
    const created = await caller.restaurantServices.openCheck(
      openInput({
        tableId,
        productId,
        modifierName: 'Extra proteína',
        modifierPriceDelta: 2,
      })
    );

    const resumed = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .sales.resume({ saleId: created.id });
    expect(resumed.items).toEqual([
      expect.objectContaining({
        unitPrice: 12,
        restaurantModifierAmount: 2,
        priceEdited: false,
      }),
    ]);

    const preflight = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .lossPrevention.evaluateCheckout({
        saleId: created.id,
        priceTier: 1,
        discountAmount: 0,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 12,
            discount: 0,
          },
        ],
      });
    expect(preflight.requiredActions).not.toContain('sale_price_override');

    const completed = await appRouter.createCaller(fresh({ role: 'cashier' })).sales.completeDraft({
      saleId: created.id,
      priceTier: 1,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 12,
    });
    expect(completed).toMatchObject({ status: 'completed', total: 12 });
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.saleId, created.id)).get()
    ).toMatchObject({ status: 'settled' });
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, created.id),
            eq(auditLogs.action, 'sale.price_override')
          )
        )
        .get()
    ).toBeUndefined();
  });

  it('rejects table reads and settlement when a frozen sale line loses its check metadata', async () => {
    const tableId = await createTable(`Mesa missing line ${nanoid(5)}`);
    const productId = await createProduct('Plato missing line', 10);
    const caller = appRouter.createCaller(fresh({ role: 'cashier' }));
    const created = await caller.restaurantServices.openCheck(openInput({ tableId, productId }));
    await caller.sales.resume({ saleId: created.id });

    const line = await db
      .select()
      .from(restaurantCheckLines)
      .innerJoin(restaurantChecks, eq(restaurantChecks.id, restaurantCheckLines.checkId))
      .where(eq(restaurantChecks.saleId, created.id))
      .get();
    if (!line) throw new Error('Expected restaurant check line');
    await db
      .delete(restaurantCheckLines)
      .where(eq(restaurantCheckLines.id, line.restaurant_check_lines.id));

    await expect(caller.restaurantServices.getTableState({ tableId })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
    });
    await expect(
      caller.sales.completeDraft({
        saleId: created.id,
        priceTier: 1,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 10,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_STATE_INVALID' }),
    });
    expect(await db.select().from(sales).where(eq(sales.id, created.id)).get()).toMatchObject({
      status: 'draft',
    });
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.saleId, created.id)).get()
    ).toMatchObject({ status: 'open' });

    await db.insert(restaurantCheckLines).values(line.restaurant_check_lines);
    await expect(
      caller.sales.completeDraft({
        saleId: created.id,
        priceTier: 1,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 10,
      })
    ).resolves.toMatchObject({ status: 'completed', total: 10 });
  });

  it('rejects checkout from a cash session outside the table service site', async () => {
    const tableId = await createTable(`Mesa cross-site checkout ${nanoid(5)}`);
    const productId = await createProduct('Plato cross-site checkout');
    const created = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId, productId }));
    await appRouter.createCaller(fresh()).sales.resume({ saleId: created.id });

    const now = new Date().toISOString();
    const otherSiteId = nanoid();
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId,
      name: `Checkout site ${nanoid(5)}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(cashSessions).values({
      id: nanoid(),
      tenantId,
      siteId: otherSiteId,
      cashierId: adminId,
      registerName: `Cross-site register ${nanoid(5)}`,
      openingFloat: 0,
      openingCountDenominations: [],
      expectedBalance: 0,
      status: 'open',
      openedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      appRouter.createCaller(fresh({ siteId: otherSiteId })).sales.completeDraft({
        saleId: created.id,
        priceTier: 1,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 10,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_DRAFT_SITE_MISMATCH' }),
    });
    expect(await db.select().from(sales).where(eq(sales.id, created.id)).get()).toMatchObject({
      status: 'draft',
      cashSessionId: expect.stringMatching(/^restaurant-session-/),
    });
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.saleId, created.id)).get()
    ).toMatchObject({ status: 'open' });

    await appRouter.createCaller(fresh()).sales.discardDraft({ saleId: created.id });
  });

  it('discards a historical check from another active site using its service site', async () => {
    const tableId = await createTable(`Mesa historical discard ${nanoid(5)}`);
    const productId = await createProduct('Plato historical discard');
    const created = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId, productId, quantity: 2 }));
    expect(await stockFor(productId)).toBe(38);

    // Migration 0058 can normalize historical drafts that predate the
    // mandatory cash-session binding. Model that persisted shape explicitly:
    // the service/table still identify the inventory site authoritatively.
    await db.update(sales).set({ cashSessionId: null }).where(eq(sales.id, created.id));

    const now = new Date().toISOString();
    const otherSiteId = nanoid();
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId,
      name: `Manager active site ${nanoid(5)}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      appRouter
        .createCaller(fresh({ siteId: otherSiteId }))
        .sales.discardDraft({ saleId: created.id })
    ).resolves.toMatchObject({ id: created.id, status: 'cancelled' });
    expect(await stockFor(productId)).toBe(40);
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.saleId, created.id)).get()
    ).toMatchObject({ status: 'cancelled' });
    expect(
      await db
        .select()
        .from(restaurantServices)
        .where(eq(restaurantServices.tableId, tableId))
        .get()
    ).toMatchObject({ siteId, status: 'closed' });
  });

  it('keeps the service open until its last check settles or is cancelled', async () => {
    const tableId = await createTable(`Mesa close ${nanoid(5)}`);
    const productId = await createProduct('Plato lifecycle');
    const first = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId, productId, label: 'Primera' }));
    const second = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId, productId, label: 'Segunda' }));
    const service = await db
      .select()
      .from(restaurantServices)
      .where(and(eq(restaurantServices.tableId, tableId), eq(restaurantServices.status, 'open')))
      .get();

    await appRouter.createCaller(fresh()).sales.resume({ saleId: first.id });
    await appRouter.createCaller(fresh()).sales.completeDraft({
      saleId: first.id,
      priceTier: 1,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 10,
    });
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.saleId, first.id)).get()
    ).toMatchObject({ status: 'settled' });
    expect(
      await db.select().from(restaurantServices).where(eq(restaurantServices.id, service!.id)).get()
    ).toMatchObject({ status: 'open', closedAt: null });
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.resourceId, first.id),
            eq(auditLogs.action, 'sale.price_override')
          )
        )
        .get()
    ).toBeUndefined();

    await appRouter.createCaller(fresh()).sales.discardDraft({ saleId: second.id });
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.saleId, second.id)).get()
    ).toMatchObject({ status: 'cancelled' });
    expect(
      await db.select().from(restaurantServices).where(eq(restaurantServices.id, service!.id)).get()
    ).toMatchObject({ status: 'closed', closedBy: adminId });
    const visible = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .restaurantServices.getTableState({ tableId });
    expect(visible).toMatchObject({ service: null, diners: [], checks: [] });
  });

  it('keeps the remaining open check with a settled sibling at the original table', async () => {
    const sourceTableId = await createTable(`Mesa settled sibling ${nanoid(5)}`);
    const targetTableId = await createTable(`Mesa settled target ${nanoid(5)}`);
    const productId = await createProduct('Plato settled sibling');
    const first = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(
        openInput({ tableId: sourceTableId, productId, label: 'Pagada' })
      );
    const second = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(
        openInput({ tableId: sourceTableId, productId, label: 'Pendiente' })
      );
    const service = await db
      .select()
      .from(restaurantServices)
      .where(
        and(
          eq(restaurantServices.tenantId, tenantId),
          eq(restaurantServices.tableId, sourceTableId),
          eq(restaurantServices.status, 'open')
        )
      )
      .get();
    if (!service) throw new Error('Expected a shared restaurant service');

    await appRouter.createCaller(fresh()).sales.resume({ saleId: first.id });
    await appRouter.createCaller(fresh()).sales.completeDraft({
      saleId: first.id,
      priceTier: 1,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 10,
    });

    await expect(
      appRouter
        .createCaller(fresh())
        .sales.changeTable({ saleId: second.id, tableId: targetTableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'RESTAURANT_SERVICE_PARTY_REASSIGNMENT_REQUIRED',
        details: expect.objectContaining({ sourceCheckCount: 2 }),
      }),
    });

    expect(await db.select().from(sales).where(eq(sales.id, first.id)).get()).toMatchObject({
      status: 'completed',
      tableId: sourceTableId,
    });
    expect(await db.select().from(sales).where(eq(sales.id, second.id)).get()).toMatchObject({
      status: 'draft',
      tableId: sourceTableId,
    });
    expect(
      await db.select().from(restaurantServices).where(eq(restaurantServices.id, service.id)).get()
    ).toMatchObject({ status: 'open', tableId: sourceTableId, version: service.version });
  });

  it('preserves course, round, diner and modifiers when a check is split', async () => {
    const tableId = await createTable(`Mesa split ${nanoid(5)}`);
    const starterId = await createProduct('Entrada split', 8);
    const mainId = await createProduct('Fuerte split', 14);
    const created = await appRouter.createCaller(fresh()).restaurantServices.openCheck({
      tableId,
      guestCount: 2,
      priceTier: 2,
      checkLabel: 'Cuenta origen',
      diners: [
        { clientId: 'seat-1', seatNumber: 1 },
        { clientId: 'seat-2', seatNumber: 2 },
      ],
      items: [
        orderItem(starterId, { unitPrice: 8, dinerClientId: 'seat-1', courseKey: 'starter' }),
        orderItem(mainId, {
          unitPrice: 14,
          dinerClientId: 'seat-2',
          courseKey: 'main',
          modifierName: 'Salsa aparte',
          modifierPriceDelta: 1,
        }),
      ],
    });
    const mainLine = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(and(eq(saleItems.saleId, created.id), eq(saleItems.productId, mainId)))
      .get();
    const result = await appRouter.createCaller(fresh()).sales.splitDraft({
      sourceSaleId: created.id,
      saleItemIds: [mainLine!.id],
      tableId: null,
      label: 'Cuenta comensal 2',
    });

    expect(result.created).toMatchObject({
      tableId,
      priceTier: 2,
      suspendedLabel: 'Cuenta comensal 2',
    });
    const sourceCheck = await db
      .select()
      .from(restaurantChecks)
      .where(eq(restaurantChecks.saleId, created.id))
      .get();
    const splitCheck = await db
      .select()
      .from(restaurantChecks)
      .where(eq(restaurantChecks.saleId, result.created.id))
      .get();
    expect(splitCheck).toMatchObject({
      serviceId: sourceCheck?.serviceId,
      label: 'Cuenta comensal 2',
    });
    const movedMetadata = await db
      .select()
      .from(restaurantCheckLines)
      .where(eq(restaurantCheckLines.saleItemId, mainLine!.id))
      .get();
    expect(movedMetadata).toMatchObject({ checkId: splitCheck?.id });
    expect(movedMetadata?.courseId).not.toBeNull();
    expect(movedMetadata?.roundId).not.toBeNull();
    expect(movedMetadata?.dinerId).not.toBeNull();
    expect(
      await db
        .select()
        .from(restaurantCourses)
        .where(eq(restaurantCourses.id, movedMetadata!.courseId!))
        .get()
    ).toMatchObject({ checkId: splitCheck?.id, courseKey: 'main' });
    expect(
      await db
        .select()
        .from(restaurantRounds)
        .where(eq(restaurantRounds.id, movedMetadata!.roundId!))
        .get()
    ).toMatchObject({ checkId: splitCheck?.id, sequence: 1, status: 'submitted' });
    expect(
      await db
        .select()
        .from(restaurantLineModifiers)
        .where(eq(restaurantLineModifiers.checkLineId, movedMetadata!.id))
        .get()
    ).toMatchObject({ name: 'Salsa aparte', unitPriceDelta: 1 });

    const remainingLine = await db
      .select({ saleItemId: restaurantCheckLines.saleItemId })
      .from(restaurantCheckLines)
      .where(eq(restaurantCheckLines.checkId, sourceCheck!.id))
      .get();
    const saleCountBeforeRejectedSplit =
      (await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get())
        ?.value ?? 0;
    const sequenceBeforeRejectedSplit = await currentSaleSequence();
    await expect(
      appRouter.createCaller(fresh()).sales.splitDraft({
        sourceSaleId: created.id,
        saleItemIds: [remainingLine!.saleItemId],
        tableId: null,
        label: 'No debe dejar cuenta vacía',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_LINES_INVALID' }),
    });
    expect(
      await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()
    ).toMatchObject({ value: saleCountBeforeRejectedSplit });
    expect(await currentSaleSequence()).toBe(sequenceBeforeRejectedSplit);
    expect(
      await db.select().from(saleItems).where(eq(saleItems.id, remainingLine!.saleItemId)).get()
    ).toMatchObject({ saleId: created.id });
  });

  it('rejects a move that exceeds capacity, then moves the whole check atomically', async () => {
    const sourceTableId = await createTable(`Mesa move source ${nanoid(5)}`, 6);
    const smallTableId = await createTable(`Mesa move small ${nanoid(5)}`, 2);
    const occupiedTableId = await createTable(`Mesa move occupied ${nanoid(5)}`, 6);
    const targetTableId = await createTable(`Mesa move target ${nanoid(5)}`, 6);
    const productId = await createProduct('Plato move');
    await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(
        openInput({ tableId: occupiedTableId, productId, guestCount: 3 })
      );
    const created = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(
        openInput({ tableId: sourceTableId, productId, guestCount: 4 })
      );
    const sourceService = await db
      .select()
      .from(restaurantServices)
      .where(
        and(eq(restaurantServices.tableId, sourceTableId), eq(restaurantServices.status, 'open'))
      )
      .get();

    await expect(
      appRouter
        .createCaller(fresh())
        .sales.changeTable({ saleId: created.id, tableId: smallTableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_CAPACITY_EXCEEDED' }),
    });
    expect(await db.select().from(sales).where(eq(sales.id, created.id)).get()).toMatchObject({
      tableId: sourceTableId,
    });

    await expect(
      appRouter
        .createCaller(fresh())
        .sales.changeTable({ saleId: created.id, tableId: occupiedTableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'RESTAURANT_SERVICE_PARTY_REASSIGNMENT_REQUIRED',
      }),
    });
    expect(await db.select().from(sales).where(eq(sales.id, created.id)).get()).toMatchObject({
      tableId: sourceTableId,
    });

    await appRouter
      .createCaller(fresh())
      .sales.changeTable({ saleId: created.id, tableId: targetTableId });
    expect(await db.select().from(sales).where(eq(sales.id, created.id)).get()).toMatchObject({
      tableId: targetTableId,
    });
    const movedService = await db
      .select()
      .from(restaurantServices)
      .where(eq(restaurantServices.id, sourceService!.id))
      .get();
    expect(movedService).toMatchObject({
      id: sourceService!.id,
      tableId: targetTableId,
      guestCount: 4,
      status: 'open',
      version: sourceService!.version + 1,
    });
    const movedCheck = await db
      .select()
      .from(restaurantChecks)
      .where(eq(restaurantChecks.saleId, created.id))
      .get();
    expect(movedCheck?.serviceId).toBe(sourceService?.id);
    const movedLine = await db
      .select()
      .from(restaurantCheckLines)
      .where(eq(restaurantCheckLines.checkId, movedCheck!.id))
      .get();
    expect(movedLine?.dinerId).not.toBeNull();
  });

  it('rejects implicit party splits or merges during table reassignment', async () => {
    const sourceTableId = await createTable(`Mesa shared source ${nanoid(5)}`, 6);
    const targetTableId = await createTable(`Mesa empty target ${nanoid(5)}`, 6);
    const occupiedTableId = await createTable(`Mesa occupied target ${nanoid(5)}`, 6);
    const productId = await createProduct('Plato shared move');
    const first = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(
        openInput({ tableId: sourceTableId, productId, guestCount: 2, label: 'Cuenta A' })
      );
    const second = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(
        openInput({ tableId: sourceTableId, productId, guestCount: 2, label: 'Cuenta B' })
      );
    await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(
        openInput({ tableId: occupiedTableId, productId, guestCount: 2 })
      );

    await expect(
      appRouter
        .createCaller(fresh())
        .sales.changeTable({ saleId: first.id, tableId: targetTableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'RESTAURANT_SERVICE_PARTY_REASSIGNMENT_REQUIRED',
      }),
    });
    expect(await db.select().from(sales).where(eq(sales.id, first.id)).get()).toMatchObject({
      tableId: sourceTableId,
    });
    expect(await db.select().from(sales).where(eq(sales.id, second.id)).get()).toMatchObject({
      tableId: sourceTableId,
    });

    const soloTableId = await createTable(`Mesa solo source ${nanoid(5)}`, 6);
    const solo = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId: soloTableId, productId, guestCount: 2 }));
    await expect(
      appRouter
        .createCaller(fresh())
        .sales.changeTable({ saleId: solo.id, tableId: occupiedTableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'RESTAURANT_SERVICE_PARTY_REASSIGNMENT_REQUIRED',
      }),
    });
    expect(await db.select().from(sales).where(eq(sales.id, solo.id)).get()).toMatchObject({
      tableId: soloTableId,
    });
  });

  it('keeps normalized check splits at their current table service', async () => {
    const sourceTableId = await createTable(`Mesa split party ${nanoid(5)}`, 4);
    const targetTableId = await createTable(`Mesa split target ${nanoid(5)}`, 4);
    const firstProductId = await createProduct('Entrada split party');
    const secondProductId = await createProduct('Fuerte split party');
    const created = await appRouter.createCaller(fresh()).restaurantServices.openCheck({
      tableId: sourceTableId,
      guestCount: 2,
      diners: [
        { clientId: 'seat-1', seatNumber: 1 },
        { clientId: 'seat-2', seatNumber: 2 },
      ],
      items: [
        orderItem(firstProductId, { dinerClientId: 'seat-1' }),
        orderItem(secondProductId, { dinerClientId: 'seat-2' }),
      ],
    });
    const item = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(and(eq(saleItems.saleId, created.id), eq(saleItems.productId, firstProductId)))
      .get();
    const salesBefore =
      (await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get())
        ?.value ?? 0;
    const sequenceBefore = await currentSaleSequence();

    await expect(
      appRouter.createCaller(fresh()).sales.splitDraft({
        sourceSaleId: created.id,
        saleItemIds: [item!.id],
        tableId: targetTableId,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'RESTAURANT_SERVICE_PARTY_REASSIGNMENT_REQUIRED',
      }),
    });
    expect(
      await db.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)).get()
    ).toMatchObject({ value: salesBefore });
    expect(await currentSaleSequence()).toBe(sequenceBefore);
    expect(await db.select().from(saleItems).where(eq(saleItems.id, item!.id)).get()).toMatchObject(
      {
        saleId: created.id,
      }
    );
  });

  it('prevents deactivation or an impossible capacity while a service is open', async () => {
    const tableId = await createTable(`Mesa guarded ${nanoid(5)}`, 6);
    const productId = await createProduct('Plato guarded');
    const created = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId, productId, guestCount: 4 }));
    const admin = appRouter.createCaller(fresh());

    await expect(
      admin.restaurantTables.update({ id: tableId, isActive: false })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_HAS_OPEN_SERVICE' }),
    });
    await expect(admin.restaurantTables.archive({ id: tableId })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_HAS_OPEN_SERVICE' }),
    });
    await expect(
      admin.restaurantTables.update({ id: tableId, seatCount: 3 })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SERVICE_CAPACITY_EXCEEDED' }),
    });
    expect(
      await db.select().from(restaurantTables).where(eq(restaurantTables.id, tableId)).get()
    ).toMatchObject({
      isActive: true,
      seatCount: 6,
    });

    await admin.sales.discardDraft({ saleId: created.id });
    await expect(admin.restaurantTables.archive({ id: tableId })).resolves.toMatchObject({
      isActive: false,
    });
  });

  it('normalizes a historical draft when it moves onto an occupied table', async () => {
    const sourceTableId = await createTable(`Mesa legacy move source ${nanoid(5)}`);
    const targetTableId = await createTable(`Mesa legacy move target ${nanoid(5)}`);
    const productId = await createProduct('Plato legacy move');
    const occupied = await appRouter
      .createCaller(fresh())
      .restaurantServices.openCheck(openInput({ tableId: targetTableId, productId }));
    const legacy = await appRouter.createCaller(fresh()).sales.create({
      tableId: sourceTableId,
      items: [draftSaleItem(productId)],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });
    const suspendedAt = new Date().toISOString();
    await db
      .update(sales)
      .set({
        cashSessionId: null,
        suspendedAt,
        suspendedBy: adminId,
        suspendedLabel: 'Cuenta histórica',
      })
      .where(eq(sales.id, legacy.id));
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.saleId, legacy.id)).get()
    ).toBeUndefined();

    await appRouter
      .createCaller(tenantWideAdminContext())
      .sales.changeTable({ saleId: legacy.id, tableId: targetTableId });

    const occupiedCheck = await db
      .select()
      .from(restaurantChecks)
      .where(eq(restaurantChecks.saleId, occupied.id))
      .get();
    const adoptedCheck = await db
      .select()
      .from(restaurantChecks)
      .where(eq(restaurantChecks.saleId, legacy.id))
      .get();
    expect(adoptedCheck).toMatchObject({
      serviceId: occupiedCheck?.serviceId,
      status: 'open',
    });
    expect(
      await db
        .select({ value: count() })
        .from(restaurantCheckLines)
        .where(eq(restaurantCheckLines.checkId, adoptedCheck!.id))
        .get()
    ).toMatchObject({ value: 1 });
    await expect(
      appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId: targetTableId })
    ).resolves.toMatchObject({ checks: [{ saleId: occupied.id }, { saleId: legacy.id }] });
  });

  it('normalizes a historical table draft before splitting its lines', async () => {
    const tableId = await createTable(`Mesa legacy split ${nanoid(5)}`);
    const firstProductId = await createProduct('Entrada legacy split');
    const secondProductId = await createProduct('Fuerte legacy split');
    const legacy = await appRouter.createCaller(fresh()).sales.create({
      tableId,
      items: [draftSaleItem(firstProductId), draftSaleItem(secondProductId)],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });
    await db
      .update(sales)
      .set({
        cashSessionId: null,
        suspendedAt: new Date().toISOString(),
        suspendedBy: adminId,
        suspendedLabel: 'Cuenta histórica',
      })
      .where(eq(sales.id, legacy.id));
    const movedItem = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(and(eq(saleItems.saleId, legacy.id), eq(saleItems.productId, secondProductId)))
      .get();

    const split = await appRouter.createCaller(tenantWideAdminContext()).sales.splitDraft({
      sourceSaleId: legacy.id,
      saleItemIds: [movedItem!.id],
      tableId: null,
      label: 'Cuenta separada',
    });

    const sourceCheck = await db
      .select()
      .from(restaurantChecks)
      .where(eq(restaurantChecks.saleId, legacy.id))
      .get();
    const splitCheck = await db
      .select()
      .from(restaurantChecks)
      .where(eq(restaurantChecks.saleId, split.created.id))
      .get();
    expect(sourceCheck).toMatchObject({ status: 'open' });
    expect(splitCheck).toMatchObject({
      serviceId: sourceCheck?.serviceId,
      status: 'open',
      label: 'Cuenta separada',
    });
    expect(
      await db
        .select()
        .from(restaurantCheckLines)
        .where(eq(restaurantCheckLines.saleItemId, movedItem!.id))
        .get()
    ).toMatchObject({ checkId: splitCheck?.id });
    const tableState = await appRouter
      .createCaller(fresh())
      .restaurantServices.getTableState({ tableId });
    expect(new Set(tableState.checks.map(check => check.saleId))).toEqual(
      new Set([legacy.id, split.created.id])
    );
  });

  it('never treats a destination table or active site as legacy draft provenance', async () => {
    const tableId = await createTable(`Mesa unknown provenance ${nanoid(5)}`);
    const productId = await createProduct('Plato unknown provenance');
    const caller = appRouter.createCaller(fresh());
    const draft = await caller.sales.create({
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 10,
          discount: 0,
          taxRate: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });
    const persisted = await db.select().from(sales).where(eq(sales.id, draft.id)).get();
    if (!persisted?.cashSessionId) throw new Error('Expected the draft reserving session');
    const stockAfterReservation = await stockFor(productId);
    await db
      .update(sales)
      .set({ cashSessionId: null, tableId: null })
      .where(eq(sales.id, draft.id));

    const tenantAdmin = appRouter.createCaller(tenantWideAdminContext());
    await expect(
      tenantAdmin.sales.suspend({ saleId: draft.id, tableId, label: 'Mesa elegida después' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_DRAFT_SITE_UNKNOWN' }),
    });
    expect(await db.select().from(sales).where(eq(sales.id, draft.id)).get()).toMatchObject({
      cashSessionId: null,
      tableId: null,
      suspendedAt: null,
    });
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.saleId, draft.id)).all()
    ).toHaveLength(0);
    expect(await stockFor(productId)).toBe(stockAfterReservation);

    const now = new Date().toISOString();
    await db
      .update(sales)
      .set({ suspendedAt: now, suspendedBy: adminId })
      .where(eq(sales.id, draft.id));
    await expect(
      tenantAdmin.sales.changeTable({ saleId: draft.id, tableId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_DRAFT_SITE_UNKNOWN' }),
    });
    await expect(caller.sales.discardDraft({ saleId: draft.id })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_DRAFT_SITE_UNKNOWN' }),
    });
    await expect(
      caller.sales.resume({ saleId: draft.id }).then(() =>
        caller.sales.completeDraft({
          saleId: draft.id,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          amountReceived: 10,
        })
      )
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SALE_DRAFT_SITE_UNKNOWN' }),
    });
    expect(await stockFor(productId)).toBe(stockAfterReservation);

    await db
      .update(sales)
      .set({ cashSessionId: persisted.cashSessionId, suspendedAt: now, suspendedBy: adminId })
      .where(eq(sales.id, draft.id));
    await caller.sales.discardDraft({ saleId: draft.id });
    expect(await stockFor(productId)).toBe(stockAfterReservation + 1);
  });
});
