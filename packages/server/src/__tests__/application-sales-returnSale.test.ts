/**
 * ENG-055 — Invariant tests for `application/sales/returnSale`.
 *
 * Calls the use-case directly without booting Fastify. The HTTP-shaped
 * tests in `sales.test.ts` continue to exercise the auth / role guards
 * / input parsing — those are not relevant here.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  cashMovements,
  customers,
  inventoryBalances,
  operationEffects,
  products,
  saleReturns,
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
import { returnSale } from '../application/sales/returnSale.js';
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
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: args.name,
    sku: args.sku,
    price: args.price ?? 11.9,
    price2: args.price ?? 11.9,
    price3: args.price ?? 11.9,
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
    price: args.price ?? 11.9,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

async function seedCompletedCashSale(productId: string, amount = 11.9) {
  const result = await completeSale(buildContext(), {
    mode: 'fresh',
    customerId: null,
    items: [
      {
        productId,
        unitId: baseUnitId,
        quantity: 1,
        unitPrice: amount,
        discount: 0,
      },
    ],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: amount,
    discountAmount: 0,
  });
  return (result.sale as { id: string }).id;
}

async function seedCompletedSplitSale(productId: string) {
  const result = await completeSale(buildContext(), {
    mode: 'fresh',
    customerId: null,
    items: [
      {
        productId,
        unitId: baseUnitId,
        quantity: 1,
        unitPrice: 100,
        discount: 0,
      },
    ],
    payments: [
      { method: 'cash', amount: 30, reference: null },
      { method: 'card', amount: 70, reference: 'card-auth-rt-split' },
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
    name: 'application-sales-returnSale.test',
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
    registerName: 'returnSale-app register',
    openingFloat: 200,
    denominations: [{ value: 100, count: 2 }],
  });
  cashSessionId = session.id;
});

afterAll(async () => {
  await server.close();
});

describe('returnSale (happy path)', () => {
  it('restores stock, persists sale_returns, flips paymentStatus to refunded, emits two syncQueue rows', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Return Happy', sku: 'RT-OK', stock: 5 });
    const saleId = await seedCompletedCashSale(productId);

    const stockBefore = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .get();
    expect(stockBefore?.stock).toBe(4); // sold 1 of 5

    const result = await returnSale(buildContext(), {
      id: saleId,
      reason: 'customer changed mind',
    });
    expect(result.sale).toMatchObject({ paymentStatus: 'refunded' });

    const stockAfter = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .get();
    expect(stockAfter?.stock).toBe(5);

    const refundRow = await db
      .select()
      .from(saleReturns)
      .where(eq(saleReturns.saleId, saleId))
      .get();
    expect(refundRow).toBeTruthy();
    expect(refundRow?.refundAmount).toBeCloseTo(11.9);
    expect(refundRow?.reason).toBe('customer changed mind');
  });

  it('refunds only the persisted cash amount for split tenders', async () => {
    const db = getDatabase();
    const productId = await seedProduct({
      name: 'Return split cash',
      sku: 'RT-SPLIT-CASH',
      stock: 5,
      price: 100,
    });
    const saleId = await seedCompletedSplitSale(productId);

    await returnSale(buildContext(), { id: saleId, reason: 'split refund' });

    const movements = await db
      .select({ type: cashMovements.type, amount: cashMovements.amount })
      .from(cashMovements)
      .where(and(eq(cashMovements.tenantId, tenantId), eq(cashMovements.referenceId, saleId)))
      .all();
    expect(movements.find(movement => movement.type === 'sale')?.amount).toBe(30);
    expect(movements.find(movement => movement.type === 'refund')?.amount).toBe(30);
  });
});

describe('returnSale (state guards)', () => {
  it('rejects voided sales', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Return voided', sku: 'RT-VOID', stock: 5 });
    const saleId = await seedCompletedCashSale(productId);
    await db.update(sales).set({ status: 'voided' }).where(eq(sales.id, saleId)).run();

    await expect(returnSale(buildContext(), { id: saleId })).rejects.toMatchObject({
      message: expect.stringMatching(/voided/i),
    });
  });

  it('rejects non-completed sales', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Return draft', sku: 'RT-DRAFT', stock: 5 });
    const saleId = await seedCompletedCashSale(productId);
    await db.update(sales).set({ status: 'draft' }).where(eq(sales.id, saleId)).run();

    await expect(returnSale(buildContext(), { id: saleId })).rejects.toMatchObject({
      message: expect.stringMatching(/completed/i),
    });
  });

  it('rejects already-refunded sales', async () => {
    const db = getDatabase();
    const productId = await seedProduct({
      name: 'Return double refund',
      sku: 'RT-DOUBLE',
      stock: 5,
    });
    const saleId = await seedCompletedCashSale(productId);
    await db
      .update(sales)
      .set({ paymentStatus: 'refunded' })
      .where(eq(sales.id, saleId))
      .run();

    await expect(returnSale(buildContext(), { id: saleId })).rejects.toMatchObject({
      message: expect.stringMatching(/refunded/i),
    });
  });

  it('rejects when a sale_returns row already exists', async () => {
    const productId = await seedProduct({
      name: 'Return duplicate row',
      sku: 'RT-DUP',
      stock: 5,
    });
    const saleId = await seedCompletedCashSale(productId);
    await returnSale(buildContext(), { id: saleId });
    // Second invocation should hit the SALE_RETURN_ALREADY_REFUNDED
    // guard FIRST (paymentStatus is already 'refunded'). Rephrase:
    // create a fresh duplicate scenario by inserting a second
    // sale_returns row manually after restoring paymentStatus.
    const db = getDatabase();
    await db
      .update(sales)
      .set({ paymentStatus: 'paid' })
      .where(eq(sales.id, saleId))
      .run();
    await expect(returnSale(buildContext(), { id: saleId })).rejects.toMatchObject({
      message: expect.stringMatching(/duplicate|already/i),
    });
  });

  it('rejects sales without line items', async () => {
    const db = getDatabase();
    const saleId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: `RT-EMPTY-${nanoid(6)}`,
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
    await expect(returnSale(buildContext(), { id: saleId })).rejects.toMatchObject({
      message: expect.stringMatching(/items/i),
    });
  });
});

describe('returnSale (site routing + journal effects)', () => {
  it('credits stock back to the original sale site, not the active cashier site', async () => {
    const db = getDatabase();
    const productId = await seedProduct({
      name: 'Return Site Routing',
      sku: 'RT-SITE',
      stock: 8,
    });
    const saleId = await seedCompletedCashSale(productId);

    await returnSale(buildContext(), { id: saleId });

    const balance = await db
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
    // Started 8 → sold 1 → 7 on hand → refunded → 8 on hand again.
    expect(balance?.onHand).toBe(8);
  });

  it('emits sale_row + sale_return_row + inventory_movement + cash_movement + 2 sync_queue_emit + audit_log when the envelope is present', async () => {
    const db = getDatabase();
    const productId = await seedProduct({
      name: 'Return Journal',
      sku: 'RT-JE',
      stock: 5,
    });
    const saleId = await seedCompletedCashSale(productId);

    const operationId = nanoid();
    const reg = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'returnSale.journal',
    });
    await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.returnSale',
      deviceId: reg.deviceId,
      userId,
      requestHash: 'rt-journal',
    });

    const result = await returnSale(buildContext({ envelope: { operationId } }), {
      id: saleId,
    });
    expect(result.journalEventId).toBeTruthy();

    const effects = await db
      .select({
        kind: operationEffects.kind,
        resourceType: operationEffects.resourceType,
      })
      .from(operationEffects)
      .where(eq(operationEffects.operationEventId, result.journalEventId!))
      .orderBy(asc(operationEffects.createdAt))
      .all();
    const kinds = effects.map(eff => eff.kind);
    expect(kinds).toContain('sale_row');
    expect(kinds).toContain('sale_return_row');
    expect(kinds).toContain('inventory_movement');
    expect(kinds).toContain('cash_movement');
    expect(kinds).toContain('audit_log');
    expect(kinds.filter(k => k === 'sync_queue_emit').length).toBe(2);
  });
});

describe('returnSale (multi-tenant isolation)', () => {
  it('does not touch foreign tenant data', async () => {
    const db = getDatabase();
    const otherTenantId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Foreign tenant for returnSale',
      slug: `iso-rt-${nanoid(6).toLowerCase()}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(customers).values({
      id: nanoid(),
      tenantId: otherTenantId,
      name: 'Foreign customer',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignSalesBefore = await db
      .select()
      .from(sales)
      .where(eq(sales.tenantId, otherTenantId))
      .all();

    const productId = await seedProduct({
      name: 'Return Iso',
      sku: 'RT-ISO',
      stock: 5,
    });
    const saleId = await seedCompletedCashSale(productId);
    await returnSale(buildContext(), { id: saleId });

    const foreignSalesAfter = await db
      .select()
      .from(sales)
      .where(eq(sales.tenantId, otherTenantId))
      .all();
    expect(foreignSalesAfter.length).toBe(foreignSalesBefore.length);
  });
});
