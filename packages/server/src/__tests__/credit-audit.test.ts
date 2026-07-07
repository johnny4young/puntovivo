/**
 * ENG-007 closure — audit-log coverage for credit-policy mutations.
 *
 * Pins:
 *  - `customers.update` writes a `customer.credit_limit.update` audit
 *    row when `creditLimit` is in the payload AND differs from the
 *    prior value. Same-value updates and updates that don't touch
 *    creditLimit do NOT write the row.
 *  - `completeSale` writes a `sale.credit_override` audit row on both
 *    fresh and fromDraft paths when `creditProjection.overrideApplied
 *    === true` (i.e. the admin bypass actually rescued a sale that
 *    would have exceeded the cupo). When override was passed but
 *    never needed (sale fit under the limit), no audit row fires.
 *
 * Reuses the credit-sale-flow harness for the completeSale path and
 * the appRouter caller for customers.update.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  auditLogs,
  customers,
  inventoryBalances,
  products,
  sites,
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
let fresh: ReturnType<typeof makeFreshContextFactory>;

function buildCompleteSaleContext(
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

async function seedCustomer(args: {
  name: string;
  creditLimit: number;
  email?: string;
}) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(customers).values({
    id,
    tenantId,
    name: args.name,
    email: args.email ?? null,
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

async function latestAuditRow(args: {
  resourceType: string;
  resourceId: string;
  action: string;
}) {
  const db = getDatabase();
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.resourceType, args.resourceType),
        eq(auditLogs.resourceId, args.resourceId),
        eq(auditLogs.action, args.action)
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .get();
}

async function countAuditRows(args: {
  resourceType: string;
  resourceId: string;
  action: string;
}) {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.resourceType, args.resourceType),
        eq(auditLogs.resourceId, args.resourceId),
        eq(auditLogs.action, args.action)
      )
    )
    .all();
  return rows.length;
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
    name: 'credit-audit.test',
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
  await caller.cashSessions.open({
    registerName: 'Credit-audit register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('customers.update audit (ENG-007 closure)', () => {
  it('writes one customer.credit_limit.update row when the limit changes', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Cupo Cambio',
      email: 'cupo-cambio@example.test',
      creditLimit: 0,
    });
    const caller = appRouter.createCaller(fresh());

    await caller.customers.update({ id: customerId, version: 0, creditLimit: 200000 });

    const row = await latestAuditRow({
      resourceType: 'customer',
      resourceId: customerId,
      action: 'customer.credit_limit.update',
    });
    expect(row).toBeDefined();
    expect(row?.tenantId).toBe(tenantId);
    expect(row?.actorId).toBe(userId);
    const before = row?.before as { creditLimit: number } | null;
    const after = row?.after as { creditLimit: number } | null;
    expect(before?.creditLimit).toBe(0);
    expect(after?.creditLimit).toBe(200000);
    const metadata = row?.metadata as {
      customerName: string;
      customerEmail: string | null;
    } | null;
    expect(metadata?.customerName).toBe('Cliente Cupo Cambio');
    expect(metadata?.customerEmail).toBe('cupo-cambio@example.test');
  });

  it('writes no row when the update payload omits creditLimit', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Solo Nombre',
      creditLimit: 50000,
    });
    const caller = appRouter.createCaller(fresh());

    await caller.customers.update({ id: customerId, version: 0, name: 'Cliente Renombrado' });

    const count = await countAuditRows({
      resourceType: 'customer',
      resourceId: customerId,
      action: 'customer.credit_limit.update',
    });
    expect(count).toBe(0);
  });

  it('writes no row when creditLimit value is identical to the prior row', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Idempotente',
      creditLimit: 75000,
    });
    const caller = appRouter.createCaller(fresh());

    await caller.customers.update({ id: customerId, version: 0, creditLimit: 75000 });

    const count = await countAuditRows({
      resourceType: 'customer',
      resourceId: customerId,
      action: 'customer.credit_limit.update',
    });
    expect(count).toBe(0);
  });

  it('writes a row when creditLimit goes down to 0 (admin removes cupo)', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Moroso',
      creditLimit: 500000,
    });
    const caller = appRouter.createCaller(fresh());

    await caller.customers.update({ id: customerId, version: 0, creditLimit: 0 });

    const row = await latestAuditRow({
      resourceType: 'customer',
      resourceId: customerId,
      action: 'customer.credit_limit.update',
    });
    expect(row).toBeDefined();
    const before = row?.before as { creditLimit: number } | null;
    const after = row?.after as { creditLimit: number } | null;
    expect(before?.creditLimit).toBe(500000);
    expect(after?.creditLimit).toBe(0);
  });
});

describe('completeSale credit-override audit (ENG-007 closure)', () => {
  it('writes one sale.credit_override row when the admin bypass rescues an exceeded cupo', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Sobregiro',
      creditLimit: 5, // very low limit to guarantee exceedance
    });
    const productId = await seedProduct('Override Item', 'OVR-A-1', 5);

    const result = await completeSale(buildCompleteSaleContext(), {
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
      creditOverride: true,
    });

    const saleId = (result.sale as { id: string }).id;
    const row = await latestAuditRow({
      resourceType: 'sale',
      resourceId: saleId,
      action: 'sale.credit_override',
    });
    expect(row).toBeDefined();
    expect(row?.tenantId).toBe(tenantId);
    expect(row?.actorId).toBe(userId);
    const after = row?.after as {
      customerId: string;
      creditLimit: number;
      projectedBalance: number;
      attemptedAmount: number;
    } | null;
    expect(after?.customerId).toBe(customerId);
    expect(after?.creditLimit).toBe(5);
    expect(after?.projectedBalance).toBe(20);
    expect(after?.attemptedAmount).toBe(20);
    expect((after?.projectedBalance ?? 0) > (after?.creditLimit ?? 0)).toBe(true);
    const metadata = row?.metadata as { actorRole: string; saleNumber: string } | null;
    expect(metadata?.actorRole).toBe('admin');
    expect(metadata?.saleNumber).toBeTruthy();
  });

  it('writes no sale.credit_override row when override flag is set but limit is not exceeded', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Cupo Holgado',
      creditLimit: 10_000_000, // huge limit, sale never exceeds it
    });
    const productId = await seedProduct('Comfortable Item', 'CMF-A-1', 5);

    const result = await completeSale(buildCompleteSaleContext(), {
      mode: 'fresh',
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
      creditOverride: true, // passed but unused — projection under limit
    });

    const saleId = (result.sale as { id: string }).id;
    const count = await countAuditRows({
      resourceType: 'sale',
      resourceId: saleId,
      action: 'sale.credit_override',
    });
    expect(count).toBe(0);
  });

  it('writes one sale.credit_override row when a draft is completed as exceeded-credit with admin override', async () => {
    const customerId = await seedCustomer({
      name: 'Cliente Draft Sobregiro',
      creditLimit: 5,
    });
    const productId = await seedProduct('Draft Override Item', 'DOV-A-1', 5);

    const draft = await completeSale(buildCompleteSaleContext(), {
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
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    const saleId = (draft.sale as { id: string }).id;

    await completeSale(buildCompleteSaleContext(), {
      mode: 'fromDraft',
      saleId,
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      amountReceived: 0,
      creditOverride: true,
    });

    const row = await latestAuditRow({
      resourceType: 'sale',
      resourceId: saleId,
      action: 'sale.credit_override',
    });
    expect(row).toBeDefined();
    const after = row?.after as {
      customerId: string;
      creditLimit: number;
      projectedBalance: number;
      attemptedAmount: number;
    } | null;
    expect(after?.customerId).toBe(customerId);
    expect(after?.creditLimit).toBe(5);
    expect(after?.projectedBalance).toBe(20);
    expect(after?.attemptedAmount).toBe(20);
    const metadata = row?.metadata as {
      actorRole: string;
      saleNumber: string;
      completedFromDraft: true;
    } | null;
    expect(metadata?.actorRole).toBe('admin');
    expect(metadata?.saleNumber).toBeTruthy();
    expect(metadata?.completedFromDraft).toBe(true);
  });

  it('writes no sale.credit_override row for the creditLimit=0 sentinel even when override is passed', async () => {
    // ENG-089 sentinel: creditLimit === 0 means "sin cupo / no limit". The
    // credit-limit helper returns overrideApplied=false before evaluating
    // the override flag, so the audit must NOT fire. Pinning this so a
    // future refactor of the sentinel logic in services/credit-limit.ts
    // cannot silently start emitting audit rows for unlimited customers.
    const customerId = await seedCustomer({
      name: 'Cliente Sin Cupo',
      creditLimit: 0,
    });
    const productId = await seedProduct('Unlimited Item', 'UNL-A-1', 5);

    const result = await completeSale(buildCompleteSaleContext(), {
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
      creditOverride: true,
    });

    const saleId = (result.sale as { id: string }).id;
    const count = await countAuditRows({
      resourceType: 'sale',
      resourceId: saleId,
      action: 'sale.credit_override',
    });
    expect(count).toBe(0);
  });
});
