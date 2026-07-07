/**
 * ENG-039d3 — restaurant service charge / propina sugerida invariants.
 *
 * Mirrors `sales-tip.test.ts` for the mandatory twin of the voluntary
 * tip. The contract under test:
 *   - serviceChargeAmount rolls into `total` after tip on both
 *     fresh-create and fromDraft paths;
 *   - the server validates the amount against the live tenant rate at
 *     submit time (drift → SALE_SERVICE_CHARGE_DRIFT, charge submitted
 *     under a disabled rate → SALE_SERVICE_CHARGE_DISABLED);
 *   - the `sale.complete` audit row carries the metadata;
 *   - Zod rejects negative amounts, out-of-range rates, and a
 *     serviceChargeRate without a positive serviceChargeAmount;
 *   - the fromDraft path uses `baseTotal` from frozen pieces so a
 *     draft-time charge does NOT compound at completion (same
 *     regression shape as ENG-039d's tip fix).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  auditLogs,
  inventoryBalances,
  products,
  sales,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { completeSale } from '../application/sales/completeSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { createSaleInput, completeDraftInput } from '../trpc/schemas/sales.js';
import { writeRestaurantSettings } from '../services/restaurant/settings.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;

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

async function seedServiceProduct(stock: number, price: number) {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: `Service Product ${productId}`,
    sku: `SVC-${productId.slice(0, 6)}`,
    price,
    price2: price,
    price3: price,
    cost: 0,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 0,
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

async function setTenantRate(rate: number): Promise<void> {
  await writeRestaurantSettings(getDatabase(), tenantId, { serviceChargeRate: rate });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const admin = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
  if (!admin) throw new Error('Expected seeded admin user');
  tenantId = admin.tenantId;
  userId = admin.id;

  const site = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!site) throw new Error('Expected seeded site');
  siteId = site.id;

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
    name: 'sales-service-charge.test',
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
  await caller.cashSessions.open({
    registerName: 'Service register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('completeSale service charge support (fresh path)', () => {
  it('defaults serviceChargeAmount to 0 when the caller omits it', async () => {
    await setTenantRate(0);
    const productId = await seedServiceProduct(5, 100);

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
      discountAmount: 0,
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({
        serviceChargeAmount: sales.serviceChargeAmount,
        serviceChargeRate: sales.serviceChargeRate,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.serviceChargeAmount).toBe(0);
    expect(persisted?.serviceChargeRate).toBeNull();
    expect(persisted?.total).toBeCloseTo(100, 2);
  });

  it('rolls a tenant-rate service charge into total and persists the rate', async () => {
    await setTenantRate(10);
    const productId = await seedServiceProduct(5, 200);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 200,
          discount: 0,
          taxRate: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 220,
      discountAmount: 0,
      serviceChargeAmount: 20,
      serviceChargeRate: 10,
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({
        subtotal: sales.subtotal,
        serviceChargeAmount: sales.serviceChargeAmount,
        serviceChargeRate: sales.serviceChargeRate,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.subtotal).toBeCloseTo(200, 2);
    expect(persisted?.serviceChargeAmount).toBeCloseTo(20, 2);
    expect(persisted?.serviceChargeRate).toBe(10);
    expect(persisted?.total).toBeCloseTo(220, 2);
  });

  it('persists the live tenant rate instead of trusting the client echo', async () => {
    await setTenantRate(10);
    const productId = await seedServiceProduct(5, 100);

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
      amountReceived: 110,
      discountAmount: 0,
      serviceChargeAmount: 10,
      // Stale or tampered clients may echo an old rate. The amount is
      // what must match the current tenant config; persistence should
      // still freeze the server-resolved rate for reporting.
      serviceChargeRate: 5,
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({ serviceChargeRate: sales.serviceChargeRate })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.serviceChargeRate).toBe(10);
  });

  it('rejects a service charge amount that drifts from the tenant rate', async () => {
    await setTenantRate(10);
    const productId = await seedServiceProduct(5, 100);

    await expect(
      completeSale(buildContext(), {
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
        amountReceived: 130,
        discountAmount: 0,
        // Tenant rate would produce 10 on a 100 subtotal; sending 30 trips
        // the drift check (well above the 1¢ tolerance).
        serviceChargeAmount: 30,
        serviceChargeRate: 10,
      })
    ).rejects.toThrowError(/service charge amount/i);
  });

  it('rejects omitting a mandatory service charge when the tenant rate is enabled', async () => {
    await setTenantRate(10);
    const productId = await seedServiceProduct(5, 100);

    await expect(
      completeSale(buildContext(), {
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
        discountAmount: 0,
        serviceChargeAmount: 0,
      })
    ).rejects.toThrowError(/service charge amount/i);
  });

  it('rejects a non-zero service charge when the tenant rate is disabled', async () => {
    await setTenantRate(0);
    const productId = await seedServiceProduct(5, 100);

    await expect(
      completeSale(buildContext(), {
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
        amountReceived: 110,
        discountAmount: 0,
        serviceChargeAmount: 10,
        serviceChargeRate: 10,
      })
    ).rejects.toThrowError(/no service charge configured/i);
  });

  it('matches the tax-inclusive base so taxed carts pass the drift check', async () => {
    // Regression: an earlier draft validated the amount against bare
    // `subtotal` (tax-exclusive), which diverged from the UI's
    // tax-inclusive customer-facing base. With Puntovivo's inclusive
    // tax math (`saleCart.getLineTotals`), an item priced at $100 with
    // 19% IVA persists as subtotal $84.03 + tax $15.97 — the
    // tax-inclusive base is $100, the service charge at 10% is $10,
    // and the persisted `total` is $110.
    await setTenantRate(10);
    const productId = await seedServiceProduct(5, 100);

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
          taxRate: 19,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 110,
      discountAmount: 0,
      serviceChargeAmount: 10,
      serviceChargeRate: 10,
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({
        subtotal: sales.subtotal,
        taxAmount: sales.taxAmount,
        serviceChargeAmount: sales.serviceChargeAmount,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.subtotal).toBeCloseTo(84.03, 2);
    expect(persisted?.taxAmount).toBeCloseTo(15.97, 2);
    expect(persisted?.serviceChargeAmount).toBeCloseTo(10, 2);
    expect(persisted?.total).toBeCloseTo(110, 2);
  });

  it('combines tip + service charge in the same fresh-path total', async () => {
    await setTenantRate(10);
    const productId = await seedServiceProduct(5, 100);

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
      // 100 subtotal + 10 service + 15 tip = 125 grand total.
      amountReceived: 125,
      discountAmount: 0,
      tipAmount: 15,
      tipMethod: 'percentage',
      serviceChargeAmount: 10,
      serviceChargeRate: 10,
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({
        tipAmount: sales.tipAmount,
        serviceChargeAmount: sales.serviceChargeAmount,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.tipAmount).toBeCloseTo(15, 2);
    expect(persisted?.serviceChargeAmount).toBeCloseTo(10, 2);
    expect(persisted?.total).toBeCloseTo(125, 2);
  });
});

describe('completeSale service charge support (fromDraft path)', () => {
  it('layers a service charge on a frozen draft and records audit metadata', async () => {
    await setTenantRate(10);
    const productId = await seedServiceProduct(5, 100);

    const draft = await completeSale(buildContext(), {
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
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    const draftId = (draft.sale as { id: string }).id;

    const completion = await completeSale(buildContext(), {
      mode: 'fromDraft',
      saleId: draftId,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 110,
      serviceChargeAmount: 10,
      serviceChargeRate: 10,
    });

    expect(completion.sale).toMatchObject({ status: 'completed' });

    const persisted = await getDatabase()
      .select({
        serviceChargeAmount: sales.serviceChargeAmount,
        serviceChargeRate: sales.serviceChargeRate,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, draftId))
      .get();
    expect(persisted?.serviceChargeAmount).toBeCloseTo(10, 2);
    expect(persisted?.serviceChargeRate).toBe(10);
    expect(persisted?.total).toBeCloseTo(110, 2);

    const audit = await getDatabase()
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, draftId), eq(auditLogs.action, 'sale.complete')))
      .orderBy(desc(auditLogs.createdAt))
      .get();
    expect(audit?.metadata).toBeTruthy();
    const metadata =
      typeof audit?.metadata === 'string'
        ? (JSON.parse(audit.metadata) as Record<string, unknown>)
        : (audit?.metadata ?? {});
    expect(metadata.serviceChargeAmount).toBeCloseTo(10, 2);
    expect(metadata.serviceChargeRate).toBe(10);
  });

  it('does not compound a draft-time service charge when completeDraft applies another', async () => {
    // Regression: same shape as ENG-039d's compound-tip bug. The
    // fromDraft path must recompute `baseTotal` from frozen subtotal /
    // tax / discount pieces; otherwise the second service charge
    // stacks on the first.
    await setTenantRate(10);
    const productId = await seedServiceProduct(5, 100);

    const draft = await completeSale(buildContext(), {
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
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
      serviceChargeAmount: 10,
      serviceChargeRate: 10,
    });
    const draftId = (draft.sale as { id: string }).id;

    // Cashier completes with the SAME service charge (rate did not move).
    await completeSale(buildContext(), {
      mode: 'fromDraft',
      saleId: draftId,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 110,
      serviceChargeAmount: 10,
      serviceChargeRate: 10,
    });

    const persisted = await getDatabase()
      .select({
        subtotal: sales.subtotal,
        serviceChargeAmount: sales.serviceChargeAmount,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, draftId))
      .get();
    // total = subtotal (100) + service (10) = 110. The first charge does
    // not stack on top of the second.
    expect(persisted?.subtotal).toBeCloseTo(100, 2);
    expect(persisted?.serviceChargeAmount).toBeCloseTo(10, 2);
    expect(persisted?.total).toBeCloseTo(110, 2);
  });

  it('downgrades paymentStatus to partial when amountReceived covers the base but not the service charge', async () => {
    await setTenantRate(10);
    const productId = await seedServiceProduct(5, 100);

    const draft = await completeSale(buildContext(), {
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
      // amountReceived covers subtotal but not the new service charge.
      amountReceived: 100,
      serviceChargeAmount: 10,
      serviceChargeRate: 10,
    });

    const persisted = await getDatabase()
      .select({
        paymentStatus: sales.paymentStatus,
        total: sales.total,
        serviceChargeAmount: sales.serviceChargeAmount,
      })
      .from(sales)
      .where(eq(sales.id, draftId))
      .get();
    expect(persisted?.total).toBeCloseTo(110, 2);
    expect(persisted?.serviceChargeAmount).toBeCloseTo(10, 2);
    expect(persisted?.paymentStatus).toBe('partial');
  });
});

describe('createSale / completeDraft Zod refinement (service charge)', () => {
  it('rejects serviceChargeRate without a positive serviceChargeAmount', () => {
    const result = createSaleInput.safeParse({
      items: [
        { productId: 'p', unitId: 'u', quantity: 1, unitPrice: 1, discount: 0 },
      ],
      serviceChargeAmount: 0,
      serviceChargeRate: 10,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(
        /serviceChargeRate requires a positive serviceChargeAmount/
      );
    }
  });

  it('rejects a negative serviceChargeAmount on completeDraftInput', () => {
    const result = completeDraftInput.safeParse({
      saleId: 'sale-1',
      serviceChargeAmount: -5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a serviceChargeRate above the regulatory ceiling', () => {
    const result = createSaleInput.safeParse({
      items: [
        { productId: 'p', unitId: 'u', quantity: 1, unitPrice: 1, discount: 0 },
      ],
      serviceChargeAmount: 50,
      serviceChargeRate: 50,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a serviceChargeAmount=0 default with no rate', () => {
    const result = createSaleInput.safeParse({
      items: [
        { productId: 'p', unitId: 'u', quantity: 1, unitPrice: 1, discount: 0 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serviceChargeAmount).toBe(0);
      expect(result.data.serviceChargeRate).toBeUndefined();
    }
  });
});
