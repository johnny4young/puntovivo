/**
 * ENG-090 — Full credit-sale flow through `completeSale`.
 *
 * Pins:
 *  - Happy path: full-credit single-tender sale lands a `kind='sale'`
 *    row on the ledger (positive signed delta) and does NOT write a
 *    cash movement (the `amount > 0` guard on `insertCashMovement`
 *    short-circuits).
 *  - Cupo enforcement: when `currentBalance + total > creditLimit`
 *    the use-case throws `CREDIT_LIMIT_EXCEEDED` BEFORE the sale row
 *    is inserted (sequential is not advanced, inventory is intact).
 *  - Admin override: passing `creditOverride: true` skips the throw
 *    and the sale lands.
 *  - Sentinel: `creditLimit === 0` is "no limit" and the invariant
 *    returns early.
 *  - Customer required: `paymentMethod === 'credit'` without a
 *    customer throws `CREDIT_SALE_CUSTOMER_REQUIRED` (the Zod
 *    refinement enforces it earlier; the use-case asserts it again
 *    in case a direct caller bypasses Zod).
 *
 * Reuses the `application-sales-completeSale.test.ts` rig
 * (`completeSale` invoked directly with a hand-built
 * `CompleteSaleContext`).
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
  customerLedgerEntries,
  inventoryBalances,
  products,
  sequentials,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import { completeSale } from '../application/sales/completeSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let cashSessionId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

function buildContext(
  overrides: Partial<CompleteSaleContext> = {}
): CompleteSaleContext {
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

async function seedCustomer(args: { name: string; creditLimit: number }) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(customers).values({
    id,
    tenantId,
    name: args.name,
    creditLimit: args.creditLimit,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedProduct(name: string, sku: string, stock: number) {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name,
    sku,
    price: 10,
    price2: 10,
    price3: 10,
    cost: 5,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
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
    price: 10,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId,
    onHand: stock,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const seededAdmin = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
  if (!seededAdmin) throw new Error('Expected seeded admin user');
  tenantId = seededAdmin.tenantId;
  userId = seededAdmin.id;

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
  const baseUnit = seededUnits.find(u => u.abbreviation === 'UND');
  if (!baseUnit) throw new Error('Expected seeded UND unit');
  baseUnitId = baseUnit.id;

  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'credit-sale-flow.test',
  });

  fresh = makeFreshContextFactory({
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
    registerName: 'Credit-sale register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
  cashSessionId = session.id;
});

afterAll(async () => {
  await server.close();
});

describe('completeSale (ENG-090 credit-sale flow)', () => {
  it('writes a positive ledger row + skips cash movement for a full-credit sale', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Crédito Feliz',
      creditLimit: 0, // sin cupo (no limit)
    });
    const productId = await seedProduct('Credit Item A', 'CR-A-1', 5);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 10,
          discount: 0,
        },
      ],
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      status: 'completed',
      discountAmount: 0,
    });

    expect(result.sale).toMatchObject({
      paymentMethod: 'credit',
      paymentStatus: 'pending',
    });

    // Ledger row for the sale was written with the positive
    // signed-delta convention.
    const db = getDatabase();
    const ledgerRows = await db
      .select()
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.customerId, customerId),
          eq(customerLedgerEntries.kind, 'sale')
        )
      )
      .orderBy(asc(customerLedgerEntries.createdAt))
      .all();
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.amount).toBe(20);
    expect(ledgerRows[0]?.referenceSaleId).toBe(
      (result.sale as { id: string }).id
    );

    // No cash movement was written for this sale (credit sales do
    // not touch the cash session).
    const cashRows = await db
      .select()
      .from(cashMovements)
      .where(
        and(
          eq(cashMovements.tenantId, tenantId),
          eq(cashMovements.sessionId, cashSessionId),
          eq(cashMovements.referenceId, (result.sale as { id: string }).id)
        )
      )
      .all();
    expect(cashRows).toHaveLength(0);
  });

  it('throws CREDIT_LIMIT_EXCEEDED when the projected balance exceeds the limit', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Cerca del Cupo',
      creditLimit: 50,
    });
    const productId = await seedProduct('Credit Item B', 'CR-B-1', 100);
    const db = getDatabase();
    const beforeStock = getProductStockTotal(db, tenantId, productId);

    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 6, // 6 × 10 = 60 > 50 cupo
            unitPrice: 10,
            discount: 0,
          },
        ],
        paymentMethod: 'credit',
        paymentStatus: 'pending',
        status: 'completed',
        discountAmount: 0,
      })
    ).rejects.toThrow(/Credit sale projection .* exceeds limit/i);

    // Pre-tx throw: stock + sequential are NOT mutated.
    const afterStock = getProductStockTotal(db, tenantId, productId);
    expect(afterStock).toBe(beforeStock);

    const ledgerRows = await db
      .select()
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.customerId, customerId)
        )
      )
      .all();
    expect(ledgerRows).toHaveLength(0);
  });

  it('lets the admin override the cupo via creditOverride=true', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Con Override',
      creditLimit: 50,
    });
    const productId = await seedProduct('Credit Item C', 'CR-C-1', 100);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 6,
          unitPrice: 10,
          discount: 0,
        },
      ],
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      status: 'completed',
      discountAmount: 0,
      creditOverride: true,
    });

    expect(result.sale).toMatchObject({
      paymentMethod: 'credit',
      paymentStatus: 'pending',
    });

    const db = getDatabase();
    const ledgerRows = await db
      .select()
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.customerId, customerId),
          eq(customerLedgerEntries.kind, 'sale')
        )
      )
      .all();
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.amount).toBe(60);
  });

  it('treats creditLimit=0 as the sin-cupo sentinel (no enforcement)', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Sin Cupo',
      creditLimit: 0,
    });
    const productId = await seedProduct('Credit Item D', 'CR-D-1', 5);

    // Sale total $50 with creditLimit=0 (sentinel = unlimited). Must
    // not throw even though the projection is well above zero.
    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 5,
          unitPrice: 10,
          discount: 0,
        },
      ],
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      status: 'completed',
      discountAmount: 0,
    });

    expect(result.sale).toMatchObject({ paymentMethod: 'credit' });
  });

  it('rejects a credit sale without a customer (CREDIT_SALE_CUSTOMER_REQUIRED)', async () => {
    const productId = await seedProduct('Credit Item E', 'CR-E-1', 5);

    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId: undefined,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 10,
            discount: 0,
          },
        ],
        paymentMethod: 'credit',
        paymentStatus: 'pending',
        status: 'completed',
        discountAmount: 0,
      })
    ).rejects.toThrow(/customer/i);
  });

  it('rejects cashier callers that forge a direct credit sale payload', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Cajero Directo',
      creditLimit: 0,
    });
    const productId = await seedProduct('Credit Item Cashier', 'CR-CASHIER-1', 5);
    const cashierCaller = appRouter.createCaller(fresh({ role: 'cashier' }));

    await expect(
      cashierCaller.sales.create({
        customerId,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 10,
            discount: 0,
          },
        ],
        paymentMethod: 'credit',
        paymentStatus: 'pending',
        status: 'completed',
        discountAmount: 0,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'CREDIT_SALE_FORBIDDEN',
      }),
    });
  });

  it('rejects cashier callers that finalize an existing draft as credit', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Draft Cajero',
      creditLimit: 0,
    });
    const productId = await seedProduct(
      'Credit Item Draft Cashier',
      'CR-DRAFT-CASHIER-1',
      5
    );
    const adminCaller = appRouter.createCaller(fresh());
    const draft = await adminCaller.sales.create({
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 10,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
    });
    const cashierCaller = appRouter.createCaller(fresh({ role: 'cashier' }));

    await expect(
      cashierCaller.sales.completeDraft({
        saleId: draft.id,
        paymentMethod: 'credit',
        paymentStatus: 'pending',
        amountReceived: 0,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'CREDIT_SALE_FORBIDDEN',
      }),
    });
  });

  it('the second credit sale that joint-exceeds the cupo throws even if each individually fits', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Doble Crédito',
      creditLimit: 30,
    });
    const productId = await seedProduct('Credit Item F', 'CR-F-1', 5);

    // First sale: $20, under the cupo.
    await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 10,
          discount: 0,
        },
      ],
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      status: 'completed',
      discountAmount: 0,
    });

    // Second sale: $20 again — would push the balance to $40 > $30.
    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 2,
            unitPrice: 10,
            discount: 0,
          },
        ],
        paymentMethod: 'credit',
        paymentStatus: 'pending',
        status: 'completed',
        discountAmount: 0,
      })
    ).rejects.toThrow(/exceeds limit/i);
  });
});
