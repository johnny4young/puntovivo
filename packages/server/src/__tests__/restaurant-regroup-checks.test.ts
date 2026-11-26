import { toHumanSessionIdentity } from '../security/session-identity.js';
/**
 * `restaurantServices.regroupChecks`: lines move between the open checks of a
 * table, new accounts open drafts, emptied checks are cancelled and the money
 * owed by the table never changes.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
  customers,
  inventoryBalances,
  kdsOrderLines,
  products,
  restaurantCheckLines,
  restaurantChecks,
  restaurantRounds,
  restaurantServices,
  restaurantTables,
  saleItems,
  salePayments,
  sales,
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

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let adminId: string;
let siteId: string;
let baseUnitId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

const manager = () => appRouter.createCaller(fresh({ role: 'manager' }));

async function createTable(name: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(restaurantTables).values({
    id,
    tenantId,
    siteId,
    name,
    seatCount: 6,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createProduct(name: string, price: number): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name,
    sku: `SPLIT-${nanoid(8)}`,
    price,
    price2: price,
    price3: price,
    cost: price / 2,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: price / 2,
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
    onHand: 500,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

interface Plate {
  price: number;
  /** Seat number of the diner, or null for a shared plate. */
  seat: number | null;
}

/** Send one round: a new check whose sale items come back in plate order. */
async function sendRound(tableId: string, plates: Plate[]) {
  const items = [];
  for (const plate of plates) {
    items.push({
      productId: await createProduct(`Plato ${nanoid(5)}`, plate.price),
      unitId: baseUnitId,
      quantity: 1,
      unitPrice: plate.price,
      discount: 0,
      taxRate: 0,
      dinerClientId: plate.seat === null ? null : `seat-${plate.seat}`,
      courseKey: 'main' as const,
      modifiers: [],
    });
  }
  const sale = await appRouter
    .createCaller(fresh({ role: 'cashier' }))
    .restaurantServices.openCheck({
      tableId,
      guestCount: 3,
      diners: [1, 2, 3].map(seat => ({ clientId: `seat-${seat}`, seatNumber: seat })),
      items,
    });
  const check = await db
    .select()
    .from(restaurantChecks)
    .where(eq(restaurantChecks.saleId, sale.id))
    .get();
  if (!check) throw new Error('Expected the round to open a check');
  const rows = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).all();
  const itemIds = items.map(item => {
    const row = rows.find(candidate => candidate.productId === item.productId);
    if (!row) throw new Error('Expected a sale item per plate');
    return row.id;
  });
  return { saleId: sale.id, checkId: check.id, itemIds };
}

async function tableState(tableId: string) {
  return appRouter.createCaller(fresh()).restaurantServices.getTableState({ tableId });
}

async function saleRow(saleId: string) {
  const row = await db.select().from(sales).where(eq(sales.id, saleId)).get();
  if (!row) throw new Error('Expected the sale');
  return row;
}

async function totalOf(saleIds: string[]): Promise<number> {
  const rows = await db.select().from(sales).where(inArray(sales.id, saleIds)).all();
  return Math.round(rows.reduce((sum, row) => sum + row.total * 100, 0));
}

async function auditCount(serviceId: string): Promise<number> {
  return (
    (
      await db
        .select({ value: count() })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'restaurant.checks.regrouped'),
            eq(auditLogs.resourceId, serviceId)
          )
        )
        .get()
    )?.value ?? 0
  );
}

const sorted = (ids: string[]) => [...ids].sort();

/** The open checks and versions a screen would send with its plan. */
async function views(tableId: string) {
  return (await tableState(tableId)).checks.map(check => ({
    checkId: check.id,
    version: check.version,
  }));
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
  await db.insert(cashSessions).values({
    id: `regroup-session-${nanoid()}`,
    tenantId,
    siteId,
    cashierId: adminId,
    registerName: 'Regroup register',
    openingFloat: 200,
    openingCountDenominations: [{ value: 100, count: 2 }],
    expectedBalance: 200,
    status: 'open',
    openedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const registration = await registerDeviceService(db, {
    tenantId,
    userId: adminId,
    kind: 'web',
    name: 'restaurant-regroup-checks.test',
  });
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId: adminId,
    email: toHumanSessionIdentity(admin).email,
    defaultRole: 'admin',
    siteId,
    deviceId: registration.deviceId,
  });
});

