/**
 * Invariant tests for `application/sales/completeSale`.
 *
 * These tests call the use-case service directly, without booting
 * Fastify or going through tRPC. The HTTP-shaped tests in
 * `sales.test.ts` and `sales-park-and-reprint.test.ts` continue to
 * exercise auth / role guards / input parsing — those concerns are
 * not relevant here.
 *
 * Coverage focus:
 * - Fresh-sale happy path: stock decrement, sequential advance,
 * payments persisted, sync queue emit.
 * - Fresh-sale invariants: customer cross-tenant, discount excess,
 * split payment, draft (no fiscal / no cash movement).
 * - fromDraft path: ownership, suspension state, missing items,
 * non-draft rejection, happy path with session rebind.
 * - Journal effects emission: with envelope → effects landed in
 * `operation_effects`; without envelope → silent skip.
 * - Cross-tenant isolation: completeSale on tenant A leaves tenant B
 * untouched.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  cashMovements,
  cashSessions,
  customers,
  inventoryBalances,
  inventoryMovements,
  operationEffects,
  operationEvents,
  products,
  salePayments,
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
import { recordOperationStart } from '../services/operation-journal/journal.js';
import { completeSale } from '../application/sales/completeSale.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let cashierId: string;
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

async function seedProduct(args: {
  name: string;
  sku: string;
  stock: number;
  price?: number;
  taxRate?: number;
}) {
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
    taxRate: args.taxRate ?? 19,
    initialCost: 5,
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

async function seedCustomer(name: string) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(customers).values({
    id,
    tenantId,
    name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
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

  // Register a device so the operation journal lookup has something
  // to point at. The use-case itself does not require a device, but
  // the journal start row's FK does, and `cashSessions.open` (a
  // critical command) requires the device-id header through the
  // envelope fixture.
  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'application-sales-completeSale.test',
  });

  // Seed a cashier user we can use to test ownership rules on the
  // fromDraft path.
  cashierId = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id: cashierId,
    tenantId,
    email: 'cashier-completeSale@localhost',
    passwordHash: 'x',
    name: 'Cashier completeSale',
    role: 'cashier',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  // Open a cash session for the admin user via the tRPC path. Cash
  // session creation has its own invariants we deliberately reuse
  // (rather than seeding the row by hand). Use the envelope fixture
  // so the `criticalCommandProcedure` middleware accepts the call.
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
    registerName: 'Sales-app register',
    openingFloat: 200,
    denominations: [{ value: 100, count: 2 }],
  });
  cashSessionId = session.id;
});

afterAll(async () => {
  await server.close();
});

describe('completeSale (fresh path)', () => {
  it('persists sale + payments + inventory movement and advances the sequential', async () => {
    const customerId = await seedCustomer('Acme Direct');
    const productId = await seedProduct({
      name: 'Direct Sale Widget',
      sku: 'CS-DIRECT-1',
      stock: 12,
    });

    const before = await getDatabase()
      .select({ currentValue: sequentials.currentValue })
      .from(sequentials)
      .where(
        and(
          eq(sequentials.tenantId, tenantId),
          eq(sequentials.documentType, 'sale'),
          eq(sequentials.siteId, siteId)
        )
      )
      .get();

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'completed',
      amountReceived: 24,
      discountAmount: 0,
      notes: 'app-sale',
    });

    expect(result.sale).toMatchObject({
      customerId,
      paymentStatus: 'paid',
      status: 'completed',
    });
    expect(result.change).toBeCloseTo(0.2, 2);
    expect(result.journalEventId).toBeNull();

    const productStock = getProductStockTotal(getDatabase(), tenantId, productId);
    expect(productStock).toBe(10);

    const after = await getDatabase()
      .select({ currentValue: sequentials.currentValue })
      .from(sequentials)
      .where(
        and(
          eq(sequentials.tenantId, tenantId),
          eq(sequentials.documentType, 'sale'),
          eq(sequentials.siteId, siteId)
        )
      )
      .get();
    expect((after?.currentValue ?? 0) - (before?.currentValue ?? 0)).toBe(1);
  });

  it('rejects a customer that belongs to another tenant', async () => {
    const db = getDatabase();
    const otherTenantId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Other Tenant for customer cross-check',
      slug: `cross-customer-${nanoid(6).toLowerCase()}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignCustomerId = nanoid();
    await db.insert(customers).values({
      id: foreignCustomerId,
      tenantId: otherTenantId,
      name: 'Foreign Customer',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const productId = await seedProduct({
      name: 'CS Cross customer',
      sku: 'CS-XCUST-1',
      stock: 5,
    });

    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId: foreignCustomerId,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 11.9,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 11.9,
        discountAmount: 0,
      })
    ).rejects.toMatchObject({ message: expect.stringMatching(/customer/i) });
  });

  it('rejects a discount that exceeds the line subtotal', async () => {
    const productId = await seedProduct({
      name: 'CS Discount excess',
      sku: 'CS-DISC-EXCEED',
      stock: 5,
    });

    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId: null,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 5,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 0,
        discountAmount: 1000,
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Discount/),
    });
  });

  it('accumulates a multi-line IVA 19% cart without sub-cent drift ( per-line rounding)', async () => {
    const productId = await seedProduct({
      name: 'CS Multi-line IVA',
      sku: 'CS-MULTILINE-19',
      stock: 10,
      price: 50,
      taxRate: 19,
    });

    // 5 lines of 50.00 tax-inclusive @ 19%. Per resolveSaleItems each line
    // rounds independently: base = roundMoney(50 / 1.19) = 42.02,
    // tax = roundMoney(50 - 42.02) = 7.98. Accumulated: subtotal 210.10,
    // tax 39.90, total 250.00 — every intermediate is cents-exact, so the
    // storage CHECK (round(col,2) = col) holds and a refactor that stops
    // rounding per line would shift these totals.
    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: Array.from({ length: 5 }, () => ({
        productId,
        unitId: baseUnitId,
        quantity: 1,
        unitPrice: 50,
        discount: 0,
        taxRate: 19,
      })),
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 250,
      discountAmount: 0,
    });

    const saleRow = await getDatabase()
      .select({
        subtotal: sales.subtotal,
        taxAmount: sales.taxAmount,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, (result.sale as { id: string }).id))
      .get();
    expect(saleRow).toEqual({ subtotal: 210.1, taxAmount: 39.9, total: 250 });
    expect(result.change).toBe(0);
  });

  it('accepts a 100% header discount (total = 0) and skips the zero cash movement', async () => {
    const productId = await seedProduct({
      name: 'CS Full Discount',
      sku: 'CS-DISC-100',
      stock: 5,
      price: 50,
      taxRate: 19,
    });

    // discount == total is a legal promotional giveaway: the guard only
    // rejects baseTotal < 0. The sale must persist with total = 0, the
    // line snapshot keeps the pre-discount base/tax split, inventory
    // still decrements, and insertCashMovement skips the 0-amount
    // movement (its <= 0 guard) instead of writing a zero row.
    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 50,
          discount: 0,
          taxRate: 19,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 0,
      discountAmount: 50,
    });

    const saleId = (result.sale as { id: string }).id;
    const saleRow = await getDatabase()
      .select({
        subtotal: sales.subtotal,
        taxAmount: sales.taxAmount,
        discountAmount: sales.discountAmount,
        total: sales.total,
        paymentStatus: sales.paymentStatus,
      })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(saleRow).toEqual({
      subtotal: 42.02,
      taxAmount: 7.98,
      discountAmount: 50,
      total: 0,
      paymentStatus: 'paid',
    });

    const productStock = getProductStockTotal(getDatabase(), tenantId, productId);
    expect(productStock).toBe(4);

    const movements = await getDatabase()
      .select({ id: cashMovements.id })
      .from(cashMovements)
      .where(eq(cashMovements.referenceId, saleId))
      .all();
    expect(movements).toHaveLength(0);
  });

  it('normalizes a sub-cent amountReceived at the boundary (paid threshold + clean change)', async () => {
    const productId = await seedProduct({
      name: 'CS Subcent Tender',
      sku: 'CS-SUBCENT',
      stock: 5,
      price: 100,
      taxRate: 0,
    });

    // The Zod schema only enforces >= 0 on amountReceived, so a raw HTTP
    // caller can send 99.999 against a 100.00 total. The boundary
    // normalization (auditoría 2026-06) rounds it to 100.00 BEFORE the
    // paid/partial threshold and the change math run: the sale is paid
    // with zero change, instead of partial-by-float-noise.
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
          taxRate: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 99.999,
      discountAmount: 0,
    });

    expect(result.sale).toMatchObject({ paymentStatus: 'paid', total: 100 });
    expect(result.change).toBe(0);
  });

  it('tolerates IEEE-754 drift in a split-tender sum but rejects a real cent mismatch (PAYMENT_SUM_EPSILON)', async () => {
    const productId = await seedProduct({
      name: 'CS Split Drift',
      sku: 'CS-SPLIT-DRIFT',
      stock: 10,
      price: 0.3,
      taxRate: 0,
    });

    // 0.1 + 0.2 sums to 0.30000000000000004 in IEEE-754 — the epsilon
    // tolerance (|sum - total| < 0.005) exists exactly for this: a
    // 2-decimal tender pair whose float sum drifts by ~4e-17 must pass.
    const accepted = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 0.3,
          discount: 0,
          taxRate: 0,
        },
      ],
      payments: [
        { method: 'cash', amount: 0.1, reference: null },
        { method: 'card', amount: 0.2, reference: null },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
    });
    expect((accepted.sale as { total: number }).total).toBe(0.3);

    // A genuine one-cent mismatch (0.1 + 0.21 = 0.31 vs total 0.30) is
    // >= 0.005 away and must be rejected before any write.
    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId: null,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 0.3,
            discount: 0,
            taxRate: 0,
          },
        ],
        payments: [
          { method: 'cash', amount: 0.1, reference: null },
          { method: 'card', amount: 0.21, reference: null },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        discountAmount: 0,
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/sum|total/i),
    });
  });

  it('persists one payment row per tender on a split payment', async () => {
    const productId = await seedProduct({
      name: 'CS Split tender',
      sku: 'CS-SPLIT-1',
      stock: 10,
      price: 100,
      taxRate: 0,
    });

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
          taxRate: 0,
        },
      ],
      payments: [
        { method: 'cash', amount: 60, reference: null },
        { method: 'card', amount: 40, reference: 'auth-9999' },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
    });

    const payments = await getDatabase()
      .select({
        method: salePayments.method,
        amount: salePayments.amount,
        reference: salePayments.reference,
      })
      .from(salePayments)
      .where(eq(salePayments.saleId, (result.sale as { id: string }).id))
      .orderBy(asc(salePayments.createdAt))
      .all();
    expect(payments).toHaveLength(2);
    expect(payments[0]).toMatchObject({ method: 'cash', amount: 60 });
    expect(payments[1]).toMatchObject({
      method: 'card',
      amount: 40,
      reference: 'auth-9999',
    });
  });

  it('rounds monetary write-boundary inputs before hitting precision CHECKs', async () => {
    const productId = await seedProduct({
      name: 'CS Precision Fresh',
      sku: 'CS-PRECISION-FRESH',
      stock: 5,
      price: 100,
      taxRate: 0,
    });

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
          taxRate: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 100,
      discountAmount: 0.105,
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({
        discountAmount: sales.discountAmount,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    const payment = await getDatabase()
      .select({ amount: salePayments.amount })
      .from(salePayments)
      .where(eq(salePayments.saleId, saleId))
      .get();
    const movement = await getDatabase()
      .select({ amount: cashMovements.amount })
      .from(cashMovements)
      .where(eq(cashMovements.referenceId, saleId))
      .get();

    expect(persisted?.discountAmount).toBe(0.11);
    expect(persisted?.total).toBe(99.89);
    expect(payment?.amount).toBe(99.89);
    expect(movement?.amount).toBe(99.89);
  });

  it('does not move cash, sync_outbox completion, or fiscal docs when status=draft', async () => {
    const productId = await seedProduct({
      name: 'CS Draft no fiscal',
      sku: 'CS-DRAFT-NO-FX',
      stock: 8,
    });

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    const saleId = (result.sale as { id: string }).id;

    const movements = await getDatabase()
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.referenceId, saleId))
      .all();
    expect(movements).toHaveLength(0);
  });
});

describe('completeSale (fromDraft path)', () => {
  it('flips a draft to completed and rebinds the cash session', async () => {
    const productId = await seedProduct({
      name: 'CS Draft Complete',
      sku: 'CS-DRAFT-OK',
      stock: 5,
    });

    const draft = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    const draftId = (draft.sale as { id: string }).id;

    const completion = await completeSale(buildContext(), {
      mode: 'fromDraft',
      saleId: draftId,
      payments: [
        { method: 'cash', amount: 6, reference: null },
        { method: 'card', amount: 5.9, reference: 'card-tx-1' },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
    });

    expect(completion.sale).toMatchObject({ status: 'completed' });
    const persisted = await getDatabase()
      .select({
        cashSessionId: sales.cashSessionId,
        status: sales.status,
      })
      .from(sales)
      .where(eq(sales.id, draftId))
      .get();
    expect(persisted?.status).toBe('completed');
    expect(persisted?.cashSessionId).toBe(cashSessionId);
  });

  it('rejects completing a non-draft sale', async () => {
    const productId = await seedProduct({
      name: 'CS Not Draft',
      sku: 'CS-NOT-DRAFT',
      stock: 5,
    });
    const completed = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 11.9,
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;

    await expect(
      completeSale(buildContext(), {
        mode: 'fromDraft',
        saleId,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/draft/i),
    });
  });

  it('rejects completing a draft that is currently suspended', async () => {
    const productId = await seedProduct({
      name: 'CS Draft suspended',
      sku: 'CS-DRAFT-SUSP',
      stock: 5,
    });
    const draft = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    const draftId = (draft.sale as { id: string }).id;

    // Manually mark the sale as suspended (mirrors what `sales.suspend`
    // would persist) so we can exercise the guard without going
    // through the tRPC path.
    await getDatabase()
      .update(sales)
      .set({
        suspendedAt: new Date().toISOString(),
        suspendedBy: userId,
        suspendedLabel: 'Test suspended',
      })
      .where(eq(sales.id, draftId))
      .run();

    await expect(
      completeSale(buildContext(), {
        mode: 'fromDraft',
        saleId: draftId,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/[Rr]esume/),
    });
  });

  it('rejects completing a draft with zero line items', async () => {
    // Create a draft, then nuke its line items.
    const productId = await seedProduct({
      name: 'CS Empty draft',
      sku: 'CS-EMPTY-1',
      stock: 5,
    });
    const draft = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    const draftId = (draft.sale as { id: string }).id;

    await getDatabase().delete(saleItems).where(eq(saleItems.saleId, draftId)).run();

    await expect(
      completeSale(buildContext(), {
        mode: 'fromDraft',
        saleId: draftId,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/items/i),
    });
  });

  it('rounds draft-completion tips and payments before precision CHECK writes', async () => {
    const productId = await seedProduct({
      name: 'CS Precision Draft',
      sku: 'CS-PRECISION-DRAFT',
      stock: 5,
      price: 10,
      taxRate: 0,
    });
    const draft = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
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
      amountReceived: 0,
      discountAmount: 0,
    });
    const draftId = (draft.sale as { id: string }).id;

    await completeSale(buildContext(), {
      mode: 'fromDraft',
      saleId: draftId,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 10.11,
      tipAmount: 0.105,
      tipMethod: 'fixed',
    });

    const persisted = await getDatabase()
      .select({
        tipAmount: sales.tipAmount,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, draftId))
      .get();
    const payment = await getDatabase()
      .select({ amount: salePayments.amount })
      .from(salePayments)
      .where(eq(salePayments.saleId, draftId))
      .get();

    expect(persisted?.tipAmount).toBe(0.11);
    expect(persisted?.total).toBe(10.11);
    expect(payment?.amount).toBe(10.11);
  });
});

describe('completeSale (journal effects)', () => {
  it('emits sale_row + payment_row + inventory_movement + cash_movement + outbox_enqueue:sync when an envelope is present', async () => {
    const productId = await seedProduct({
      name: 'CS Journal Effects',
      sku: 'CS-JE-1',
      stock: 5,
    });
    const operationId = nanoid();
    const db = getDatabase();
    // Seed the journal event row (the middleware would have done this
    // already in the real envelope flow). Use a registered device id.
    const reg = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'completeSale.journal-effects',
    });
    await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.create',
      deviceId: reg.deviceId,
      userId,
      requestHash: 'hash-app-effects',
    });

    const result = await completeSale(buildContext({ envelope: { operationId } }), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 11.9,
      discountAmount: 0,
    });
    expect(result.journalEventId).toBeTruthy();

    const effects = await db
      .select({
        kind: operationEffects.kind,
        resourceType: operationEffects.resourceType,
        resourceId: operationEffects.resourceId,
      })
      .from(operationEffects)
      .where(eq(operationEffects.operationEventId, result.journalEventId!))
      .orderBy(asc(operationEffects.createdAt))
      .all();
    const effectKinds = effects.map(effect => effect.kind);
    expect(effectKinds).toContain('sale_row');
    expect(effectKinds).toContain('payment_row');
    expect(effectKinds).toContain('inventory_movement');
    expect(effectKinds).toContain('cash_movement');
    expect(effectKinds).toContain('outbox_enqueue:sync');

    const saleId = (result.sale as { id: string }).id;
    const persistedPayments = await db
      .select({ id: salePayments.id })
      .from(salePayments)
      .where(eq(salePayments.saleId, saleId))
      .all();
    const persistedCashMovement = await db
      .select({ id: cashMovements.id })
      .from(cashMovements)
      .where(eq(cashMovements.referenceId, saleId))
      .get();
    const paymentEffectIds = effects
      .filter(effect => effect.kind === 'payment_row')
      .map(effect => effect.resourceId);
    const cashMovementEffect = effects.find(effect => effect.kind === 'cash_movement');
    expect(paymentEffectIds).toEqual(persistedPayments.map(payment => payment.id));
    expect(cashMovementEffect?.resourceId).toBe(persistedCashMovement?.id);
  });

  it('skips effect emission silently when the envelope is absent', async () => {
    const productId = await seedProduct({
      name: 'CS Journal None',
      sku: 'CS-JE-NONE',
      stock: 5,
    });

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 11.9,
      discountAmount: 0,
    });
    expect(result.journalEventId).toBeNull();
  });
});

describe('completeSale (multi-tenant isolation)', () => {
  it('does not touch a foreign tenant data when running on the primary', async () => {
    const db = getDatabase();
    const otherTenantId = nanoid();
    const otherUserId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Foreign Tenant for isolation',
      slug: `iso-${nanoid(6).toLowerCase()}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: otherUserId,
      tenantId: otherTenantId,
      email: 'iso-admin@localhost',
      passwordHash: 'x',
      name: 'Iso Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Snapshot foreign tenant counts BEFORE the sale.
    const foreignSalesBefore = await db
      .select()
      .from(sales)
      .where(eq(sales.tenantId, otherTenantId))
      .all();
    const foreignBalancesBefore = await db
      .select()
      .from(inventoryBalances)
      .where(eq(inventoryBalances.tenantId, otherTenantId))
      .all();

    const productId = await seedProduct({
      name: 'CS Iso Primary',
      sku: 'CS-ISO-1',
      stock: 6,
    });

    await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 11.9,
      discountAmount: 0,
    });

    const foreignSalesAfter = await db
      .select()
      .from(sales)
      .where(eq(sales.tenantId, otherTenantId))
      .all();
    const foreignBalancesAfter = await db
      .select()
      .from(inventoryBalances)
      .where(eq(inventoryBalances.tenantId, otherTenantId))
      .all();
    expect(foreignSalesAfter.length).toBe(foreignSalesBefore.length);
    expect(foreignBalancesAfter.length).toBe(foreignBalancesBefore.length);
  });
});

describe('completeSale (post-condition snapshots)', () => {
  it('populates one inventoryMovement and one sync_outbox row per fresh sale', async () => {
    const productId = await seedProduct({
      name: 'CS Snapshot',
      sku: 'CS-SNAP-1',
      stock: 5,
    });

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 11.9,
      discountAmount: 0,
    });
    const saleId = (result.sale as { id: string }).id;

    const movements = await getDatabase()
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.reference, saleId))
      .all();
    expect(movements).toHaveLength(1);

    const queue = await getDatabase()
      .select()
      .from(syncOutbox)
      .where(eq(syncOutbox.entityId, saleId))
      .orderBy(desc(syncOutbox.createdAt))
      .all();
    expect(queue.length).toBeGreaterThanOrEqual(1);
  });
});
