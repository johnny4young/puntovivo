/**
 * ENG-055 — Invariant tests for `application/sales/voidSale`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  cashMovements,
  cashSessions,
  operationEffects,
  products,
  sales,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { recordOperationStart } from '../services/operation-journal/journal.js';
import { completeSale } from '../application/sales/completeSale.js';
import { voidSale } from '../application/sales/voidSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let cashSessionId: string;

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

async function seedProduct(args: { name: string; sku: string; stock: number; price?: number }) {
  const db = getDatabase();
  const productId = nanoid();
  const price = args.price ?? 11.9;
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: args.name,
    sku: args.sku,
    price,
    price2: price,
    price3: price,
    cost: 5,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 19,
    initialCost: 5,
    stock: args.stock,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId,
    unitId: baseUnitId,
    equivalence: 1,
    price,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

async function seedCompletedCashSale(productId: string) {
  const result = await completeSale(buildContext(), {
    mode: 'fresh',
    customerId: null,
    items: [
      { productId, unitId: baseUnitId, quantity: 1, unitPrice: 11.9, discount: 0 },
    ],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: 11.9,
    discountAmount: 0,
  });
  return (result.sale as { id: string }).id;
}

async function seedCompletedSplitSale(productId: string) {
  const result = await completeSale(buildContext(), {
    mode: 'fresh',
    customerId: null,
    items: [
      { productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 },
    ],
    payments: [
      { method: 'cash', amount: 30, reference: null },
      { method: 'card', amount: 70, reference: 'card-auth-vd-split' },
    ],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    discountAmount: 0,
  });
  return (result.sale as { id: string }).id;
}

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
  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;
  const seededUnits = await db
    .select()
    .from(units)
    .where(eq(units.tenantId, tenantId))
    .all();
  const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
  if (!baseUnit) throw new Error('Expected seeded unit UND');
  baseUnitId = baseUnit.id;

  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'application-sales-voidSale.test',
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
  const caller = appRouter.createCaller(fresh());
  const session = await caller.cashSessions.open({
    registerName: 'voidSale-app register',
    openingFloat: 200,
    denominations: [{ value: 100, count: 2 }],
  });
  cashSessionId = session.id;
});

afterAll(async () => {
  await server.close();
});

describe('voidSale (open session)', () => {
  it('reverses stock, flips status to voided, and inserts a refund cash movement against the original session', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Void open', sku: 'VD-OPEN', stock: 10 });
    const saleId = await seedCompletedCashSale(productId);

    const cashMovementsBefore = await db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.referenceId, saleId))
      .all();
    expect(cashMovementsBefore.length).toBe(1); // sale movement only

    await voidSale(buildContext(), { id: saleId, reason: 'wrong customer' });

    const after = await db
      .select({ status: sales.status })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(after?.status).toBe('voided');

    const stock = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .get();
    expect(stock?.stock).toBe(10);

    const cashMovementsAfter = await db
      .select({ type: cashMovements.type, amount: cashMovements.amount })
      .from(cashMovements)
      .where(eq(cashMovements.referenceId, saleId))
      .orderBy(asc(cashMovements.createdAt))
      .all();
    expect(cashMovementsAfter.length).toBe(2);
    expect(cashMovementsAfter[1]?.type).toBe('refund');
  });

  it('reverses only the persisted cash amount for split tenders', async () => {
    const db = getDatabase();
    const productId = await seedProduct({
      name: 'Void split cash',
      sku: 'VD-SPLIT-CASH',
      stock: 10,
      price: 100,
    });
    const saleId = await seedCompletedSplitSale(productId);

    await voidSale(buildContext(), { id: saleId, reason: 'split void' });

    const movements = await db
      .select({ type: cashMovements.type, amount: cashMovements.amount })
      .from(cashMovements)
      .where(and(eq(cashMovements.tenantId, tenantId), eq(cashMovements.referenceId, saleId)))
      .all();
    expect(movements.find(movement => movement.type === 'sale')?.amount).toBe(30);
    expect(movements.find(movement => movement.type === 'refund')?.amount).toBe(30);
  });
});

describe('voidSale (closed session)', () => {
  it('reverses stock but does NOT touch cash when the original session is closed', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Void closed', sku: 'VD-CLOSED', stock: 10 });
    const saleId = await seedCompletedCashSale(productId);

    // Close the cash session manually (mimics what cashSessions.close does
    // for over/short locking — by the time we reach voidSale, the session
    // is no longer 'open').
    await db
      .update(cashSessions)
      .set({ status: 'closed' })
      .where(eq(cashSessions.id, cashSessionId))
      .run();

    await voidSale(buildContext(), { id: saleId });

    const after = await db
      .select({ status: sales.status })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(after?.status).toBe('voided');

    const stock = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .get();
    expect(stock?.stock).toBe(10);

    const refundMovement = await db
      .select()
      .from(cashMovements)
      .where(
        and(eq(cashMovements.referenceId, saleId), eq(cashMovements.type, 'refund'))
      )
      .all();
    expect(refundMovement.length).toBe(0);

    // Re-open the session for subsequent tests.
    await db
      .update(cashSessions)
      .set({ status: 'open' })
      .where(eq(cashSessions.id, cashSessionId))
      .run();
  });
});

describe('voidSale (state guards)', () => {
  it('rejects already-voided sales', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Void double', sku: 'VD-2X', stock: 5 });
    const saleId = await seedCompletedCashSale(productId);
    await db.update(sales).set({ status: 'voided' }).where(eq(sales.id, saleId)).run();

    await expect(voidSale(buildContext(), { id: saleId })).rejects.toMatchObject({
      message: expect.stringMatching(/voided/i),
    });
  });

  it('rejects refunded sales', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Void refunded', sku: 'VD-REF', stock: 5 });
    const saleId = await seedCompletedCashSale(productId);
    await db
      .update(sales)
      .set({ paymentStatus: 'refunded' })
      .where(eq(sales.id, saleId))
      .run();

    await expect(voidSale(buildContext(), { id: saleId })).rejects.toMatchObject({
      message: expect.stringMatching(/refunded/i),
    });
  });

  it('rejects non-completed (draft) sales', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Void draft', sku: 'VD-DRFT', stock: 5 });
    const saleId = await seedCompletedCashSale(productId);
    await db.update(sales).set({ status: 'draft' }).where(eq(sales.id, saleId)).run();

    await expect(voidSale(buildContext(), { id: saleId })).rejects.toMatchObject({
      message: expect.stringMatching(/completed/i),
    });
  });

  it('rejects sales without line items', async () => {
    const db = getDatabase();
    const saleId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: `VD-EMPTY-${nanoid(6)}`,
      subtotal: 0,
      taxAmount: 0,
      discountAmount: 0,
      total: 0,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    await expect(voidSale(buildContext(), { id: saleId })).rejects.toMatchObject({
      message: expect.stringMatching(/items/i),
    });
  });
});

describe('voidSale (independent of caller cash session)', () => {
  it('voids without requiring the caller to have an active session', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Void no-active', sku: 'VD-NOACT', stock: 5 });
    const saleId = await seedCompletedCashSale(productId);

    // Close the caller's only cash session — voidSale must still
    // succeed because it does not call requireActiveCashSession.
    await db
      .update(cashSessions)
      .set({ status: 'closed' })
      .where(eq(cashSessions.id, cashSessionId))
      .run();

    await expect(voidSale(buildContext(), { id: saleId })).resolves.toBeTruthy();

    await db
      .update(cashSessions)
      .set({ status: 'open' })
      .where(eq(cashSessions.id, cashSessionId))
      .run();
  });
});

describe('voidSale (journal effects)', () => {
  it('emits sale_row + inventory_movement + cash_movement (when session open) + sync_queue_emit + audit_log when the envelope is present', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Void journal', sku: 'VD-JE', stock: 5 });
    const saleId = await seedCompletedCashSale(productId);

    const operationId = nanoid();
    const reg = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'voidSale.journal',
    });
    await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.void',
      deviceId: reg.deviceId,
      userId,
      requestHash: 'vd-journal',
    });

    const result = await voidSale(buildContext({ envelope: { operationId } }), {
      id: saleId,
    });
    expect(result.journalEventId).toBeTruthy();

    const effects = await db
      .select({
        kind: operationEffects.kind,
      })
      .from(operationEffects)
      .where(eq(operationEffects.operationEventId, result.journalEventId!))
      .all();
    const kinds = effects.map(eff => eff.kind);
    expect(kinds).toContain('sale_row');
    expect(kinds).toContain('inventory_movement');
    expect(kinds).toContain('cash_movement');
    expect(kinds).toContain('sync_queue_emit');
    expect(kinds).toContain('audit_log');
  });
});

describe('voidSale (multi-tenant isolation)', () => {
  it('does not touch foreign tenant data', async () => {
    const db = getDatabase();
    const otherTenantId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Foreign tenant for voidSale',
      slug: `iso-vd-${nanoid(6).toLowerCase()}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignSalesBefore = await db
      .select()
      .from(sales)
      .where(eq(sales.tenantId, otherTenantId))
      .all();

    const productId = await seedProduct({ name: 'Void Iso', sku: 'VD-ISO', stock: 5 });
    const saleId = await seedCompletedCashSale(productId);
    await voidSale(buildContext(), { id: saleId });

    const foreignSalesAfter = await db
      .select()
      .from(sales)
      .where(eq(sales.tenantId, otherTenantId))
      .all();
    expect(foreignSalesAfter.length).toBe(foreignSalesBefore.length);
  });
});
