/**
 * ENG-039d2 — per-line `sale_items.notes` round-trip.
 *
 * Pins:
 *  - `sales.create` accepts a `notes` field per item; persisted as
 *    `sale_items.notes` on the inserted row.
 *  - Items without a note land as NULL.
 *  - Empty / whitespace-only notes collapse to NULL (the schema
 *    `.trim()` runs at the Zod boundary; the resolver finishes the
 *    coercion so the column never stores empty strings).
 *  - `getSaleRecord` surfaces the column to downstream readers.
 *  - The KDS snapshot includes per-item notes in `items_json` so
 *    the kitchen board renders modifiers inline.
 *
 * Reuses the credit-sale-flow harness for the `completeSale` direct
 * invocation pattern.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  inventoryBalances,
  kdsOrders,
  products,
  restaurantTables,
  saleItems,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { completeSale } from '../application/sales/completeSale.js';
import { getSaleRecord } from '../application/sales/sale-read.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let mesaId: string;
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

async function seedProduct(name: string, sku: string, stock = 100) {
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

async function enableKdsModule(): Promise<void> {
  const db = getDatabase();
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings = (row?.settings as Record<string, unknown> | null) ?? {};
  const modules = (settings.modules as Record<string, boolean> | undefined) ?? {};
  const next = { ...settings, modules: { ...modules, kds: true } };
  await db
    .update(tenants)
    .set({ settings: next, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, tenantId));
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

  const now = new Date().toISOString();
  mesaId = nanoid();
  await db.insert(restaurantTables).values({
    id: mesaId,
    tenantId,
    siteId,
    name: 'Mesa Notes',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'sale-item-notes.test',
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
    registerName: 'Sale-item-notes register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });

  await enableKdsModule();
});

afterAll(async () => {
  await server.close();
});

describe('sale_items.notes (ENG-039d2)', () => {
  it('persists per-line notes provided at sale creation', async () => {
    const productId = await seedProduct('Bandeja paisa', 'NOTE-A-1');
    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          unitPrice: 10,
          discount: 0,
          notes: 'sin cebolla',
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
      amountReceived: 20,
    });

    const saleId = (result.sale as { id: string }).id;
    const db = getDatabase();
    const rows = await db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.notes).toBe('sin cebolla');
  });

  it('stores NULL when the item omits a notes field', async () => {
    const productId = await seedProduct('Limonada de coco', 'NOTE-B-1');
    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
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
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
      amountReceived: 10,
    });

    const saleId = (result.sale as { id: string }).id;
    const db = getDatabase();
    const rows = await db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.notes).toBeNull();
  });

  it('coerces whitespace-only notes to NULL (column stays two-state)', async () => {
    const productId = await seedProduct('Arepa con queso', 'NOTE-C-1');
    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 10,
          discount: 0,
          // The Zod schema runs `.trim()` so a string of spaces lands as
          // empty here; the resolver then coerces empty → null.
          notes: '   ',
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
      amountReceived: 10,
    });

    const saleId = (result.sale as { id: string }).id;
    const db = getDatabase();
    const rows = await db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .all();
    expect(rows[0]?.notes).toBeNull();
  });

  it('surfaces notes through getSaleRecord', async () => {
    const productId = await seedProduct('Sancocho', 'NOTE-D-1');
    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 10,
          discount: 0,
          notes: 'extra plátano',
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
      amountReceived: 10,
    });

    const saleId = (result.sale as { id: string }).id;
    const record = await getSaleRecord(getDatabase(), tenantId, saleId);
    const items = (record as { items: Array<{ notes: string | null }> }).items;
    expect(items[0]?.notes).toBe('extra plátano');
  });

  it('includes per-line notes in the KDS snapshot items_json', async () => {
    const productId = await seedProduct('Empanada', 'NOTE-E-1');

    // Create a tabled draft (the suspend hook is what enqueues the KDS
    // row; direct-to-complete would also work but suspend is the
    // realistic restaurant path).
    const draft = await completeSale(buildContext(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 3,
          unitPrice: 10,
          discount: 0,
          notes: 'sin sal',
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      discountAmount: 0,
      tableId: mesaId,
    });

    const saleId = (draft.sale as { id: string }).id;
    const caller = appRouter.createCaller(fresh());
    await caller.sales.suspend({ saleId, tableId: mesaId });

    const db = getDatabase();
    const card = await db
      .select()
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, tenantId), eq(kdsOrders.saleId, saleId)))
      .get();
    expect(card).toBeDefined();
    const items = JSON.parse(card!.itemsJson) as Array<{
      productName: string;
      quantity: number;
      notes: string | null;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productName: 'Empanada',
      quantity: 3,
      notes: 'sin sal',
    });
  });
});
