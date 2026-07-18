/**
 * ENG-014 — Split-tender + credit mix ("apartado" / layaway).
 *
 * Pins the lifted invariant from ENG-090: a sale can carry a credit
 * tender ALONGSIDE non-credit tenders. Only the credit portion lands
 * on `customer_ledger_entries`; the cash portion settles through the
 * active session as usual; `payment_status` flips to `'partial'`; the
 * legacy `payment_method` dominant favors the non-credit tender.
 *
 * Reuses the `application-sales-completeSale.test.ts` rig — direct
 * `completeSale()` call with a hand-built `CompleteSaleContext`.
 *
 * @module __tests__/credit-mix-flow.test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  auditLogs,
  cashMovements,
  customerLedgerEntries,
  customers,
  inventoryBalances,
  products,
  salePayments,
  sales,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
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

async function seedProduct(name: string, sku: string, stock: number, price = 10) {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name,
    sku,
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
    price,
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
    name: 'credit-mix-flow.test',
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
    registerName: 'Credit-mix register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
  cashSessionId = session.id;
});

afterAll(async () => {
  await server.close();
});

describe('completeSale (ENG-014 credit-mix flow)', () => {
  it('mixed cash + credit: ledger writes credit portion only, cash session takes the cash portion, status partial', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Apartado A',
      creditLimit: 1000,
    });
    const productId = await seedProduct('Mix Item A', 'MIX-A-1', 10, 100);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
      payments: [
        { method: 'cash', amount: 50, reference: undefined },
        { method: 'credit', amount: 150, reference: undefined },
      ],
    });

    const saleRow = result.sale as { id: string; paymentStatus: string; paymentMethod: string };
    expect(saleRow.paymentStatus).toBe('partial');
    // Dominant should be 'cash' (the only non-credit tender, demoted-from-credit).
    expect(saleRow.paymentMethod).toBe('cash');

    const db = getDatabase();

    // sale_payments carries both rows.
    const paymentRows = await db
      .select()
      .from(salePayments)
      .where(
        and(
          eq(salePayments.tenantId, tenantId),
          eq(salePayments.saleId, saleRow.id)
        )
      )
      .orderBy(asc(salePayments.method))
      .all();
    expect(paymentRows).toHaveLength(2);
    const methodToAmount = Object.fromEntries(
      paymentRows.map(row => [row.method, row.amount])
    );
    expect(methodToAmount.cash).toBe(50);
    expect(methodToAmount.credit).toBe(150);

    // Ledger row for the credit portion ONLY (150, not 200).
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
    expect(ledgerRows[0]?.amount).toBe(150);
    expect(ledgerRows[0]?.referenceSaleId).toBe(saleRow.id);

    // Cash session takes the cash portion (50).
    const cashRows = await db
      .select()
      .from(cashMovements)
      .where(
        and(
          eq(cashMovements.tenantId, tenantId),
          eq(cashMovements.sessionId, cashSessionId),
          eq(cashMovements.referenceId, saleRow.id)
        )
      )
      .all();
    expect(cashRows).toHaveLength(1);
    expect(cashRows[0]?.amount).toBe(50);
  });

  it('card + credit mix: dominant favors card, partial status', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Apartado B',
      creditLimit: 1000,
    });
    const productId = await seedProduct('Mix Item B', 'MIX-B-1', 10, 100);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
      payments: [
        { method: 'card', amount: 100, reference: undefined },
        { method: 'credit', amount: 100, reference: undefined },
      ],
    });

    const saleRow = result.sale as { id: string; paymentStatus: string; paymentMethod: string };
    expect(saleRow.paymentStatus).toBe('partial');
    expect(saleRow.paymentMethod).toBe('card');

    const db = getDatabase();
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
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.amount).toBe(100);
  });

  it('cupo enforced on credit portion: throws when credit slice alone exceeds limit', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Apartado Cupo',
      creditLimit: 100,
    });
    const productId = await seedProduct('Mix Item C', 'MIX-C-1', 10, 100);

    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 2,
            unitPrice: 100,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        discountAmount: 0,
        payments: [
          { method: 'cash', amount: 50, reference: undefined },
          { method: 'credit', amount: 150, reference: undefined },
        ],
      })
    ).rejects.toThrow(/Credit sale projection .* exceeds limit/i);

    // No sale row written, no ledger row, no cash movement.
    const db = getDatabase();
    const saleRows = await db
      .select()
      .from(sales)
      .where(
        and(eq(sales.tenantId, tenantId), eq(sales.customerId, customerId))
      )
      .all();
    expect(saleRows).toHaveLength(0);
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

  it('cupo OK when credit portion alone fits even though total exceeds cupo', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Apartado Small',
      creditLimit: 100,
    });
    const productId = await seedProduct('Mix Item D', 'MIX-D-1', 10, 100);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
      payments: [
        { method: 'cash', amount: 150, reference: undefined },
        { method: 'credit', amount: 50, reference: undefined },
      ],
    });

    const saleRow = result.sale as { paymentStatus: string };
    expect(saleRow.paymentStatus).toBe('partial');
  });

  it('admin override on split: lets credit portion exceed cupo, audits the override', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Override',
      creditLimit: 100,
    });
    const productId = await seedProduct('Mix Item E', 'MIX-E-1', 10, 100);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
      creditOverride: true,
      payments: [
        { method: 'cash', amount: 50, reference: undefined },
        { method: 'credit', amount: 150, reference: undefined },
      ],
    });

    const saleRow = result.sale as { id: string };

    // Ledger row landed even though projection exceeded cupo (override).
    const db = getDatabase();
    const ledgerRows = await db
      .select()
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.customerId, customerId),
          eq(customerLedgerEntries.referenceSaleId, saleRow.id)
        )
      )
      .all();
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.amount).toBe(150);
  });

  it('customer required: credit-in-split without customerId throws', async () => {
    const productId = await seedProduct('Mix Item F', 'MIX-F-1', 10, 100);

    await expect(
      completeSale(buildContext(), {
        mode: 'fresh',
        customerId: undefined,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 2,
            unitPrice: 100,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        discountAmount: 0,
        payments: [
          { method: 'cash', amount: 100, reference: undefined },
          { method: 'credit', amount: 100, reference: undefined },
        ],
      })
    ).rejects.toThrow(/customer/i);
  });

  it('router rejects cashier callers that forge split-credit create payloads', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Split Cajero',
      creditLimit: 0,
    });
    const productId = await seedProduct('Mix Item Cashier', 'MIX-CASHIER-1', 10, 100);
    const cashierCaller = appRouter.createCaller(fresh({ role: 'cashier' }));

    await expect(
      cashierCaller.sales.create({
        customerId,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 100,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        discountAmount: 0,
        payments: [
          { method: 'cash', amount: 50 },
          { method: 'credit', amount: 50 },
        ],
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'CREDIT_SALE_FORBIDDEN',
      }),
    });
  });

  it('router rejects cashier callers that forge split-credit draft completion payloads', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Split Draft Cajero',
      creditLimit: 0,
    });
    const productId = await seedProduct(
      'Mix Item Draft Cashier',
      'MIX-DRAFT-CASHIER-1',
      10,
      100
    );
    const adminCaller = appRouter.createCaller(fresh());
    const draft = await adminCaller.sales.create({
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 100,
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
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 100,
        payments: [
          { method: 'cash', amount: 50 },
          { method: 'credit', amount: 50 },
        ],
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'CREDIT_SALE_FORBIDDEN',
      }),
    });
  });

  it('regression: pure split without credit keeps status paid + writes zero ledger rows', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Pure Split',
      creditLimit: 1000,
    });
    const productId = await seedProduct('Mix Item G', 'MIX-G-1', 10, 100);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
      payments: [
        { method: 'cash', amount: 100, reference: undefined },
        { method: 'card', amount: 100, reference: undefined },
      ],
    });

    const saleRow = result.sale as { paymentStatus: string };
    expect(saleRow.paymentStatus).toBe('paid');

    const db = getDatabase();
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

  it('regression: single-tender full credit still writes full ledger row + pending status', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Full Credit',
      creditLimit: 0, // sin cupo
    });
    const productId = await seedProduct('Mix Item H', 'MIX-H-1', 10, 100);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      status: 'completed',
      discountAmount: 0,
    });

    const saleRow = result.sale as { id: string; paymentStatus: string; paymentMethod: string };
    expect(saleRow.paymentStatus).toBe('pending');
    expect(saleRow.paymentMethod).toBe('credit');

    const db = getDatabase();
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
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.amount).toBe(100);
  });
  // ENG-216 — the customer attached at payment time.
  //
  // ENG-014 locked the draft's customer at create-time, but the payment
  // drawer is the app's only customer-attach surface and a suspended ticket
  // is created without one, so every resumed sale was silently filed as a
  // walk-in. These pin the new contract AND the guard that makes it safe:
  // re-assignment re-projects against the incoming customer's cupo.
  describe('draft customer attachment (ENG-216)', () => {
    it('attaches the customer picked at payment time to a walk-in draft', async () => {
      const customerId = await seedCustomer({ name: 'Cliente Adjuntado', creditLimit: 0 });
      const productId = await seedProduct('Attach Item', 'ATTACH-1', 10, 100);
      const caller = appRouter.createCaller(fresh());

      // The suspend flow creates the draft with no customer.
      const draft = await caller.sales.create({
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });
      expect(draft.customerId ?? null).toBeNull();

      const completed = await appRouter.createCaller(fresh()).sales.completeDraft({
        saleId: draft.id,
        customerId,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 100,
      });

      expect(completed.customerId).toBe(customerId);
    });

    it('keeps the draft customer when the field is omitted (older client)', async () => {
      const customerId = await seedCustomer({ name: 'Cliente Original', creditLimit: 0 });
      const productId = await seedProduct('Keep Item', 'KEEP-1', 10, 100);
      const caller = appRouter.createCaller(fresh());

      const draft = await caller.sales.create({
        customerId,
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });

      const completed = await appRouter.createCaller(fresh()).sales.completeDraft({
        saleId: draft.id,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 100,
      });

      // Omitting the field must never detach a customer the draft carried.
      expect(completed.customerId).toBe(customerId);
    });

    it('clears the stored customer only when null is sent explicitly', async () => {
      const customerId = await seedCustomer({ name: 'Cliente Para Limpiar', creditLimit: 0 });
      const productId = await seedProduct('Clear Item', 'CLEAR-1', 10, 100);
      const caller = appRouter.createCaller(fresh());

      const draft = await caller.sales.create({
        customerId,
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });

      const completed = await caller.sales.completeDraft({
        saleId: draft.id,
        customerId: null,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 100,
      });

      expect(completed.customerId ?? null).toBeNull();
    });

    it('re-projects the credit cupo against the customer attached at payment time', async () => {
      // The whole reason re-assignment is risky: a draft created as a
      // walk-in must not become a credit sale that skips the new
      // customer's limit. (creditLimit 0 is the sentinel for UNLIMITED, so
      // a real ceiling needs a positive value.)
      const brokeCustomerId = await seedCustomer({ name: 'Cliente Sin Cupo', creditLimit: 50 });
      const productId = await seedProduct('Cupo Item', 'CUPO-DRAFT-1', 10, 100);
      const caller = appRouter.createCaller(fresh());

      const draft = await caller.sales.create({
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });

      await expect(
        appRouter.createCaller(fresh({ role: 'manager' })).sales.completeDraft({
          saleId: draft.id,
          customerId: brokeCustomerId,
          paymentMethod: 'credit',
          paymentStatus: 'pending',
          amountReceived: 0,
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('refuses a customer that really belongs to another tenant', async () => {
      // The customer must EXIST in a foreign tenant, not merely be unknown:
      // an unknown id is rejected by the row lookup alone, so it would pass
      // even with the tenant predicate deleted from validateCustomer. This
      // is the only test in the repo pinning that predicate, and ENG-216
      // made it the guard between raw client input and sales.customerId.
      const db = getDatabase();
      const now = new Date().toISOString();
      const foreignTenantId = nanoid();
      const foreignCustomerId = nanoid();
      await db.insert(tenants).values({
        id: foreignTenantId,
        name: 'Tenant Vecino',
        slug: `tenant-vecino-${foreignTenantId}`,
        settings: {},
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(customers).values({
        id: foreignCustomerId,
        tenantId: foreignTenantId,
        name: 'Cliente Del Vecino',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      const productId = await seedProduct('Foreign Item', 'FOREIGN-1', 10, 100);
      const caller = appRouter.createCaller(fresh());

      const draft = await caller.sales.create({
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });

      await expect(
        appRouter.createCaller(fresh()).sales.completeDraft({
          saleId: draft.id,
          customerId: foreignCustomerId,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          amountReceived: 100,
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        // Pin the code too: a generic BAD_REQUEST would also match a Zod
        // rejection and hide a broken guard.
        cause: expect.objectContaining({ errorCode: 'SALE_CUSTOMER_INVALID' }),
      });

      // The draft must be untouched and still completable as a walk-in.
      const untouched = await db.select().from(sales).where(eq(sales.id, draft.id)).get();
      expect(untouched?.status).toBe('draft');
      expect(untouched?.customerId ?? null).toBeNull();
    });

    it('records the re-assignment in the sale.complete audit row', async () => {
      // ENG-216 made the customer mutable at completion, and a manager can
      // complete a draft someone else parked. Re-assigning moves the
      // receivable, the points, and the fiscal buyer — so the audit row has
      // to carry both sides or the change leaves no trace.
      const originalId = await seedCustomer({ name: 'Cliente Original Audit', creditLimit: 0 });
      const finalId = await seedCustomer({ name: 'Cliente Final Audit', creditLimit: 0 });
      const productId = await seedProduct('Audit Item', 'AUDIT-REASSIGN-1', 10, 100);
      const caller = appRouter.createCaller(fresh());

      const draft = await caller.sales.create({
        customerId: originalId,
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });

      await appRouter.createCaller(fresh()).sales.completeDraft({
        saleId: draft.id,
        customerId: finalId,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 100,
      });

      const row = await getDatabase()
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, draft.id), eq(auditLogs.action, 'sale.complete')))
        .get();

      expect(row?.before).toMatchObject({ customerId: originalId });
      expect(row?.after).toMatchObject({ customerId: finalId });
    });

    it('refuses an unknown customer id', async () => {
      const productId = await seedProduct('Unknown Item', 'UNKNOWN-1', 10, 100);
      const caller = appRouter.createCaller(fresh());

      const draft = await caller.sales.create({
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });

      await expect(
        appRouter.createCaller(fresh()).sales.completeDraft({
          saleId: draft.id,
          customerId: nanoid(),
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          amountReceived: 100,
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });
});
