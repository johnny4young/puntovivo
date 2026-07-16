import type {
  CheckoutApprovalAction,
  CheckoutApprovalContext,
} from '@puntovivo/shared/checkout-approval';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { completeSale } from '../application/sales/completeSale.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  auditLogs,
  customerLedgerEntries,
  customers,
  inventoryBalances,
  managerApprovalRequests,
  products,
  sales,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { checkoutApprovalResourceId } from '../services/manager-approvals.js';
import {
  DEFAULT_LOSS_PREVENTION_SETTINGS,
  writeLossPreventionSettings,
} from '../services/loss-prevention/index.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let siteId: string;
let baseUnitId: string;
let cashierId: string;
let managerId: string;
let adminId: string;
let freshCashier: ReturnType<typeof makeFreshContextFactory>;

function cashierCaller() {
  return appRouter.createCaller(freshCashier());
}

async function seedProduct(name: string, sku: string, stock = 5) {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name,
    sku,
    price: 100,
    price2: 100,
    price3: 100,
    cost: 40,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 40,
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
    price: 100,
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

async function seedCustomer(name: string, creditLimit: number) {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(customers).values({
    id,
    tenantId,
    name,
    creditLimit,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertApprovedCheckoutRequest(args: {
  action: CheckoutApprovalAction;
  context: CheckoutApprovalContext;
  approverId?: string;
}) {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(managerApprovalRequests).values({
    id,
    tenantId,
    siteId,
    requesterId: cashierId,
    action: args.action,
    status: 'approved',
    reason: `Approved integration test for ${args.action}`,
    resourceType: 'sale_checkout',
    resourceId: checkoutApprovalResourceId(args.context),
    summary: { label: `Checkout approval ${args.action}`, currencyCode: 'USD' },
    requestedAt: now,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    decidedAt: now,
    decidedBy: args.approverId ?? managerId,
    grantExpiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function approvalStatus(id: string) {
  return db
    .select({
      status: managerApprovalRequests.status,
      resourceType: managerApprovalRequests.resourceType,
      resourceId: managerApprovalRequests.resourceId,
      claimToken: managerApprovalRequests.claimToken,
    })
    .from(managerApprovalRequests)
    .where(eq(managerApprovalRequests.id, id))
    .get();
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  db = getDatabase();

  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin user');
  tenantId = admin.tenantId;
  adminId = admin.id;

  const site = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!site) throw new Error('Expected seeded active site');
  siteId = site.id;

  const baseUnit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
    unit => unit.abbreviation === 'UND'
  );
  if (!baseUnit) throw new Error('Expected seeded UND unit');
  baseUnitId = baseUnit.id;

  cashierId = nanoid();
  managerId = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values([
    {
      id: cashierId,
      tenantId,
      email: 'checkout-approval-cashier@example.test',
      name: 'Checkout approval cashier',
      passwordHash: 'not-used',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: 'checkout-approval-manager@example.test',
      name: 'Checkout approval manager',
      passwordHash: 'not-used',
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const registration = await registerDevice(db, {
    tenantId,
    userId: cashierId,
    kind: 'web',
    name: 'checkout-approval-flow.test',
  });
  freshCashier = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId: cashierId,
    email: 'checkout-approval-cashier@example.test',
    siteId,
    deviceId: registration.deviceId,
    defaultRole: 'cashier',
  });
  await cashierCaller().cashSessions.open({
    registerName: 'Checkout approval register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('checkout approval consumption (ENG-106c2)', () => {
  it('binds a discounted sale to its exact payload and consumes the grant once', async () => {
    const productId = await seedProduct('Approval Discount Product', 'APPROVAL-DISCOUNT');
    const input = {
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash' as const,
      paymentStatus: 'paid' as const,
      status: 'completed' as const,
      amountReceived: 90,
      discountAmount: 10,
    };

    await expect(cashierCaller().sales.create(input)).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
    });
    expect(getProductStockTotal(db, tenantId, productId)).toBe(5);

    const requestId = await insertApprovedCheckoutRequest({
      action: 'sale_discount',
      context: {
        mode: 'fresh',
        saleId: null,
        customerId: null,
        items: input.items,
        paymentMethod: 'cash',
        payments: [],
        amountReceived: 90,
        discountAmount: 10,
        total: 90,
        creditAmount: 0,
        tipAmount: 0,
        serviceChargeAmount: 0,
        currencyCode: 'COP',
      },
    });

    await expect(
      cashierCaller().sales.create({
        ...input,
        amountReceived: 100,
        approvalRequests: [{ action: 'sale_discount', requestId }],
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_MISMATCH' }),
    });
    expect(await approvalStatus(requestId)).toMatchObject({
      status: 'approved',
      resourceType: 'sale_checkout',
      claimToken: null,
    });
    expect(getProductStockTotal(db, tenantId, productId)).toBe(5);

    const completed = await cashierCaller().sales.create({
      ...input,
      approvalRequests: [{ action: 'sale_discount', requestId }],
    });
    expect(await approvalStatus(requestId)).toMatchObject({
      status: 'consumed',
      resourceType: 'sale',
      resourceId: completed.id,
      claimToken: null,
    });
    expect(getProductStockTotal(db, tenantId, productId)).toBe(4);

    await expect(
      cashierCaller().sales.create({
        ...input,
        approvalRequests: [{ action: 'sale_discount', requestId }],
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_MISMATCH' }),
    });
    expect(getProductStockTotal(db, tenantId, productId)).toBe(4);

    const consumeAudit = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.resourceId, requestId), eq(auditLogs.action, 'manager_approval.consume'))
      )
      .get();
    expect(consumeAudit).toMatchObject({ actorId: cashierId });
    expect(consumeAudit?.metadata).toMatchObject({
      requesterId: cashierId,
      approverId: managerId,
    });
  });

  it('accepts one manager grant for a cashier credit sale within the limit', async () => {
    const productId = await seedProduct('Approval Credit Product', 'APPROVAL-CREDIT');
    const customerId = await seedCustomer('Approval credit customer', 200);
    const context: CheckoutApprovalContext = {
      mode: 'fresh',
      saleId: null,
      customerId,
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
      paymentMethod: 'credit',
      payments: [],
      amountReceived: null,
      discountAmount: 0,
      total: 100,
      creditAmount: 100,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    };
    const requestId = await insertApprovedCheckoutRequest({ action: 'credit_sale', context });

    const completed = await cashierCaller().sales.create({
      customerId,
      items: context.items,
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      status: 'completed',
      discountAmount: 0,
      approvalRequests: [{ action: 'credit_sale', requestId }],
    });

    expect(await approvalStatus(requestId)).toMatchObject({
      status: 'consumed',
      resourceId: completed.id,
    });
    const ledger = await db
      .select()
      .from(customerLedgerEntries)
      .where(eq(customerLedgerEntries.referenceSaleId, completed.id))
      .get();
    expect(ledger).toMatchObject({ customerId, amount: 100, kind: 'sale' });
  });

  it('lets an admin grant subsume the credit-sale grant for a cashier cupo override', async () => {
    const productId = await seedProduct('Approval Override Product', 'APPROVAL-OVERRIDE');
    const customerId = await seedCustomer('Approval override customer', 50);
    const context: CheckoutApprovalContext = {
      mode: 'fresh',
      saleId: null,
      customerId,
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
      paymentMethod: 'credit',
      payments: [],
      amountReceived: null,
      discountAmount: 0,
      total: 100,
      creditAmount: 100,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    };
    const requestId = await insertApprovedCheckoutRequest({
      action: 'credit_override',
      context,
      approverId: adminId,
    });

    const completed = await cashierCaller().sales.create({
      customerId,
      items: context.items,
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      status: 'completed',
      discountAmount: 0,
      creditOverride: true,
      approvalRequests: [{ action: 'credit_override', requestId }],
    });
    expect(await approvalStatus(requestId)).toMatchObject({
      status: 'consumed',
      resourceId: completed.id,
    });
  });

  it('releases an earlier claim when a second checkout approval is missing', async () => {
    const productId = await seedProduct('Approval Combined Product', 'APPROVAL-COMBINED');
    const customerId = await seedCustomer('Approval combined customer', 500);
    const context: CheckoutApprovalContext = {
      mode: 'fresh',
      saleId: null,
      customerId,
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
      paymentMethod: 'credit',
      payments: [],
      amountReceived: null,
      discountAmount: 10,
      total: 90,
      creditAmount: 90,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    };
    const discountRequestId = await insertApprovedCheckoutRequest({
      action: 'sale_discount',
      context,
    });
    const input = {
      customerId,
      items: context.items,
      paymentMethod: 'credit' as const,
      paymentStatus: 'pending' as const,
      status: 'completed' as const,
      discountAmount: 10,
    };

    await expect(
      cashierCaller().sales.create({
        ...input,
        approvalRequests: [{ action: 'sale_discount', requestId: discountRequestId }],
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
    });
    expect(await approvalStatus(discountRequestId)).toMatchObject({
      status: 'approved',
      claimToken: null,
    });

    const creditRequestId = await insertApprovedCheckoutRequest({
      action: 'credit_sale',
      context,
    });
    const completed = await cashierCaller().sales.create({
      ...input,
      approvalRequests: [
        { action: 'sale_discount', requestId: discountRequestId },
        { action: 'credit_sale', requestId: creditRequestId },
      ],
    });
    expect(await approvalStatus(discountRequestId)).toMatchObject({
      status: 'consumed',
      resourceId: completed.id,
    });
    expect(await approvalStatus(creditRequestId)).toMatchObject({
      status: 'consumed',
      resourceId: completed.id,
    });
  });

  it('requires and consumes a grant when completing a discounted frozen draft', async () => {
    const productId = await seedProduct('Approval Draft Product', 'APPROVAL-DRAFT');
    const customerId = await seedCustomer('Approval draft customer', 500);
    const draft = await cashierCaller().sales.create({
      customerId,
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 10,
    });

    await expect(
      cashierCaller().sales.completeDraft({
        saleId: draft.id,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 90,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
    });
    expect(
      await db.select({ status: sales.status }).from(sales).where(eq(sales.id, draft.id)).get()
    ).toEqual({ status: 'draft' });

    const requestId = await insertApprovedCheckoutRequest({
      action: 'sale_discount',
      context: {
        mode: 'fromDraft',
        saleId: draft.id,
        customerId,
        items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }],
        paymentMethod: 'cash',
        payments: [],
        amountReceived: 90,
        discountAmount: 10,
        total: 90,
        creditAmount: 0,
        tipAmount: 0,
        serviceChargeAmount: 0,
        currencyCode: 'COP',
      },
    });
    const completed = await cashierCaller().sales.completeDraft({
      saleId: draft.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 90,
      approvalRequests: [{ action: 'sale_discount', requestId }],
    });

    expect(completed).toMatchObject({ id: draft.id, status: 'completed' });
    expect(await approvalStatus(requestId)).toMatchObject({
      status: 'consumed',
      resourceId: draft.id,
    });
  });

  it('rejects a stale draft snapshot and releases its claimed grant', async () => {
    const productId = await seedProduct('Approval Stale Draft', 'APPROVAL-STALE-DRAFT');
    const draft = await cashierCaller().sales.create({
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 10 }],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    const context = {
      mode: 'fromDraft' as const,
      saleId: draft.id,
      customerId: null,
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 10 }],
      paymentMethod: 'cash' as const,
      payments: [],
      amountReceived: 90,
      discountAmount: 10,
      total: 90,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    };
    const requestId = await insertApprovedCheckoutRequest({
      action: 'sale_discount',
      context,
    });
    const snapshot = await db
      .select({ syncVersion: sales.syncVersion })
      .from(sales)
      .where(eq(sales.id, draft.id))
      .get();
    const originalTransaction = db.transaction.bind(db);
    let injectedLifecycleChange = false;
    const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation(((
      callback: never,
      config?: never
    ) => {
      if (!injectedLifecycleChange) {
        injectedLifecycleChange = true;
        db.update(sales)
          .set({
            status: 'cancelled',
            syncVersion: (snapshot?.syncVersion ?? 0) + 1,
            updatedAt: new Date(Date.now() + 1_000).toISOString(),
          })
          .where(and(eq(sales.id, draft.id), eq(sales.tenantId, tenantId)))
          .run();
      }
      return originalTransaction(callback, config);
    }) as typeof db.transaction);

    try {
      await expect(
        completeSale(
          {
            db,
            tenantId,
            siteId,
            user: { id: cashierId, role: 'cashier' },
          },
          {
            mode: 'fromDraft',
            saleId: draft.id,
            paymentMethod: 'cash',
            paymentStatus: 'paid',
            amountReceived: 90,
            approvalRequests: [{ action: 'sale_discount', requestId }],
          }
        )
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'SALE_DRAFT_REQUIRED' }),
      });
    } finally {
      transactionSpy.mockRestore();
    }

    expect(injectedLifecycleChange).toBe(true);
    expect(
      await db.select({ status: sales.status }).from(sales).where(eq(sales.id, draft.id)).get()
    ).toEqual({ status: 'cancelled' });
    expect(await approvalStatus(requestId)).toMatchObject({ status: 'approved', claimToken: null });
  });

  it('enforces the configured discount boundary and audits blocked and approved attempts', async () => {
    writeLossPreventionSettings(db, tenantId, {
      version: 1,
      roles: {
        cashier: {
          maxDiscountPercent: 5,
          afterHoursSale: {
            enabled: false,
            blockedFrom: '22:00',
            blockedUntil: '06:00',
          },
        },
        manager: DEFAULT_LOSS_PREVENTION_SETTINGS.roles.manager,
      },
    });

    const boundaryProductId = await seedProduct('Policy Boundary Product', 'POLICY-BOUNDARY');
    await expect(
      cashierCaller().sales.create({
        items: [
          {
            productId: boundaryProductId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 100,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 95,
        discountAmount: 5,
      })
    ).resolves.toMatchObject({ status: 'completed', total: 95 });

    const guardedProductId = await seedProduct('Policy Guarded Product', 'POLICY-GUARDED');
    const context: CheckoutApprovalContext = {
      mode: 'fresh',
      saleId: null,
      customerId: null,
      items: [
        {
          productId: guardedProductId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      payments: [],
      amountReceived: 94,
      discountAmount: 6,
      total: 94,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    };
    const guardedInput = {
      items: context.items,
      paymentMethod: 'cash' as const,
      paymentStatus: 'paid' as const,
      status: 'completed' as const,
      amountReceived: 94,
      discountAmount: 6,
    };

    await expect(cashierCaller().sales.create(guardedInput)).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
    });
    expect(getProductStockTotal(db, tenantId, guardedProductId)).toBe(5);

    const requestId = await insertApprovedCheckoutRequest({
      action: 'sale_discount',
      context,
    });
    const completed = await cashierCaller().sales.create({
      ...guardedInput,
      approvalRequests: [{ action: 'sale_discount', requestId }],
    });
    expect(completed).toMatchObject({ status: 'completed', total: 94 });
    expect(await approvalStatus(requestId)).toMatchObject({
      status: 'consumed',
      resourceId: completed.id,
    });

    const triggers = db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'loss_prevention.triggered'),
          eq(auditLogs.resourceId, 'max_discount')
        )
      )
      .all()
      .filter(row => row.metadata?.checkoutResourceId === checkoutApprovalResourceId(context));
    expect(triggers).toHaveLength(2);
    expect(triggers.map(row => row.after)).toEqual([
      expect.objectContaining({ approvalProvided: false, requiredAction: 'sale_discount' }),
      expect.objectContaining({ approvalProvided: true, requiredAction: 'sale_discount' }),
    ]);
    expect(triggers[0]?.metadata).toMatchObject({
      kind: 'max_discount',
      observedPercent: 6,
      thresholdPercent: 5,
      role: 'cashier',
      siteId,
    });
  });

  it('uses the fresh authority clock when checkout crosses blocked-window boundaries', async () => {
    const freshProductId = await seedProduct('Policy Clock Fresh', 'POLICY-CLOCK-FRESH');
    const draftProductId = await seedProduct('Policy Clock Draft', 'POLICY-CLOCK-DRAFT');
    const draft = await cashierCaller().sales.create({
      items: [
        {
          productId: draftProductId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    writeLossPreventionSettings(db, tenantId, {
      version: 1,
      roles: {
        cashier: {
          maxDiscountPercent: 100,
          // The seeded tenant falls back to America/New_York. In July,
          // 06:00Z is 02:00 local and 07:00Z is 03:00 local.
          afterHoursSale: {
            enabled: true,
            blockedFrom: '02:00',
            blockedUntil: '03:00',
          },
        },
        manager: DEFAULT_LOSS_PREVENTION_SETTINGS.roles.manager,
      },
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-15T05:59:59.000Z'));
      const crossingIntoBlock = completeSale(
        {
          db,
          tenantId,
          siteId,
          user: { id: cashierId, role: 'cashier' },
        },
        {
          mode: 'fresh',
          customerId: null,
          items: [
            {
              productId: freshProductId,
              unitId: baseUnitId,
              quantity: 1,
              unitPrice: 100,
              discount: 0,
            },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'completed',
          amountReceived: 100,
          discountAmount: 0,
        }
      );
      vi.setSystemTime(new Date('2026-07-15T06:00:00.000Z'));
      await expect(crossingIntoBlock).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
      });
      expect(getProductStockTotal(db, tenantId, freshProductId)).toBe(5);

      vi.setSystemTime(new Date('2026-07-15T06:59:59.000Z'));
      const crossingOutOfBlock = completeSale(
        {
          db,
          tenantId,
          siteId,
          user: { id: cashierId, role: 'cashier' },
        },
        {
          mode: 'fromDraft',
          saleId: draft.id,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          amountReceived: 100,
        }
      );
      vi.setSystemTime(new Date('2026-07-15T07:00:00.000Z'));
      await expect(crossingOutOfBlock).resolves.toMatchObject({
        sale: { id: draft.id, status: 'completed' },
      });
    } finally {
      vi.useRealTimers();
      writeLossPreventionSettings(db, tenantId, DEFAULT_LOSS_PREVENTION_SETTINGS);
    }
  });
});
