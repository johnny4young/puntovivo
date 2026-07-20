/**
 * restaurant tip / propina invariants.
 *
 * Covers the contract the UI relies on: tipAmount rolls into `total`
 * server-side, the persisted columns reflect the operator's choice,
 * draft completion can layer a tip on a frozen subtotal, the audit
 * row carries the metadata, and the Zod refinement rejects a stale
 * tipMethod with zero amount.
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

async function seedTipProduct(stock: number, price: number) {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: `Tip Product ${productId}`,
    sku: `TIP-${productId.slice(0, 6)}`,
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

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
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

  const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
  const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
  if (!baseUnit) throw new Error('Expected seeded unit UND');
  baseUnitId = baseUnit.id;

  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'sales-tip.test',
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
    registerName: 'Tip register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('completeSale tip support (fresh path)', () => {
  it('defaults tipAmount to 0 when the caller omits it', async () => {
    const productId = await seedTipProduct(5, 100);

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
        tipAmount: sales.tipAmount,
        tipMethod: sales.tipMethod,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.tipAmount).toBe(0);
    expect(persisted?.tipMethod).toBeNull();
    expect(persisted?.total).toBeCloseTo(100, 2);
  });

  it('rolls a percentage tip into total and persists tipAmount + tipMethod', async () => {
    const productId = await seedTipProduct(5, 200);

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
      tipAmount: 20,
      tipMethod: 'percentage',
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({
        subtotal: sales.subtotal,
        tipAmount: sales.tipAmount,
        tipMethod: sales.tipMethod,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.subtotal).toBeCloseTo(200, 2);
    expect(persisted?.tipAmount).toBeCloseTo(20, 2);
    expect(persisted?.tipMethod).toBe('percentage');
    // total includes the tip so payment validation stays consistent.
    expect(persisted?.total).toBeCloseTo(220, 2);
  });

  it('accepts a split-tender sum equal to total + tip', async () => {
    const productId = await seedTipProduct(5, 80);

    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 80,
          discount: 0,
          taxRate: 0,
        },
      ],
      payments: [
        { method: 'cash', amount: 50, reference: null },
        { method: 'card', amount: 38, reference: 'auth-tip' },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 88,
      discountAmount: 0,
      tipAmount: 8,
      tipMethod: 'fixed',
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({ total: sales.total, tipAmount: sales.tipAmount })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.total).toBeCloseTo(88, 2);
    expect(persisted?.tipAmount).toBeCloseTo(8, 2);
  });

  it('clamps a negative tipAmount supplied by a non-Zod caller to zero', async () => {
    const productId = await seedTipProduct(5, 50);

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
          taxRate: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 50,
      discountAmount: 0,
      tipAmount: -10,
      tipMethod: 'fixed',
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({ tipAmount: sales.tipAmount, tipMethod: sales.tipMethod, total: sales.total })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.tipAmount).toBe(0);
    expect(persisted?.tipMethod).toBeNull();
    expect(persisted?.total).toBeCloseTo(50, 2);
  });
});

describe('completeSale tip support (fromDraft path)', () => {
  it('layers a tip on a frozen draft total and records audit metadata', async () => {
    const productId = await seedTipProduct(5, 150);

    const draft = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 150,
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
      amountReceived: 165,
      tipAmount: 15,
      tipMethod: 'percentage',
    });

    expect(completion.sale).toMatchObject({ status: 'completed' });

    const persisted = await getDatabase()
      .select({
        subtotal: sales.subtotal,
        tipAmount: sales.tipAmount,
        tipMethod: sales.tipMethod,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, draftId))
      .get();
    expect(persisted?.subtotal).toBeCloseTo(150, 2);
    expect(persisted?.tipAmount).toBeCloseTo(15, 2);
    expect(persisted?.tipMethod).toBe('percentage');
    expect(persisted?.total).toBeCloseTo(165, 2);

    // Audit metadata captures the tip when non-zero.
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
    expect(metadata.tipAmount).toBeCloseTo(15, 2);
    expect(metadata.tipMethod).toBe('percentage');
  });

  it('does not compound a draft-time tip when completeDraft applies another tip', async () => {
    // Regression: `existing.total` already includes the create-time
    // tip; the fromDraft path must recompute `baseTotal` from frozen
    // subtotal / tax / discount pieces so the second tip does not
    // stack on top of the first.
    const productId = await seedTipProduct(5, 100);

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
      // Draft starts with a 5-unit tip baked in.
      tipAmount: 5,
      tipMethod: 'fixed',
    });
    const draftId = (draft.sale as { id: string }).id;

    // Cashier confirms with a different tip at complete-time.
    await completeSale(buildContext(), {
      mode: 'fromDraft',
      saleId: draftId,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 115,
      tipAmount: 15,
      tipMethod: 'percentage',
    });

    const persisted = await getDatabase()
      .select({
        subtotal: sales.subtotal,
        tipAmount: sales.tipAmount,
        tipMethod: sales.tipMethod,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, draftId))
      .get();
    // total = subtotal (100) + 0 tax - 0 discount + new tip (15) = 115.
    // The original 5-unit draft tip is replaced, not stacked on top.
    expect(persisted?.subtotal).toBeCloseTo(100, 2);
    expect(persisted?.tipAmount).toBeCloseTo(15, 2);
    expect(persisted?.tipMethod).toBe('percentage');
    expect(persisted?.total).toBeCloseTo(115, 2);
  });

  it('combines a discount and a tip correctly in the fresh-path total formula', async () => {
    const productId = await seedTipProduct(5, 200);

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
      // total = 200 (subtotal) + 0 (tax) - 30 (discount) + 25 (tip) = 195.
      amountReceived: 195,
      discountAmount: 30,
      tipAmount: 25,
      tipMethod: 'fixed',
    });
    const saleId = (result.sale as { id: string }).id;

    const persisted = await getDatabase()
      .select({
        subtotal: sales.subtotal,
        discountAmount: sales.discountAmount,
        tipAmount: sales.tipAmount,
        total: sales.total,
      })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(persisted?.subtotal).toBeCloseTo(200, 2);
    expect(persisted?.discountAmount).toBeCloseTo(30, 2);
    expect(persisted?.tipAmount).toBeCloseTo(25, 2);
    expect(persisted?.total).toBeCloseTo(195, 2);
  });

  it('downgrades paymentStatus to partial when amountReceived covers the base but not the tip', async () => {
    const productId = await seedTipProduct(5, 90);

    const draft = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 90,
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

    // The standard policy downgrades a requested `paid` to `partial`
    // when amountReceived falls short — proving the comparison uses
    // `total + tip` rather than the bare base total. The sale row is
    // still persisted, but with `paymentStatus='partial'`.
    await completeSale(buildContext(), {
      mode: 'fromDraft',
      saleId: draftId,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 90,
      tipAmount: 10,
      tipMethod: 'fixed',
    });

    const persisted = await getDatabase()
      .select({
        paymentStatus: sales.paymentStatus,
        total: sales.total,
        tipAmount: sales.tipAmount,
      })
      .from(sales)
      .where(eq(sales.id, draftId))
      .get();
    expect(persisted?.total).toBeCloseTo(100, 2);
    expect(persisted?.tipAmount).toBeCloseTo(10, 2);
    expect(persisted?.paymentStatus).toBe('partial');
  });
});

describe('createSale / completeDraft Zod refinement', () => {
  it('rejects tipMethod without a positive tipAmount on createSaleInput', () => {
    const result = createSaleInput.safeParse({
      items: [{ productId: 'p', unitId: 'u', quantity: 1, unitPrice: 1, discount: 0 }],
      tipAmount: 0,
      tipMethod: 'percentage',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(
        /tipMethod requires a positive tipAmount/
      );
    }
  });

  it('rejects negative tipAmount on completeDraftInput', () => {
    const result = completeDraftInput.safeParse({
      saleId: 'sale-1',
      tipAmount: -5,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a tipAmount=0 default on createSaleInput', () => {
    const result = createSaleInput.safeParse({
      items: [{ productId: 'p', unitId: 'u', quantity: 1, unitPrice: 1, discount: 0 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tipAmount).toBe(0);
      expect(result.data.tipMethod).toBeUndefined();
    }
  });
});