afterAll(async () => {
  await server.close();
});

describe('restaurantServices.regroupChecks', () => {
  it('regroups three round-checks into one check per diner and cancels the spare', async () => {
    const tableId = await createTable(`Mesa comensal ${nanoid(5)}`);
    const first = await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 2 },
    ]);
    const second = await sendRound(tableId, [{ price: 5, seat: 1 }]);
    const third = await sendRound(tableId, [{ price: 7, seat: 2 }]);
    const saleIds = [first.saleId, second.saleId, third.saleId];
    const before = await totalOf(saleIds);
    const secondRound = await db
      .select()
      .from(restaurantRounds)
      .where(eq(restaurantRounds.checkId, second.checkId))
      .get();

    const result = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: { kind: 'byDiner' },
    });

    expect(result.cancelledCheckIds).toEqual([second.checkId]);
    expect(result.checks.map(check => check.checkId)).toEqual([first.checkId, third.checkId]);
    expect(sorted(result.checks[0]!.saleItemIds)).toEqual(
      sorted([first.itemIds[0]!, second.itemIds[0]!])
    );
    expect(sorted(result.checks[1]!.saleItemIds)).toEqual(
      sorted([first.itemIds[1]!, third.itemIds[0]!])
    );
    expect(result.checks.map(check => check.total)).toEqual([15, 27]);
    expect(await totalOf(saleIds)).toBe(before);

    expect(await saleRow(second.saleId)).toMatchObject({
      status: 'cancelled',
      total: 0,
      suspendedAt: null,
    });
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.id, second.checkId)).get()
    ).toMatchObject({ status: 'cancelled' });
    expect(
      await db
        .select()
        .from(restaurantServices)
        .where(and(eq(restaurantServices.tableId, tableId), eq(restaurantServices.status, 'open')))
        .all()
    ).toHaveLength(1);

    // The moved plate keeps its submission: its round is cloned onto the
    // receiving check with the next free sequence.
    const firstRounds = await db
      .select()
      .from(restaurantRounds)
      .where(eq(restaurantRounds.checkId, first.checkId))
      .all();
    expect(firstRounds.map(round => round.sequence).sort()).toEqual([1, 2]);
    expect(firstRounds.find(round => round.sequence === 2)).toMatchObject({
      submittedAt: secondRound?.submittedAt,
      submittedBy: secondRound?.submittedBy,
      label: secondRound?.label ?? null,
    });

    for (const check of result.checks) {
      const payments = await db
        .select()
        .from(salePayments)
        .where(eq(salePayments.saleId, check.saleId))
        .all();
      expect(payments.map(payment => payment.amount)).toEqual([check.total]);
    }
    expect(
      await db.select().from(salePayments).where(eq(salePayments.saleId, second.saleId)).all()
    ).toEqual([]);
    // Kitchen lines follow their plates; nothing is voided by the merge.
    const kitchen = await db
      .select()
      .from(kdsOrderLines)
      .where(inArray(kdsOrderLines.sourceSaleItemId, [...first.itemIds, ...second.itemIds]))
      .all();
    expect(kitchen).toHaveLength(3);
    expect(kitchen.every(line => line.status !== 'voided')).toBe(true);
    expect(kitchen.find(line => line.sourceSaleItemId === second.itemIds[0])).toMatchObject({
      currentSaleId: first.saleId,
    });
    expect(kitchen.some(line => line.currentSaleId === second.saleId)).toBe(false);

    const state = await tableState(tableId);
    expect(state.checks.map(check => check.lines.length)).toEqual([2, 2]);
    const service = state.service;
    if (!service) throw new Error('Expected the service to stay open');
    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'restaurant.checks.regrouped'),
          eq(auditLogs.resourceId, service.id)
        )
      )
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({
      tableId,
      planKind: 'byDiner',
      cancelledCheckIds: [second.checkId],
      before: [
        { checkId: first.checkId, lineCount: 2 },
        { checkId: second.checkId, lineCount: 1 },
        { checkId: third.checkId, lineCount: 1 },
      ],
      after: [
        { checkId: first.checkId, lineCount: 2 },
        { checkId: third.checkId, lineCount: 2 },
      ],
    });
    // A second tap finds the table already split by diner.
    const again = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: { kind: 'byDiner' },
    });
    expect(again.cancelledCheckIds).toEqual([]);
    expect(await auditCount(service.id)).toBe(1);
  });

  it('puts shared plates in their own last account and opens new checks as needed', async () => {
    const tableId = await createTable(`Mesa compartida ${nanoid(5)}`);
    const round = await sendRound(tableId, [
      { price: 10, seat: 2 },
      { price: 12, seat: 1 },
      { price: 30, seat: null },
    ]);

    const result = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: { kind: 'byDiner' },
    });

    expect(result.cancelledCheckIds).toEqual([]);
    expect(result.checks).toHaveLength(3);
    // Seat 1 keeps the original check; seat 2 and the shared plate open new ones in that order.
    expect(result.checks.map(check => check.saleItemIds)).toEqual([
      [round.itemIds[1]],
      [round.itemIds[0]],
      [round.itemIds[2]],
    ]);
    expect(result.checks[0]?.checkId).toBe(round.checkId);
    expect((await tableState(tableId)).checks).toHaveLength(3);
  });

  it('moves one line into an existing check and back, reusing the original round', async () => {
    const tableId = await createTable(`Mesa mover ${nanoid(5)}`);
    const first = await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 1 },
    ]);
    const second = await sendRound(tableId, [{ price: 5, seat: 2 }]);
    const before = await totalOf([first.saleId, second.saleId]);

    const moved = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: {
        kind: 'accounts',
        accounts: [
          { checkId: first.checkId, saleItemIds: [first.itemIds[0]!] },
          { checkId: second.checkId, saleItemIds: [second.itemIds[0]!, first.itemIds[1]!] },
        ],
      },
    });
    expect(moved.cancelledCheckIds).toEqual([]);
    expect(moved.checks.map(check => check.total)).toEqual([10, 25]);
    expect(await totalOf([first.saleId, second.saleId])).toBe(before);
    expect(
      await db.select().from(saleItems).where(eq(saleItems.id, first.itemIds[1]!)).get()
    ).toMatchObject({ saleId: second.saleId });
    expect(
      await db
        .select()
        .from(restaurantRounds)
        .where(eq(restaurantRounds.checkId, second.checkId))
        .all()
    ).toHaveLength(2);
    await tableState(tableId);

    const back = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: {
        kind: 'accounts',
        accounts: [
          { checkId: first.checkId, saleItemIds: first.itemIds },
          { checkId: second.checkId, saleItemIds: second.itemIds },
        ],
      },
    });
    expect(back.checks.map(check => check.total)).toEqual([30, 5]);
    // The clone left on the second check is dropped unless the kitchen names it.
    const firstRounds = await db
      .select()
      .from(restaurantRounds)
      .where(eq(restaurantRounds.checkId, first.checkId))
      .all();
    expect(firstRounds).toHaveLength(1);
    const lines = await db
      .select()
      .from(restaurantCheckLines)
      .where(inArray(restaurantCheckLines.saleItemId, first.itemIds))
      .all();
    expect(lines.map(line => line.roundId)).toEqual([firstRounds[0]?.id, firstRounds[0]?.id]);
    expect(
      await db
        .select()
        .from(restaurantRounds)
        .where(eq(restaurantRounds.checkId, second.checkId))
        .all()
    ).toHaveLength(1);
    await tableState(tableId);
  });

  it('opens a new suspended draft for a new account', async () => {
    const tableId = await createTable(`Mesa otra cuenta ${nanoid(5)}`);
    const round = await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 1 },
    ]);
    const source = await saleRow(round.saleId);

    const result = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: {
        kind: 'accounts',
        accounts: [
          { checkId: round.checkId, saleItemIds: [round.itemIds[0]!] },
          { checkId: null, saleItemIds: [round.itemIds[1]!] },
        ],
      },
    });

    expect(result.checks).toHaveLength(2);
    const created = result.checks[1]!;
    expect(created.checkId).not.toBe(round.checkId);
    expect(created).toMatchObject({ total: 20, saleItemIds: [round.itemIds[1]] });
    expect(created.saleNumber).not.toBe(source.saleNumber);
    expect(await saleRow(created.saleId)).toMatchObject({
      status: 'draft',
      tableId,
      total: 20,
      cashSessionId: source.cashSessionId,
      createdBy: source.createdBy,
      currencyCode: source.currencyCode,
      priceTier: source.priceTier,
      suspendedBy: adminId,
    });
    expect((await saleRow(created.saleId)).suspendedAt).toEqual(expect.any(String));
    expect(await saleRow(round.saleId)).toMatchObject({ status: 'draft', total: 10 });
    expect(
      await db
        .select({ operation: syncOutbox.operation })
        .from(syncOutbox)
        .where(and(eq(syncOutbox.entityType, 'sales'), eq(syncOutbox.entityId, created.saleId)))
        .all()
    ).toEqual([{ operation: 'create' }]);
    expect((await tableState(tableId)).checks.map(check => check.total)).toEqual([10, 20]);
  });

  it('cancels a check left without lines and keeps the service open', async () => {
    const tableId = await createTable(`Mesa unir ${nanoid(5)}`);
    const first = await sendRound(tableId, [{ price: 10, seat: 1 }]);
    const second = await sendRound(tableId, [{ price: 20, seat: 2 }]);
    const stockRows = async () =>
      db
        .select({ productId: inventoryBalances.productId, onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .innerJoin(saleItems, eq(saleItems.productId, inventoryBalances.productId))
        .where(inArray(saleItems.id, [...first.itemIds, ...second.itemIds]))
        .all();
    const stockBefore = await stockRows();

    const result = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: {
        kind: 'accounts',
        accounts: [{ checkId: second.checkId, saleItemIds: [...first.itemIds, ...second.itemIds] }],
      },
    });

    expect(result).toMatchObject({
      cancelledCheckIds: [first.checkId],
      checks: [{ checkId: second.checkId, total: 30 }],
    });
    expect(await saleRow(first.saleId)).toMatchObject({ status: 'cancelled', total: 0 });
    expect(await stockRows()).toEqual(stockBefore);
    const state = await tableState(tableId);
    expect(state.service?.status).toBe('open');
    expect(state.checks).toHaveLength(1);
  });

  it('allocates header discount and tip to the cent', async () => {
    const tableId = await createTable(`Mesa propina ${nanoid(5)}`);
    const round = await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 10, seat: 2 },
      { price: 10, seat: 3 },
    ]);
    await db
      .update(sales)
      .set({ discountAmount: 1, tipAmount: 0.1, tipMethod: 'fixed', total: 29.1 })
      .where(eq(sales.id, round.saleId));

    const result = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: { kind: 'byDiner' },
    });

    const rows = await db
      .select()
      .from(sales)
      .where(
        inArray(
          sales.id,
          result.checks.map(check => check.saleId)
        )
      )
      .all();
    const cents = (pick: (row: (typeof rows)[number]) => number) =>
      rows.map(row => Math.round(pick(row) * 100)).sort((a, b) => a - b);
    expect(cents(row => row.discountAmount)).toEqual([33, 33, 34]);
    expect(cents(row => row.tipAmount)).toEqual([3, 3, 4]);
    expect(cents(row => row.total).reduce((sum, value) => sum + value, 0)).toBe(2910);
    expect(rows.every(row => row.tipMethod === 'fixed')).toBe(true);
    for (const row of rows) {
      expect(Math.round(row.total * 100)).toBe(
        Math.round((row.subtotal + row.taxAmount - row.discountAmount + row.tipAmount) * 100)
      );
    }
  });

  it('writes nothing when the plan already matches the table', async () => {
    const tableId = await createTable(`Mesa igual ${nanoid(5)}`);
    const first = await sendRound(tableId, [{ price: 10, seat: 1 }]);
    const second = await sendRound(tableId, [{ price: 20, seat: 2 }]);
    const service = (await tableState(tableId)).service;
    if (!service) throw new Error('Expected an open service');
    const outboxCount = async () =>
      (
        await db
          .select({ value: count() })
          .from(syncOutbox)
          .where(inArray(syncOutbox.entityId, [first.saleId, second.saleId]))
          .get()
      )?.value ?? 0;
    const outboxBefore = await outboxCount();
    const versionBefore = (await saleRow(first.saleId)).syncVersion;

    const result = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: {
        kind: 'accounts',
        accounts: [
          { checkId: second.checkId, saleItemIds: second.itemIds },
          { checkId: first.checkId, saleItemIds: first.itemIds },
        ],
      },
    });

    expect(result).toEqual({
      cancelledCheckIds: [],
      checks: [
        expect.objectContaining({ checkId: first.checkId, total: 10, saleItemIds: first.itemIds }),
        expect.objectContaining({
          checkId: second.checkId,
          total: 20,
          saleItemIds: second.itemIds,
        }),
      ],
    });
    expect(await auditCount(service.id)).toBe(0);
    expect(await outboxCount()).toBe(outboxBefore);
    expect((await saleRow(first.saleId)).syncVersion).toBe(versionBefore);
  });

  it('replays the committed result for the same envelope', async () => {
    const tableId = await createTable(`Mesa replay ${nanoid(5)}`);
    const round = await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 2 },
    ]);
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const input = { tableId, checks: await views(tableId), plan: { kind: 'byDiner' as const } };

    const firstResult = await appRouter
      .createCaller(fresh({ role: 'manager', envelope }))
      .restaurantServices.regroupChecks(input);
    const replayed = await appRouter
      .createCaller(fresh({ role: 'manager', envelope }))
      .restaurantServices.regroupChecks(input);

    expect(replayed).toEqual(firstResult);
    expect(firstResult.checks).toHaveLength(2);
    expect(firstResult.checks[0]?.saleId).toBe(round.saleId);
    const service = (await tableState(tableId)).service;
    expect(await auditCount(service!.id)).toBe(1);
  });

  it('rejects a plan that no longer matches the table', async () => {
    const tableId = await createTable(`Mesa vieja ${nanoid(5)}`);
    const first = await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 2 },
    ]);
    const other = await sendRound(await createTable(`Mesa ajena ${nanoid(5)}`), [
      { price: 5, seat: 1 },
    ]);
    const attempt = async (accounts: Array<{ checkId: string | null; saleItemIds: string[] }>) =>
      manager().restaurantServices.regroupChecks({
        tableId,
        checks: await views(tableId),
        plan: { kind: 'accounts', accounts },
      });
    const staleError = {
      code: 'CONFLICT',
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SPLIT_STALE' }),
    };

    await expect(
      attempt([{ checkId: first.checkId, saleItemIds: [first.itemIds[0]!] }])
    ).rejects.toMatchObject(staleError);
    await expect(
      attempt([
        { checkId: first.checkId, saleItemIds: first.itemIds },
        { checkId: null, saleItemIds: [first.itemIds[0]!] },
      ])
    ).rejects.toMatchObject(staleError);
    await expect(
      attempt([{ checkId: first.checkId, saleItemIds: [...first.itemIds, other.itemIds[0]!] }])
    ).rejects.toMatchObject(staleError);
    await expect(
      attempt([{ checkId: other.checkId, saleItemIds: first.itemIds }])
    ).rejects.toMatchObject(staleError);

    expect((await tableState(tableId)).checks.map(check => check.lines.length)).toEqual([2]);
  });

  it('rejects a plan built before another device moved a line', async () => {
    const tableId = await createTable(`Mesa dos pantallas ${nanoid(5)}`);
    const first = await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 1 },
    ]);
    const second = await sendRound(tableId, [{ price: 5, seat: 2 }]);
    const third = await sendRound(tableId, [{ price: 7, seat: 3 }]);
    const seenBefore = await views(tableId);
    expect(seenBefore.map(view => view.version)).toEqual([1, 1, 1]);

    await manager().restaurantServices.regroupChecks({
      tableId,
      checks: seenBefore,
      plan: {
        kind: 'accounts',
        accounts: [
          { checkId: first.checkId, saleItemIds: [first.itemIds[0]!] },
          { checkId: second.checkId, saleItemIds: [second.itemIds[0]!, first.itemIds[1]!] },
          { checkId: third.checkId, saleItemIds: third.itemIds },
        ],
      },
    });
    // Only the checks whose lines changed move to a new version.
    expect(await views(tableId)).toEqual([
      { checkId: first.checkId, version: 2 },
      { checkId: second.checkId, version: 2 },
      { checkId: third.checkId, version: 1 },
    ]);

    // The other screen still shows the old layout and tries to keep it.
    await expect(
      manager().restaurantServices.regroupChecks({
        tableId,
        checks: seenBefore,
        plan: {
          kind: 'accounts',
          accounts: [
            { checkId: first.checkId, saleItemIds: first.itemIds },
            { checkId: second.checkId, saleItemIds: second.itemIds },
            { checkId: third.checkId, saleItemIds: third.itemIds },
          ],
        },
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SPLIT_STALE' }),
    });
    expect(
      await db.select().from(saleItems).where(eq(saleItems.id, first.itemIds[1]!)).get()
    ).toMatchObject({ saleId: second.saleId });
  });

  it('rejects a plan that omits a check split off meanwhile', async () => {
    const tableId = await createTable(`Mesa division vieja ${nanoid(5)}`);
    const round = await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 2 },
      { price: 30, seat: 2 },
    ]);
    const seenBefore = await views(tableId);

    await manager().sales.splitDraft({
      sourceSaleId: round.saleId,
      saleItemIds: [round.itemIds[2]!],
      tableId,
    });
    const seenAfter = await views(tableId);
    expect(seenAfter).toHaveLength(2);
    expect(seenAfter[0]).toEqual({ checkId: round.checkId, version: 2 });

    await expect(
      manager().restaurantServices.regroupChecks({
        tableId,
        checks: seenBefore,
        plan: { kind: 'byDiner' },
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SPLIT_STALE' }),
    });
    // A view with the right versions but without the new check is stale too.
    await expect(
      manager().restaurantServices.regroupChecks({
        tableId,
        checks: [seenAfter[0]!],
        plan: { kind: 'byDiner' },
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SPLIT_STALE' }),
    });
    expect((await tableState(tableId)).checks.map(check => check.lines.length)).toEqual([2, 1]);
  });

  it('runs a repeated split by diner against the current versions', async () => {
    const tableId = await createTable(`Mesa repetir ${nanoid(5)}`);
    await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 2 },
    ]);
    const firstView = await views(tableId);
    await manager().restaurantServices.regroupChecks({
      tableId,
      checks: firstView,
      plan: { kind: 'byDiner' },
    });
    const service = (await tableState(tableId)).service;
    if (!service) throw new Error('Expected an open service');

    // The same input again describes a table that no longer exists.
    await expect(
      manager().restaurantServices.regroupChecks({
        tableId,
        checks: firstView,
        plan: { kind: 'byDiner' },
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SPLIT_STALE' }),
    });

    await sendRound(tableId, [
      { price: 5, seat: 1 },
      { price: 7, seat: 2 },
    ]);
    const result = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: { kind: 'byDiner' },
    });
    expect(result.checks.map(check => check.total)).toEqual([15, 27]);
    expect(result.cancelledCheckIds).toHaveLength(1);
    expect(await auditCount(service.id)).toBe(2);
  });

  it('refuses to mix checks priced at different tiers or billed to different customers', async () => {
    const termsError = {
      code: 'CONFLICT',
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SPLIT_TERMS_DIFFER' }),
    };
    const tierTable = await createTable(`Mesa lista ${nanoid(5)}`);
    const tierFirst = await sendRound(tierTable, [{ price: 10, seat: 1 }]);
    const tierSecond = await sendRound(tierTable, [{ price: 20, seat: 1 }]);
    await db.update(sales).set({ priceTier: 2 }).where(eq(sales.id, tierSecond.saleId));
    await expect(
      manager().restaurantServices.regroupChecks({
        tableId: tierTable,
        checks: await views(tierTable),
        plan: {
          kind: 'accounts',
          accounts: [
            {
              checkId: tierFirst.checkId,
              saleItemIds: [...tierFirst.itemIds, ...tierSecond.itemIds],
            },
          ],
        },
      })
    ).rejects.toMatchObject(termsError);
    // One new account cannot take lines sold under different terms either.
    await expect(
      manager().restaurantServices.regroupChecks({
        tableId: tierTable,
        checks: await views(tierTable),
        plan: {
          kind: 'accounts',
          accounts: [{ checkId: null, saleItemIds: [...tierFirst.itemIds, ...tierSecond.itemIds] }],
        },
      })
    ).rejects.toMatchObject(termsError);

    const customerId = nanoid();
    const now = new Date().toISOString();
    await db.insert(customers).values({
      id: customerId,
      tenantId,
      name: 'Cliente de la mesa',
      createdAt: now,
      updatedAt: now,
    });
    const customerTable = await createTable(`Mesa cliente ${nanoid(5)}`);
    const customerFirst = await sendRound(customerTable, [
      { price: 10, seat: 1 },
      { price: 20, seat: 2 },
    ]);
    const customerSecond = await sendRound(customerTable, [{ price: 5, seat: 1 }]);
    await db.update(sales).set({ customerId }).where(eq(sales.id, customerSecond.saleId));
    await expect(
      manager().restaurantServices.regroupChecks({
        tableId: customerTable,
        checks: await views(customerTable),
        plan: { kind: 'byDiner' },
      })
    ).rejects.toMatchObject(termsError);
    expect((await tableState(customerTable)).checks.map(check => check.lines.length)).toEqual([
      2, 1,
    ]);
    expect(customerFirst.itemIds).toHaveLength(2);
  });

  it('rejects malformed plans before touching the table', async () => {
    const tableId = await createTable(`Mesa plan ${nanoid(5)}`);
    const round = await sendRound(tableId, [{ price: 10, seat: 1 }]);

    await expect(
      manager().restaurantServices.regroupChecks({
        tableId,
        checks: await views(tableId),
        plan: {
          kind: 'accounts',
          accounts: [
            { checkId: round.checkId, saleItemIds: round.itemIds },
            { checkId: round.checkId, saleItemIds: [] },
          ],
        },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      manager().restaurantServices.regroupChecks({
        tableId,
        checks: await views(tableId),
        plan: {
          kind: 'accounts',
          accounts: [
            { checkId: round.checkId, saleItemIds: round.itemIds },
            { checkId: null, saleItemIds: [] },
          ],
        },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses to move lines while a check is resumed on a register', async () => {
    const tableId = await createTable(`Mesa en caja ${nanoid(5)}`);
    const first = await sendRound(tableId, [{ price: 10, seat: 1 }]);
    await sendRound(tableId, [{ price: 20, seat: 2 }]);
    const cashier = appRouter.createCaller(fresh({ role: 'cashier' }));
    await cashier.sales.resume({ saleId: first.saleId });

    await expect(
      manager().restaurantServices.regroupChecks({
        tableId,
        checks: await views(tableId),
        plan: { kind: 'byDiner' },
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SPLIT_CHECK_IN_USE' }),
    });

    await cashier.sales.suspend({ saleId: first.saleId, tableId });
  });

  it('refuses to split by diner when every line belongs to one diner', async () => {
    const tableId = await createTable(`Mesa un comensal ${nanoid(5)}`);
    await sendRound(tableId, [{ price: 10, seat: 1 }]);
    await sendRound(tableId, [{ price: 20, seat: 1 }]);

    await expect(
      manager().restaurantServices.regroupChecks({
        tableId,
        checks: await views(tableId),
        plan: { kind: 'byDiner' },
      })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_SPLIT_SINGLE_DINER' }),
    });
  });

  it('is limited to managers and administrators', async () => {
    const tableId = await createTable(`Mesa rol ${nanoid(5)}`);
    await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 2 },
    ]);

    await expect(
      appRouter.createCaller(fresh({ role: 'cashier' })).restaurantServices.regroupChecks({
        tableId,
        checks: await views(tableId),
        plan: { kind: 'byDiner' },
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await tableState(tableId)).checks).toHaveLength(1);
  });

  it('does not find a table of another tenant', async () => {
    const now = new Date().toISOString();
    const foreignTenantId = nanoid();
    const foreignCompanyId = nanoid();
    const foreignSiteId = nanoid();
    const foreignTableId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign restaurant',
      slug: `foreign-${nanoid(6)}`,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: foreignCompanyId,
      tenantId: foreignTenantId,
      name: 'Foreign company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: foreignSiteId,
      tenantId: foreignTenantId,
      companyId: foreignCompanyId,
      name: 'Foreign site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(restaurantTables).values({
      id: foreignTableId,
      tenantId: foreignTenantId,
      siteId: foreignSiteId,
      name: 'Foreign table',
      seatCount: 4,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const tenantWide = fresh({ role: 'admin' });
    tenantWide.siteId = null;

    await expect(
      appRouter.createCaller(tenantWide).restaurantServices.regroupChecks({
        tableId: foreignTableId,
        checks: [{ checkId: 'unknown', version: 1 }],
        plan: { kind: 'byDiner' },
      })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      cause: expect.objectContaining({ errorCode: 'RESTAURANT_TABLE_NOT_FOUND' }),
    });
  });

  it('settles a regrouped check through the normal completion path', async () => {
    const tableId = await createTable(`Mesa cobrar ${nanoid(5)}`);
    const first = await sendRound(tableId, [
      { price: 10, seat: 1 },
      { price: 20, seat: 2 },
    ]);
    const second = await sendRound(tableId, [{ price: 5, seat: 1 }]);
    const result = await manager().restaurantServices.regroupChecks({
      tableId,
      checks: await views(tableId),
      plan: { kind: 'byDiner' },
    });
    const seatOne = result.checks.find(check => check.checkId === first.checkId);
    expect(seatOne).toMatchObject({ total: 15 });
    expect(sorted(seatOne!.saleItemIds)).toEqual(sorted([first.itemIds[0]!, second.itemIds[0]!]));

    const cashier = appRouter.createCaller(fresh());
    await cashier.sales.resume({ saleId: first.saleId });
    await cashier.sales.completeDraft({
      saleId: first.saleId,
      priceTier: 1,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 15,
    });

    expect(await saleRow(first.saleId)).toMatchObject({ status: 'completed', total: 15 });
    expect(
      await db.select().from(restaurantChecks).where(eq(restaurantChecks.id, first.checkId)).get()
    ).toMatchObject({ status: 'settled' });
    const state = await tableState(tableId);
    expect(state.checks.map(check => check.id)).toEqual([second.checkId]);
    expect(state.checks[0]?.lines.map(line => line.saleItemId)).toEqual([first.itemIds[1]]);
  });
});
